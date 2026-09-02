import { expect, test, type Page } from "@playwright/test";
import { assertNoBrokenPreviewLinks, collectFailedAssets, previewScopeFrom } from "./crawl";

async function boot(page: Page) {
  await page.goto("/");
  await expect(page.getByTestId("app-shell")).toBeVisible();
  await expect(page.getByTestId("title-input")).toHaveValue("Hello Open Pages");
}

/**
 * The preview renders in an in-app overlay, so nothing here may open a browser
 * tab; a popup would mean the old window.open path came back.
 */
async function openHexoPreview(page: Page) {
  const failed: string[] = [];
  const popups: string[] = [];
  page.on("popup", (popup) => popups.push(popup.url()));
  collectFailedAssets(page, failed);

  await page.getByTestId("btn-preview").click();
  await expect(page.getByTestId("preview-overlay")).toBeVisible();
  const frame = page.getByTestId("preview-frame");
  // A cold hexo generate can run well past a minute on a fresh CI machine.
  await expect(frame).toBeVisible({ timeout: 120_000 });

  const src = (await frame.getAttribute("src")) ?? "";
  expect(src, "preview frame has no src").toMatch(/\/preview\/[^/]+\//);
  // Not networkidle on the app page: the Vite dev server holds an HMR socket
  // open, so that state never arrives. Wait on the frame's own content instead.
  await expect(page.frameLocator('[data-testid="preview-frame"]').locator("body")).toBeVisible();
  return { src, failed, popups };
}

/**
 * The theme stylesheet is served from the preview origin, so it only loads when
 * the frame resolves its capability URL. Reading cssRules also proves the frame
 * got a real origin of its own rather than an opaque one, which is what lets
 * theme scripts use storage.
 */
async function expectStyledPreviewFrame(page: Page) {
  await expect
    .poll(
      async () => {
        const frame = page.frames().find((candidate) => candidate.url().includes("/preview/"));
        if (!frame) return 0;
        return await frame
          .evaluate(() =>
            [...document.styleSheets]
              .filter((sheet) => sheet.href?.includes("/preview/"))
              .reduce((max, sheet) => {
                try {
                  return Math.max(max, sheet.cssRules.length);
                } catch {
                  return max;
                }
              }, 0),
          )
          .catch(() => 0);
      },
      { timeout: 30_000, message: "theme CSS never loaded inside the preview iframe" },
    )
    .toBeGreaterThan(0);
}

test.describe("Open Pages editor", () => {
  test("loads the welcome post in the writing canvas", async ({ page }) => {
    await boot(page);
    await expect(page.getByTestId("sidebar")).toBeVisible();
    await expect(page.locator(".brand strong")).toHaveText("Open Pages");
    await expect(page.getByTestId("sidebar-site-title")).toHaveText("本地站点");
    await expect(page.getByTestId("wysiwyg-editor")).toBeVisible();
    await expect(page.getByTestId("editor-pane")).toContainText(/Typora|Hexo|GitHub Pages/);
  });

  test("sidebar lists the document outline instead of files", async ({ page }) => {
    await boot(page);
    await expect(page.getByTestId("outline")).toBeVisible();
    await expect(page.getByTestId("file-hello-open-pages")).toHaveCount(0);
    const first = page.getByTestId("outline-item-0");
    await expect(first).toBeVisible();
    const heading = await first.textContent();
    await first.click();
    await expect(page.locator(".crepe-host").getByText(heading!.trim(), { exact: true }).first()).toBeVisible();
  });

  /**
   * A long post used to stretch the grid row past the viewport, taking the
   * sidebar with it, so Files/Settings could only be reached by scrolling.
   */
  test("sidebar footer stays in view while the editor scrolls", async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 400 });
    await boot(page);
    await expect(page.getByTestId("editor-pane")).toContainText(/Typora|Hexo|GitHub Pages/);

    const layout = await page.evaluate(() => {
      const pane = document.querySelector(".editor-pane")!;
      return {
        docScrollHeight: document.documentElement.scrollHeight,
        viewportHeight: window.innerHeight,
        paneScrollsItself: pane.scrollHeight > pane.clientHeight,
      };
    });
    expect(layout.docScrollHeight).toBeLessThanOrEqual(layout.viewportHeight);
    expect(layout.paneScrollsItself).toBe(true);
    await expect(page.getByTestId("btn-files")).toBeInViewport();
    await expect(page.getByTestId("btn-settings")).toBeInViewport();
  });

  test("resizes the sidebar and hides it at the left edge", async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 700 });
    await boot(page);
    await expect(page.locator(".sidebar-foot").getByRole("button")).toHaveCount(2);

    const handle = page.getByTestId("sidebar-resize-handle");
    const edge = await handle.boundingBox();
    expect(edge).not.toBeNull();
    await page.mouse.move(edge!.x + edge!.width / 2, edge!.y + 100);
    await page.mouse.down();
    await page.mouse.move(360, edge!.y + 100);
    await page.mouse.up();
    await expect
      .poll(() => page.getByTestId("sidebar").evaluate((node) => Math.round(node.getBoundingClientRect().width)))
      .toBe(360);

    const resizedEdge = await handle.boundingBox();
    expect(resizedEdge).not.toBeNull();
    await page.mouse.move(resizedEdge!.x + resizedEdge!.width / 2, resizedEdge!.y + 100);
    await page.mouse.down();
    await page.mouse.move(40, resizedEdge!.y + 100);
    // The panel has to clear the viewport while the button is still down: its
    // padding used to floor the width, leaving a strip over the editor that no
    // amount of dragging could push off the edge.
    await expect(page.getByTestId("sidebar")).toBeHidden();
    // A panel taken out of the flow stops occupying its grid cell, so the shell
    // has to drop the column too. Leaving it in place let auto-placement move
    // the editor into the empty track and crush it against the left edge.
    await expect
      .poll(() => page.locator(".main").evaluate((node) => Math.round(node.getBoundingClientRect().width)))
      .toBe(1200);
    await page.mouse.move(0, resizedEdge!.y + 100);
    await page.mouse.up();
    await expect(page.getByTestId("sidebar")).toBeHidden();

    // The top bar remains the recovery path after an edge drag hides the sidebar.
    await page.getByTestId("btn-sidebar").click();
    await expect(page.getByTestId("sidebar")).toBeVisible();
    await expect
      .poll(() => page.getByTestId("sidebar").evaluate((node) => Math.round(node.getBoundingClientRect().width)))
      .toBe(360);
  });

  test("manages files on a dedicated page", async ({ page }) => {
    await boot(page);
    await page.getByTestId("btn-files").click();
    await expect(page.getByTestId("files-page")).toBeVisible();
    await expect(page).toHaveURL(/#\/files/);
    await expect(page.getByTestId("file-hello-open-pages")).toContainText("Hello Open Pages");
    await expect(page.getByTestId("file-about")).toContainText("About");
    await expect(page.getByTestId("files-group-image")).toHaveCount(0);

    await page.getByTestId("files-tab-draft").click();
    await expect(page.getByTestId("files-blank")).toBeVisible();
    await page.getByTestId("files-tab-all").click();

    await page.getByTestId("files-search").fill("about");
    await expect(page.getByTestId("file-hello-open-pages")).toHaveCount(0);
    await page.getByTestId("file-about").click();
    await expect(page.getByTestId("files-page")).toHaveCount(0);
    await expect(page.getByTestId("title-input")).toHaveValue("About");
  });

  test("code language picker does not overlap the heading above", async ({ page }) => {
    await boot(page);
    const heading = page.locator(".crepe-host h2, .crepe-host h1").filter({ hasText: "写作" }).first();
    const code = page.locator(".milkdown-code-block").first();
    await expect(heading).toBeVisible();
    await expect(code).toBeVisible();
    await code.hover();
    const lang = page.locator(".milkdown-code-block .language-button").first();
    await expect(lang).toBeVisible();
    const headingBox = await heading.boundingBox();
    const langBox = await lang.boundingBox();
    expect(headingBox && langBox, "heading and language picker must be laid out").toBeTruthy();
    expect(langBox!.y, "language picker overlapped the heading").toBeGreaterThan(headingBox!.y + headingBox!.height - 1);

    await code.locator(".cm-content").click();
    const gutter = code.locator(".cm-lineNumbers .cm-activeLineGutter");
    await expect(gutter).toBeAttached();
    const luminance = await gutter.evaluate((el) => {
      const { backgroundColor, color } = getComputedStyle(el);
      const parse = (value: string) => {
        const match = value.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        if (!match) return { r: 255, g: 255, b: 255, a: 0 };
        return { r: Number(match[1]), g: Number(match[2]), b: Number(match[3]), a: 1 };
      };
      const bg = parse(backgroundColor);
      const lum = 0.2126 * bg.r + 0.7152 * bg.g + 0.0722 * bg.b;
      return { lum, transparent: backgroundColor === "transparent" || backgroundColor.startsWith("rgba(0, 0, 0, 0)"), color };
    });
    expect(
      luminance.transparent || luminance.lum > 180,
      `code line number used a dark gutter (${luminance.color} on ${JSON.stringify(luminance)})`,
    ).toBeTruthy();
  });

  test("switches to source mode without leaving the editor", async ({ page }) => {
    await boot(page);
    await page.getByTestId("btn-source").click();
    const source = page.getByTestId("source-editor");
    await expect(source).toBeVisible();
    await expect(source.locator(".cm-content")).toContainText("Hello Open Pages");
    await expect(source.locator(".cm-content")).toContainText("---");
    await expect(page.getByTestId("source-preview")).toBeVisible();
    await expect(page.getByTestId("wysiwyg-editor")).toHaveCount(0);
  });

  test("renders LaTeX and Mermaid in the editor and Hexo preview", async ({ page }) => {
    test.setTimeout(240_000);
    await boot(page);
    await page.getByTestId("btn-source").click();
    const editor = page.getByTestId("source-editor").locator(".cm-content");
    await editor.click();
    await page.keyboard.press("Control+A");
    await page.keyboard.insertText(`---
title: Math and diagrams
date: 2026-09-02 16:00:00
---

Inline math: $E = mc^2$

$$
\\int_0^1 x^2\\,dx = \\frac{1}{3}
$$

\`\`\`mermaid
graph LR
  A --> B
\`\`\`
`);

    const sourcePreview = page.getByTestId("source-preview");
    await expect(sourcePreview.locator(".katex")).toHaveCount(2);
    await expect(sourcePreview.locator(".mermaid-diagram svg")).toBeVisible();

    await page.getByTestId("btn-write").click();
    const writing = page.getByTestId("wysiwyg-editor");
    await expect(writing.locator(".katex")).toHaveCount(2);
    await expect(writing.locator(".mermaid-diagram svg")).toBeVisible();
    await page.getByTestId("btn-source").click();
    const roundTrippedSource = page.getByTestId("source-editor").locator(".cm-content");
    await expect(roundTrippedSource).toContainText("```mermaid");
    await expect(roundTrippedSource).toContainText("graph LR");

    await openHexoPreview(page);
    const generated = page.frameLocator('[data-testid="preview-frame"]');
    await expect(generated.locator(".katex")).toHaveCount(2);
    await expect(generated.locator("p .katex").first()).toBeVisible();
    await expect(generated.locator(".katex-display").first()).toBeVisible();
    await expect(generated.locator(".mermaid svg")).toBeVisible();
  });

  test("creates a post from the in-app dialog", async ({ page }) => {
    await boot(page);
    await page.getByTestId("btn-files-top").click();
    await page.getByTestId("new-post").click();
    await expect(page.getByTestId("dialog-new-doc")).toBeVisible();
    await page.getByTestId("new-doc-title").fill("E2E Article");
    await page.getByTestId("new-doc-submit").click();
    await expect(page.getByTestId("title-input")).toHaveValue("E2E Article");
    await page.getByTestId("btn-files").click();
    await expect(page.getByTestId("file-e2e-article")).toBeVisible();
  });

  test("opens a settings page with live theme preview", async ({ page }) => {
    await boot(page);
    await page.getByTestId("btn-settings").click();
    await expect(page.getByTestId("settings-page")).toBeVisible();
    await expect(page).toHaveURL(/#\/settings/);
    await expect(page.getByTestId("theme-settings")).toBeVisible();
    await expect(page.getByTestId("theme-landscape")).toHaveClass(/on/);
    await expect(page.getByTestId("theme-setting-sidebar")).toBeVisible();
    await expect(page.getByTestId("theme-preview-loading").or(page.getByTestId("theme-preview-frame"))).toBeVisible();
    await page.getByTestId("settings-tab-plugin").click();
    await expect(page.getByTestId("plugin-settings")).toBeVisible();
    await expect(page.getByTestId("plugin-hexo-renderer-marked")).toContainText("核心预装");
    await expect(page.getByTestId("plugin-toggle-hexo-renderer-marked")).toBeDisabled();
    await expect(page.getByTestId("addon-source-plugin")).toBeVisible();

    await page.getByTestId("settings-tab-site").click();
    await expect(page).toHaveURL(/#\/settings\/site/);
    const title = page.getByTestId("cfg-title");
    await expect(title).toBeVisible();
    await expect(title).toHaveValue("Open Pages");
    await title.fill("E2E Site");
    const avatarBuffer = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    );
    await page.getByTestId("cfg-avatar-file").setInputFiles({
      name: "avatar.png",
      mimeType: "image/png",
      buffer: avatarBuffer,
    });
    await expect(page.getByTestId("cfg-avatar-clear")).toBeVisible();
    await expect(page.getByTestId("settings-save")).toBeEnabled();
    await page.getByTestId("settings-save").click();
    await expect(page.getByTestId("sidebar-site-title")).toHaveText("E2E Site");

    await page.getByTestId("settings-tab-theme").click();
    await page.getByTestId("theme-stellar").click();
    await expect
      .poll(
        () =>
          page
            .frameLocator('[data-testid="theme-preview-frame"]')
            .locator("a.avatar img.avatar")
            .first()
            .getAttribute("src")
            .catch(() => null),
        { timeout: 60_000, message: "Stellar did not use the uploaded avatar" },
      )
      .toMatch(/avatar\.png/);

    await page.getByTestId("theme-next").click();
    await expect(page.getByTestId("theme-next")).toHaveClass(/on/);
    await expect(page.getByTestId("theme-settings")).toContainText("NexT");
    await expect(page.getByTestId("theme-setting-color_scheme")).toBeVisible();
    // Rapid changes start overlapping server generations; only the newest
    // result may update the preview/error state.
    await page.getByTestId("theme-setting-color_scheme-light").click();
    await page.waitForTimeout(700);
    await page.getByTestId("theme-setting-color_scheme-dark").click();
    await page.waitForTimeout(700);
    await page.getByTestId("theme-setting-color_scheme-auto").click();
    await expect(page.getByTestId("theme-preview-frame")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("theme-preview-error")).toHaveCount(0);
    await expectStyledPreviewFrame(page);
    await expect(page.getByTestId("settings-save")).toBeEnabled();
    await page.getByTestId("settings-save").click();
    await expect(page.getByTestId("theme-preview-frame")).toBeVisible({ timeout: 60_000 });
    await expectStyledPreviewFrame(page);

    await page.getByTestId("settings-close").click();
    await expect(page.getByTestId("settings-page")).toHaveCount(0);
    await expect(page.getByTestId("title-input")).toBeVisible();
  });

  test("opens a styled Hexo preview in-app and crawls every local link", async ({ page }) => {
    // A cold hexo generate plus the crawl outruns the default budget.
    test.setTimeout(240_000);
    await boot(page);
    const { src, failed, popups } = await openHexoPreview(page);

    const preview = page.frameLocator('[data-testid="preview-frame"]');
    await expect(preview.locator("body")).toContainText(/Hello Open Pages|Open Pages/);
    await assertNoBrokenPreviewLinks(page, previewScopeFrom(src));
    expect(failed, `preview assets 404: ${failed.join("\n")}`).toEqual([]);

    const header = preview.locator("#header");
    await expect(header).toBeVisible();
    const headerHeight = await header.evaluate((el) => Number.parseFloat(getComputedStyle(el).height));
    expect(headerHeight, "landscape CSS did not apply; header is still unstyled").toBeGreaterThan(40);

    expect(popups, `preview escaped into a browser tab: ${popups.join("\n")}`).toEqual([]);
    await expect(page.getByTestId("toast")).toContainText(/Hexo 预览/);

    await page.getByTestId("preview-close").click();
    await expect(page.getByTestId("preview-overlay")).toHaveCount(0);
    await expect(page.getByTestId("title-input")).toBeVisible();
  });

  test("publish goes straight to GitHub", async ({ page }) => {
    await boot(page);
    await page.getByTestId("btn-publish").click();
    await expect(page.getByTestId("publish-page")).toBeVisible();
    await expect(page).toHaveURL(/#\/publish\/github/);
    await expect(page.getByTestId("publish-page")).toContainText("GitHub Pages");
    await expect(page.getByTestId("publish-login")).toBeVisible();
    await expect(page.getByTestId("theme-studio")).toHaveCount(0);
    await page.getByTestId("publish-back").click();
    await expect(page.getByTestId("publish-page")).toHaveCount(0);
    await expect(page.getByTestId("title-input")).toBeVisible();
  });
});

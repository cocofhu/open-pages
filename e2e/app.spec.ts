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

/** Toolbar preview must land on a document permalink, not only /preview/<key>/. */
function expectArticlePreviewSrc(src: string) {
  const pathname = new URL(src, "http://localhost").pathname;
  const match = pathname.match(/^\/preview\/[^/]+\/(.+)$/);
  expect(match?.[1], `toolbar preview stayed on site root: ${src}`).toBeTruthy();
  expect(match?.[1], `toolbar preview stayed on site root: ${src}`).not.toMatch(/^\/?$/);
}

/** Publish preview must land on the preview site root (home). */
function expectHomePreviewSrc(src: string) {
  const pathname = new URL(src, "http://localhost").pathname.replace(/\/+$/, "") + "/";
  expect(pathname, `publish preview left the site root: ${src}`).toMatch(/^\/preview\/[^/]+\/$/);
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
    await expect(page.getByTestId("settings-domain")).toBeVisible();
    await expect(page.getByTestId("cfg-custom-domain")).toBeVisible();
    await page.getByTestId("cfg-domain-help").click();
    const help = page.getByTestId("dialog-domain-help");
    await expect(help).toBeVisible();
    await expect(help).toContainText("如何配置自定义域名");
    await expect(help).toContainText("CNAME");
    await expect(help).not.toContainText("404");
    await expect(help).not.toContainText("YAML");
    await expect(help).not.toContainText("仓库名");
    await page.getByTestId("domain-help-close").click();
    await expect(help).toHaveCount(0);
    await page.getByTestId("cfg-custom-domain").fill("https://bad.example.com");
    await page.getByTestId("settings-save").click();
    await expect(page.getByTestId("cfg-domain-error")).toBeVisible();
    await page.getByTestId("cfg-custom-domain").fill("blog.example.com");
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
    await expect(page.getByTestId("cfg-custom-domain")).toHaveValue("blog.example.com");

    // Clear domain and save: field must stay empty (not refilled by remote cname).
    await page.route("**/pages-domain", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ customDomain: "old.example.com" }),
      });
    });
    await page.evaluate(async () => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open("open-pages", 1);
        req.onerror = () => reject(req.error ?? new Error("idb open failed"));
        req.onsuccess = () => resolve(req.result);
      });
      const row = await new Promise<Record<string, unknown> | undefined>((resolve, reject) => {
        const tx = database.transaction("meta", "readonly");
        const getReq = tx.objectStore("meta").get("default");
        getReq.onerror = () => reject(getReq.error ?? new Error("idb get failed"));
        getReq.onsuccess = () => resolve(getReq.result as Record<string, unknown> | undefined);
      });
      if (!row) throw new Error("missing meta row");
      const github = {
        ...((row.github as Record<string, unknown> | undefined) ?? {}),
        owner: "alice",
        repo: "notes",
        defaultBranch: "main",
        customDomain: "blog.example.com",
      };
      await new Promise<void>((resolve, reject) => {
        const tx = database.transaction("meta", "readwrite");
        const putReq = tx.objectStore("meta").put({ ...row, github, updatedAt: Date.now() });
        putReq.onerror = () => reject(putReq.error ?? new Error("idb put failed"));
        putReq.onsuccess = () => resolve();
      });
      database.close();
    });
    await page.reload();
    await expect(page.getByTestId("app-shell")).toBeVisible();
    // Reload keeps #/settings/site; settings panel is already open.
    await page.goto("/#/settings/site");
    await expect(page.getByTestId("settings-page")).toBeVisible();
    await expect(page.getByTestId("cfg-custom-domain")).toHaveValue("blog.example.com");
    await page.getByTestId("cfg-custom-domain").fill("");
    await page.getByTestId("settings-save").click();
    await expect(page.getByTestId("cfg-custom-domain")).toHaveValue("");
    // Stay empty even if pagesDomain would return a remote cname.
    await expect
      .poll(async () => page.getByTestId("cfg-custom-domain").inputValue(), { timeout: 2_000 })
      .toBe("");

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

    // g3.1 / g2.1: toolbar preview lands on the current document permalink.
    expectArticlePreviewSrc(src);
    await expect(page.getByTestId("preview-overlay")).toContainText("文章预览");

    const preview = page.frameLocator('[data-testid="preview-frame"]');
    await expect(preview.locator("body")).toContainText("Hello Open Pages");
    await expect(preview.locator("body")).toContainText(/Typora|所见即所得/);
    await assertNoBrokenPreviewLinks(page, previewScopeFrom(src));
    expect(failed, `preview assets 404: ${failed.join("\n")}`).toEqual([]);

    const header = preview.locator("#header");
    await expect(header).toBeVisible();
    const headerHeight = await header.evaluate((el) => Number.parseFloat(getComputedStyle(el).height));
    expect(headerHeight, "landscape CSS did not apply; header is still unstyled").toBeGreaterThan(40);

    expect(popups, `preview escaped into a browser tab: ${popups.join("\n")}`).toEqual([]);
    await expect(page.getByTestId("toast")).toContainText(/文章预览/);

    await page.getByTestId("preview-close").click();
    await expect(page.getByTestId("preview-overlay")).toHaveCount(0);
    await expect(page.getByTestId("title-input")).toBeVisible();
  });

  test("toolbar preview opens the About page when that document is active", async ({ page }) => {
    test.setTimeout(240_000);
    await boot(page);
    await page.getByTestId("btn-files").click();
    await page.getByTestId("file-about").click();
    await expect(page.getByTestId("title-input")).toHaveValue("About");

    const { src, popups } = await openHexoPreview(page);
    expectArticlePreviewSrc(src);
    expect(src).toMatch(/\/about\/?(?:\?|$)/);
    await expect(page.getByTestId("preview-overlay")).toContainText("文章预览");

    const preview = page.frameLocator('[data-testid="preview-frame"]');
    await expect(preview.locator("body")).toContainText(/About|Open Pages/);
    expect(popups).toEqual([]);
  });

  test("toolbar preview opens a draft document", async ({ page }) => {
    test.setTimeout(240_000);
    await boot(page);
    await page.getByTestId("btn-files-top").click();
    await page.getByTestId("new-post").click();
    await page.getByTestId("kind-draft").click();
    await page.getByTestId("new-doc-title").fill("Draft Preview Body");
    await page.getByTestId("new-doc-submit").click();
    await expect(page.getByTestId("title-input")).toHaveValue("Draft Preview Body");

    const { src, popups } = await openHexoPreview(page);
    expectArticlePreviewSrc(src);
    const preview = page.frameLocator('[data-testid="preview-frame"]');
    await expect(preview.locator("body")).toContainText("Draft Preview Body");
    expect(popups).toEqual([]);
  });

  test("publish preview opens the site home even when an article is open", async ({ page }) => {
    test.setTimeout(240_000);
    await page.route("**/auth/me", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          guestId: "e2e-guest",
          login: "e2e-user",
          name: "E2E User",
          avatarUrl: null,
          githubEnabled: true,
        }),
      });
    });
    await page.route("**/sites/github/repos/**/publish-check**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          eligible: true,
          reason: "bound",
          message: "可以发布",
        }),
      });
    });

    await boot(page);
    await expect(page.getByTestId("title-input")).toHaveValue("Hello Open Pages");

    // Publish is bound-repo-only after main; seed the local GithubBinding so
    // the preview button can enable without the removed create-repo UI.
    await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open("open-pages", 1);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction("meta", "readwrite");
        const store = tx.objectStore("meta");
        const getReq = store.get("default");
        getReq.onsuccess = () => {
          const row = (getReq.result as Record<string, unknown> | undefined) ?? {
            key: "default",
            config: {},
            updatedAt: Date.now(),
          };
          store.put({
            ...row,
            github: {
              owner: "e2e-user",
              repo: "e2e-user.github.io",
              defaultBranch: "main",
            },
            updatedAt: Date.now(),
          });
        };
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    });
    await page.reload();
    await expect(page.getByTestId("app-shell")).toBeVisible();
    await expect(page.getByTestId("title-input")).toHaveValue("Hello Open Pages");

    await page.getByTestId("btn-publish").click();
    await expect(page.getByTestId("publish-page")).toBeVisible();
    await expect(page.getByTestId("publish-bound-repo")).toContainText("e2e-user/e2e-user.github.io");
    await expect(page.getByTestId("publish-repo-check")).toContainText("可以发布", { timeout: 10_000 });

    const popups: string[] = [];
    page.on("popup", (popup) => popups.push(popup.url()));
    await page.getByTestId("publish-preview").click();
    await expect(page.getByTestId("preview-overlay")).toBeVisible();
    await expect(page.getByTestId("preview-overlay")).toContainText("主页预览");
    const frame = page.getByTestId("preview-frame");
    await expect(frame).toBeVisible({ timeout: 120_000 });
    const src = (await frame.getAttribute("src")) ?? "";
    expectHomePreviewSrc(src);

    const preview = page.frameLocator('[data-testid="preview-frame"]');
    await expect(preview.locator("body")).toContainText(/Open Pages|Hello Open Pages/);
    // Home lists posts; it must not be the single-post article layout as the only landing.
    // Root URL is the hard contract; also ensure we did not follow the welcome permalink.
    expect(src).not.toMatch(/hello-open-pages/);
    expect(popups, `publish preview escaped into a browser tab: ${popups.join("\n")}`).toEqual([]);
  });

  test("publish goes straight to GitHub", async ({ page }) => {
    await boot(page);
    await page.getByTestId("btn-publish").click();
    await expect(page.getByTestId("publish-page")).toBeVisible();
    await expect(page).toHaveURL(/#\/publish\/github/);
    await expect(page.getByTestId("publish-page")).toContainText("GitHub Pages");
    await expect(page.getByTestId("publish-login")).toBeVisible();
    // Bound-only publish: no create toggle / empty-list copy on this page.
    await expect(page.getByTestId("publish-create-toggle")).toHaveCount(0);
    await expect(page.getByTestId("publish-page")).not.toContainText("没有可用仓库");
    await expect(page.getByTestId("theme-studio")).toHaveCount(0);
    await page.getByTestId("publish-back").click();
    await expect(page.getByTestId("publish-page")).toHaveCount(0);
    await expect(page.getByTestId("title-input")).toBeVisible();
  });
});

import { expect, test, type Page } from "@playwright/test";
import { assertNoBrokenPreviewLinks, collectFailedAssets } from "./crawl";

async function boot(page: Page) {
  await page.goto("/");
  await expect(page.getByTestId("app-shell")).toBeVisible();
  await expect(page.getByTestId("title-input")).toHaveValue("Hello Open Pages");
}

async function openHexoPreview(page: Page) {
  const failed: string[] = [];
  const popupPromise = page.waitForEvent("popup");
  await page.getByTestId("btn-preview").click();
  const popup = await popupPromise;
  collectFailedAssets(popup, failed);
  await popup.waitForURL(/\/preview\/default\/(\?|$)/, { timeout: 40_000 });
  await popup.waitForLoadState("networkidle");
  return { popup, failed };
}

test.describe("Open Pages editor", () => {
  test("loads the welcome post in the writing canvas", async ({ page }) => {
    await boot(page);
    await expect(page.getByTestId("sidebar")).toBeVisible();
    await expect(page.locator(".brand strong")).toHaveText("Open Pages");
    await expect(page.getByTestId("sidebar-site-title")).toHaveText("本地站点");
    await expect(page.getByTestId("file-hello-open-pages")).toHaveText("Hello Open Pages");
    await expect(page.getByTestId("file-about")).toHaveText("About");
    await expect(page.getByTestId("tree-image")).toHaveCount(0);
    await expect(page.getByTestId("wysiwyg-editor")).toBeVisible();
    await expect(page.getByTestId("editor-pane")).toContainText(/Typora|Hexo|GitHub Pages/);
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
    await expect(source).toHaveValue(/title:\s*Hello Open Pages/);
    await expect(source).toHaveValue(/---/);
    await expect(page.getByTestId("wysiwyg-editor")).toHaveCount(0);
  });

  test("creates a post from the in-app dialog", async ({ page }) => {
    await boot(page);
    await page.getByTestId("new-post").click();
    await expect(page.getByTestId("dialog-new-doc")).toBeVisible();
    await page.getByTestId("new-doc-title").fill("E2E Article");
    await page.getByTestId("new-doc-submit").click();
    await expect(page.getByTestId("file-e2e-article")).toBeVisible();
    await expect(page.getByTestId("title-input")).toHaveValue("E2E Article");
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

    await page.getByTestId("settings-tab-site").click();
    await expect(page).toHaveURL(/#\/settings\/site/);
    const title = page.getByTestId("cfg-title");
    await expect(title).toBeVisible();
    await expect(title).toHaveValue("Open Pages");
    await title.fill("E2E Site");
    await expect(page.getByTestId("settings-save")).toBeEnabled();
    await page.getByTestId("settings-save").click();
    await expect(page.getByTestId("sidebar-site-title")).toHaveText("E2E Site");

    await page.getByTestId("settings-tab-theme").click();
    await page.getByTestId("theme-next").click();
    await expect(page.getByTestId("theme-next")).toHaveClass(/on/);
    await expect(page.getByTestId("theme-settings")).toContainText("NexT");
    await expect(page.getByTestId("theme-setting-color_scheme")).toBeVisible();
    await expect(page.getByTestId("settings-save")).toBeEnabled();
    await page.getByTestId("settings-save").click();
    await expect(page.getByTestId("theme-preview-frame")).toBeVisible({ timeout: 60_000 });

    await page.getByTestId("settings-close").click();
    await expect(page.getByTestId("settings-page")).toHaveCount(0);
    await expect(page.getByTestId("title-input")).toBeVisible();
  });

  test("opens a styled Hexo preview and crawls every local link", async ({ page }) => {
    await boot(page);
    const { popup, failed } = await openHexoPreview(page);
    await expect(popup).toHaveTitle(/Open Pages/);
    await expect(popup.locator("body")).toContainText(/Hello Open Pages|Open Pages/);
    await assertNoBrokenPreviewLinks(popup);
    expect(failed, `preview assets 404: ${failed.join("\n")}`).toEqual([]);

    const header = popup.locator("#header");
    await expect(header).toBeVisible();
    const headerHeight = await header.evaluate((el) => Number.parseFloat(getComputedStyle(el).height));
    expect(headerHeight, "landscape CSS did not apply; header is still unstyled").toBeGreaterThan(40);

    await expect(page.getByTestId("title-input")).toBeVisible();
    await expect(page.getByTestId("toast")).toContainText(/新标签|Hexo 预览/);
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

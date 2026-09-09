import { expect, test, type Page, type Route } from "@playwright/test";

const FAKE_INSTALLED = {
  id: "cocofhu",
  kind: "theme",
  packageName: "hexo-theme-cocofhu",
  label: "cocofhu",
  description: "cocofhu 个人站主题：正在进行 / 最近在做可在设置里展示。",
  source: { type: "npm", packageName: "hexo-theme-cocofhu", version: "1.0.0" },
  settings: [] as unknown[],
  builtin: false,
  tint: { ink: "#2f6f45", paper: "#d8efe0" },
};

async function openThemeSettings(page: Page) {
  await page.goto("/");
  await expect(page.getByTestId("app-shell")).toBeVisible();
  await page.getByTestId("btn-settings").click();
  await expect(page.getByTestId("settings-page")).toBeVisible();
  await expect(page.getByTestId("theme-settings")).toBeVisible();
}

test.describe("theme inline update progress", () => {
  test("update progress stays on the theme cards, not the installer", async ({ page }) => {
    await page.route("**/addons**", async (route: Route) => {
      const request = route.request();

      if (
        request.method() === "POST" &&
        /\/addons\/cocofhu\/update\/?$/.test(new URL(request.url()).pathname)
      ) {
        const body = [
          `data: ${JSON.stringify({ type: "progress", stage: "download", label: "正在下载主题", percent: 40 })}\n\n`,
          `data: ${JSON.stringify({ type: "progress", stage: "register", label: "写入扩展列表", percent: 90 })}\n\n`,
          `data: ${JSON.stringify({ type: "done", addon: FAKE_INSTALLED })}\n\n`,
        ].join("");
        // The frames arrive in one chunk, so pause first to keep the cards in
        // their updating state long enough to assert against.
        await new Promise((resolve) => setTimeout(resolve, 800));
        await route.fulfill({
          status: 200,
          headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
          body,
        });
        return;
      }

      if (request.method() === "GET") {
        const response = await route.fetch();
        const json = (await response.json()) as { addons: Array<Record<string, unknown>> };
        const addons = Array.isArray(json.addons) ? json.addons : [];
        await route.fulfill({
          status: response.status(),
          headers: { ...response.headers(), "content-type": "application/json" },
          body: JSON.stringify({
            addons: [...addons.filter((item) => item.id !== FAKE_INSTALLED.id), FAKE_INSTALLED],
          }),
        });
        return;
      }

      await route.continue();
    });

    await openThemeSettings(page);

    // Select the installed theme so the "当前主题" card offers 更新主题.
    await page.getByTestId("theme-cocofhu").click();
    await expect(page.getByTestId("theme-cocofhu")).toHaveClass(/on/);

    const currentBtn = page.getByTestId("theme-update-current-cocofhu");
    await expect(currentBtn).toHaveText("更新主题");
    const clickPromise = currentBtn.click();

    const cardProgress = page.getByTestId("theme-update-progress-cocofhu");
    await expect(cardProgress).toBeVisible({ timeout: 3_000 });
    await expect(page.getByTestId("theme-update-progress-current-cocofhu")).toBeVisible();
    await expect(currentBtn).toHaveText(/更新中/);

    // Installer must stay idle — this is the regression the inline bars fix.
    await expect(page.getByTestId("addon-progress-theme")).toHaveCount(0);
    await expect(page.getByTestId("addon-install-theme")).toHaveText("安装");

    // Overlay must not resize the equal-height theme grid.
    const heights = await page.evaluate(() => {
      const a = document.querySelector('[data-testid="theme-landscape"]') as HTMLElement | null;
      const b = document.querySelector('[data-testid="theme-cocofhu"]') as HTMLElement | null;
      return {
        landscape: a?.getBoundingClientRect().height ?? 0,
        cocofhu: b?.getBoundingClientRect().height ?? 0,
      };
    });
    expect(Math.abs(heights.landscape - heights.cocofhu)).toBeLessThanOrEqual(1);

    await page.screenshot({ path: "/tmp/theme-update-progress.png", fullPage: false });

    await clickPromise;
    await expect(cardProgress).toHaveCount(0, { timeout: 10_000 });
    await expect(page.getByTestId("theme-update-progress-current-cocofhu")).toHaveCount(0);
    await expect(currentBtn).toHaveText("更新主题");
  });
});

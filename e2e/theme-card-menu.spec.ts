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

async function injectInstalledTheme(page: Page) {
  await page.route("**/addons**", async (route: Route) => {
    if (route.request().method() !== "GET") {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    const json = (await response.json()) as { addons: Array<Record<string, unknown>> };
    const addons = Array.isArray(json.addons) ? json.addons : [];
    if (!addons.some((item) => item.id === FAKE_INSTALLED.id)) {
      addons.push(FAKE_INSTALLED);
    }
    await route.fulfill({
      status: response.status(),
      headers: { ...response.headers(), "content-type": "application/json" },
      body: JSON.stringify({ addons }),
    });
  });
}

test.describe("theme card overflow menu", () => {
  test("grid cards share height; installed actions live in overflow menu", async ({ page }) => {
    await injectInstalledTheme(page);
    await openThemeSettings(page);

    const grid = page.getByTestId("theme-settings");
    await expect(grid.locator(".theme-card-actions")).toHaveCount(0);
    // 13 builtins + injected installed theme
    await expect(grid.locator("button.theme-pick-card")).toHaveCount(14);

    // Builtin landscape: using badge when selected, no ellipsis.
    const landscape = page.getByTestId("theme-landscape");
    await expect(landscape).toBeVisible();
    await expect(page.getByTestId("theme-menu-landscape")).toHaveCount(0);

    // Installed fake theme: ellipsis present, sibling of card (not nested).
    const installedCard = page.getByTestId("theme-cocofhu");
    await expect(installedCard).toBeVisible();
    const menuBtn = page.getByTestId("theme-menu-cocofhu");
    await expect(menuBtn).toBeVisible();
    await expect(menuBtn).toHaveAttribute("aria-label", "主题操作");

    const nested = await installedCard.locator('[data-testid="theme-menu-cocofhu"]').count();
    expect(nested, "ellipsis must be a sibling, not nested inside the card button").toBe(0);

    // Equal outer height between a builtin and the installed card in the same grid.
    const heights = await page.evaluate(() => {
      const a = document.querySelector('[data-testid="theme-landscape"]') as HTMLElement | null;
      const b = document.querySelector('[data-testid="theme-cocofhu"]') as HTMLElement | null;
      return {
        landscape: a?.getBoundingClientRect().height ?? 0,
        cocofhu: b?.getBoundingClientRect().height ?? 0,
      };
    });
    expect(Math.abs(heights.landscape - heights.cocofhu)).toBeLessThanOrEqual(1);

    // Select a builtin first so cocofhu is not in use.
    await landscape.click();
    await expect(landscape).toHaveClass(/on/);
    const beforeTheme = await page.evaluate(() => {
      const on = document.querySelector("button.theme-pick-card.on");
      return on?.getAttribute("data-testid") ?? "";
    });

    await menuBtn.click();
    await expect(page.getByTestId("theme-update-cocofhu")).toBeVisible();
    await expect(page.getByTestId("theme-remove-cocofhu")).toBeVisible();
    await expect(page.getByTestId("theme-remove-cocofhu")).toBeEnabled();

    // Opening the menu must not switch the selected theme.
    const afterOpen = await page.evaluate(() => {
      const on = document.querySelector("button.theme-pick-card.on");
      return on?.getAttribute("data-testid") ?? "";
    });
    expect(afterOpen).toBe(beforeTheme);

    // Escape closes and returns focus to the trigger.
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("theme-update-cocofhu")).toHaveCount(0);
    await expect(menuBtn).toBeFocused();

    // Click card face still selects the installed theme; using + ellipsis side by side.
    await installedCard.click();
    await expect(installedCard).toHaveClass(/on/);
    const cluster = page.locator(".theme-pick-wrap", { has: installedCard }).locator(".theme-pick-cluster");
    await expect(cluster.locator(".theme-pick-using")).toHaveText("使用中");
    await expect(cluster.getByTestId("theme-menu-cocofhu")).toBeVisible();

    await menuBtn.click();
    const remove = page.getByTestId("theme-remove-cocofhu");
    await expect(remove).toBeDisabled();
    await expect(remove).toHaveAttribute("title", "正在使用的主题不能卸载");
    await expect(page.getByTestId("theme-update-cocofhu")).toBeEnabled();

    // Outside click closes.
    await page.getByTestId("settings-page").click({ position: { x: 8, y: 8 } });
    await expect(page.getByTestId("theme-update-cocofhu")).toHaveCount(0);

    // Only one menu open at a time — reopen, then open would need a second installed;
    // with one installed, re-open after selecting landscape again still works.
    await landscape.click();
    await menuBtn.click();
    await expect(page.getByTestId("theme-update-cocofhu")).toBeVisible();
    await page.keyboard.press("Escape");

    await page.screenshot({
      path: "/tmp/theme-grid-overflow.png",
      fullPage: false,
    });
    await installedCard.click();
    await menuBtn.click();
    await page.screenshot({
      path: "/tmp/theme-menu-open-in-use.png",
      fullPage: false,
    });
  });

  test("builtin theme enumeration still uses button.theme-pick-card", async ({ page }) => {
    await openThemeSettings(page);
    const offered = await page
      .locator('[data-testid="theme-settings"] button.theme-pick-card')
      .evaluateAll((cards) =>
        cards
          .map((card) => card.getAttribute("data-testid") ?? "")
          .map((id) => id.replace(/^theme-/, ""))
          .filter(Boolean),
      );
    expect(offered.length).toBeGreaterThanOrEqual(13);
    expect(offered).toContain("landscape");
    expect(offered).toContain("next");
    // No ellipsis on builtins.
    for (const id of offered) {
      await expect(page.getByTestId(`theme-menu-${id}`)).toHaveCount(0);
    }
    await page.screenshot({ path: "/tmp/theme-grid-builtins.png", fullPage: false });
  });
});

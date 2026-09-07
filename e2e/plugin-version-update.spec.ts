import { expect, test, type Page, type Route } from "@playwright/test";

const FAKE_USER_PLUGIN = {
  id: "generator-sitemap",
  kind: "plugin",
  packageName: "hexo-generator-sitemap",
  label: "generator-sitemap",
  description: "站点地图",
  installedVersion: "1.2.0",
  source: { type: "npm", packageName: "hexo-generator-sitemap", version: "1.2.0" },
  settings: [] as unknown[],
  builtin: false,
  enabled: true,
};

async function openPluginSettings(page: Page) {
  await page.goto("/");
  await expect(page.getByTestId("app-shell")).toBeVisible();
  await page.getByTestId("btn-settings").click();
  await expect(page.getByTestId("settings-page")).toBeVisible();
  await page.getByTestId("settings-tab-plugin").click();
  await expect(page.getByTestId("plugin-settings")).toBeVisible();
}

function withPlugin(
  addons: Array<Record<string, unknown>>,
  version: string,
): Array<Record<string, unknown>> {
  const next = {
    ...FAKE_USER_PLUGIN,
    installedVersion: version,
    source: { ...FAKE_USER_PLUGIN.source, version },
  };
  return [...addons.filter((item) => item.id !== FAKE_USER_PLUGIN.id), next];
}

test.describe("plugin version and inline update", () => {
  test("plugin rows show installed versions including builtins", async ({ page }) => {
    await page.route("**/addons**", async (route: Route) => {
      if (route.request().method() !== "GET") {
        await route.continue();
        return;
      }
      const response = await route.fetch();
      const json = (await response.json()) as { addons: Array<Record<string, unknown>> };
      await route.fulfill({
        status: response.status(),
        headers: { ...response.headers(), "content-type": "application/json" },
        body: JSON.stringify({ addons: withPlugin(json.addons ?? [], "1.2.0") }),
      });
    });

    await openPluginSettings(page);

    const marked = page.getByTestId("plugin-version-hexo-renderer-marked");
    await expect(marked).toBeVisible();
    await expect(marked).not.toHaveText("未知版本");
    await expect(marked).toHaveText(/^v\d/);

    await expect(page.getByTestId("plugin-version-generator-sitemap")).toHaveText("v1.2.0");
    await expect(page.getByTestId("plugin-update-generator-sitemap")).toBeVisible();
    await expect(page.getByTestId("plugin-update-hexo-renderer-marked")).toHaveCount(0);
  });

  test("update progress stays on the plugin row, not the installer", async ({ page }) => {
    let listedVersion = "1.2.0";

    await page.route("**/addons**", async (route: Route) => {
      const request = route.request();
      const url = request.url();

      if (request.method() === "POST" && /\/addons\/generator-sitemap\/update\/?$/.test(new URL(url).pathname)) {
        listedVersion = "1.3.0";
        const body = [
          `data: ${JSON.stringify({ type: "progress", stage: "download", label: "正在下载依赖", percent: 40 })}\n\n`,
          `data: ${JSON.stringify({ type: "progress", stage: "register", label: "写入扩展列表", percent: 90 })}\n\n`,
          `data: ${JSON.stringify({
            type: "done",
            addon: {
              ...FAKE_USER_PLUGIN,
              installedVersion: "1.3.0",
              source: { ...FAKE_USER_PLUGIN.source, version: "1.3.0" },
            },
          })}\n\n`,
        ].join("");
        // Delay after first progress frame would be nicer as a stream; a short pause
        // keeps the row in updating state long enough for assertions.
        await new Promise((resolve) => setTimeout(resolve, 800));
        await route.fulfill({
          status: 200,
          headers: {
            "content-type": "text/event-stream",
            "cache-control": "no-cache",
          },
          body,
        });
        return;
      }

      if (request.method() === "GET") {
        const response = await route.fetch();
        const json = (await response.json()) as { addons: Array<Record<string, unknown>> };
        await route.fulfill({
          status: response.status(),
          headers: { ...response.headers(), "content-type": "application/json" },
          body: JSON.stringify({ addons: withPlugin(json.addons ?? [], listedVersion) }),
        });
        return;
      }

      await route.continue();
    });

    await openPluginSettings(page);
    await expect(page.getByTestId("plugin-version-generator-sitemap")).toHaveText("v1.2.0");

    const updateBtn = page.getByTestId("plugin-update-generator-sitemap");
    const clickPromise = updateBtn.click();

    await expect(page.getByTestId("plugin-update-progress-generator-sitemap")).toBeVisible({
      timeout: 3_000,
    });
    await expect(page.getByTestId("addon-progress-plugin")).toHaveCount(0);
    await expect(page.getByTestId("addon-install-plugin")).toHaveText("安装");
    await expect(updateBtn).toHaveText(/更新中/);

    await clickPromise;
    await expect(page.getByTestId("plugin-version-generator-sitemap")).toHaveText("v1.3.0", {
      timeout: 10_000,
    });
    await expect(page.getByTestId("plugin-update-progress-generator-sitemap")).toHaveCount(0);
    await expect(updateBtn).toHaveText("更新");
  });
});

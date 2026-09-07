import { expect, test, type Page } from "@playwright/test";

async function mockLoggedIn(page: Page) {
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
  await page.route("**/auth/logout", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true }),
    });
  });
  await page.route("**/sites/*/reset", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true }),
    });
  });
  await page.route("**/pages-domain**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ customDomain: "" }),
    });
  });
}

async function seedBoundSite(page: Page, opts: { withMatchingOrigin: boolean; editLive?: boolean }) {
  const summary = await page.evaluate(async ({ withMatchingOrigin, editLive }) => {
    const isLive = (path: string) => {
      const normalized = path.replaceAll("\\", "/");
      if (normalized.startsWith("source/origin/")) return false;
      if (normalized === "manifest.json" || normalized === "README.md") return false;
      if (normalized === "_config.yml") return true;
      // Theme configs like _config.landscape.yml are live import paths.
      if (/^_config\.[^/]+\.yml$/i.test(normalized)) return true;
      if (normalized.startsWith("source/")) return true;
      return false;
    };

    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open("open-pages", 1);
      req.onupgradeneeded = () => {
        const database = req.result;
        if (!database.objectStoreNames.contains("files")) {
          database.createObjectStore("files", { keyPath: "path" });
        }
        if (!database.objectStoreNames.contains("meta")) {
          database.createObjectStore("meta", { keyPath: "key" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

    const files = await new Promise<
      Array<{ path: string; content: string; encoding: "utf8" | "base64" }>
    >((resolve, reject) => {
      const tx = db.transaction("files", "readonly");
      const req = tx.objectStore("files").getAll();
      req.onsuccess = () =>
        resolve((req.result as Array<{ path: string; content: string; encoding: "utf8" | "base64" }>) ?? []);
      req.onerror = () => reject(req.error);
    });

    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(["files", "meta"], "readwrite");
      const fileStore = tx.objectStore("files");
      const metaStore = tx.objectStore("meta");

      for (const row of files) {
        if (row.path.startsWith("source/origin/")) fileStore.delete(row.path);
      }

      const live = files.filter((file) => isLive(file.path));
      for (const row of live) {
        let content = row.content;
        if (editLive && row.path.includes("source/_posts/")) {
          content = `${content}\n\n<!-- local unpublished edit -->\n`;
        }
        fileStore.put({
          path: row.path,
          content,
          encoding: row.encoding || "utf8",
          updatedAt: Date.now(),
        });
        if (withMatchingOrigin) {
          // editLive: live has marker, origin keeps pre-edit → dirty.
          // clean: origin equals the live content we just wrote.
          fileStore.put({
            path: `source/origin/${row.path}`,
            content: editLive ? row.content : content,
            encoding: row.encoding || "utf8",
            updatedAt: Date.now(),
          });
        }
      }

      const getReq = metaStore.get("default");
      getReq.onsuccess = () => {
        const row = (getReq.result as Record<string, unknown> | undefined) ?? {
          key: "default",
          config: { title: "本地站点" },
          updatedAt: Date.now(),
        };
        metaStore.put({
          ...row,
          github: {
            owner: "cocofhu",
            repo: "introduction",
            defaultBranch: "main",
            pagesUrl: "https://cocofhu.github.io/introduction/",
            // Explicit empty string: settings must not prefetch remote cname into draft.
            customDomain: "",
          },
          updatedAt: Date.now(),
        });
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

    const after = await new Promise<
      Array<{ path: string; content: string; encoding: string }>
    >((resolve, reject) => {
      const tx = db.transaction("files", "readonly");
      const req = tx.objectStore("files").getAll();
      req.onsuccess = () => resolve((req.result as Array<{ path: string; content: string; encoding: string }>) ?? []);
      req.onerror = () => reject(req.error);
    });
    db.close();

    const byPath = new Map(after.map((file) => [file.path, file]));
    const origins = after.filter((file) => file.path.startsWith("source/origin/"));
    let unpublished = false;
    if (!origins.length) {
      unpublished = after.some((file) => isLive(file.path));
    } else {
      for (const file of after) {
        if (!isLive(file.path)) continue;
        const origin = byPath.get(`source/origin/${file.path}`);
        if (!origin || origin.content !== file.content || origin.encoding !== file.encoding) {
          unpublished = true;
          break;
        }
      }
    }
    return {
      liveCount: after.filter((file) => isLive(file.path)).length,
      originCount: origins.length,
      unpublished,
      paths: after.map((file) => file.path).sort(),
    };
  }, opts);

  expect(summary.liveCount, `seed live files: ${JSON.stringify(summary)}`).toBeGreaterThan(0);
  if (opts.withMatchingOrigin && !opts.editLive) {
    expect(summary.unpublished, `expected clean baseline: ${JSON.stringify(summary)}`).toBe(false);
  }
  if (opts.editLive) {
    expect(summary.unpublished, `expected dirty baseline: ${JSON.stringify(summary)}`).toBe(true);
  }
  return summary;
}

async function bootBound(page: Page, seed: { withMatchingOrigin: boolean; editLive?: boolean }) {
  await mockLoggedIn(page);
  await page.goto("/");
  await expect(page.getByTestId("app-shell")).toBeVisible();
  await expect(page.getByTestId("title-input")).toBeVisible();
  await seedBoundSite(page, seed);
  await page.reload();
  await expect(page.getByTestId("app-shell")).toBeVisible();
  await expect(page.getByTestId("title-input")).toBeVisible();
}

test.describe("publish origin baseline + logout wipe", () => {
  test("settings bind card shows 已是最新版 when origin matches live", async ({ page }) => {
    await bootBound(page, { withMatchingOrigin: true });
    await page.goto("/#/settings/site");
    await expect(page.getByTestId("settings-page")).toBeVisible();
    await expect(page.locator(".settings-repo-name")).toContainText("@cocofhu/introduction");
    await expect(page.getByTestId("settings-repo-status")).toHaveText("已是最新版。", {
      timeout: 10_000,
    });
    await page.screenshot({ path: "/tmp/op-e2e-screenshots/01-latest-version.png", fullPage: true });
  });

  test("settings bind card warns when live diverges from origin", async ({ page }) => {
    await bootBound(page, { withMatchingOrigin: true, editLive: true });
    await page.goto("/#/settings/site");
    await expect(page.getByTestId("settings-page")).toBeVisible();
    await expect(page.getByTestId("settings-repo-status")).toContainText("还没发布的改动会丢掉");
    await page.screenshot({ path: "/tmp/op-e2e-screenshots/02-unpublished-warn.png", fullPage: true });
  });

  test("logout cancel keeps binding; confirm wipes and shows onboarding", async ({ page }) => {
    await bootBound(page, { withMatchingOrigin: true });
    await expect(page.getByTestId("user-login")).toHaveText("e2e-user");

    await page.getByTestId("btn-account").click();
    await page.getByTestId("btn-logout").click();
    await expect(page.getByTestId("dialog-confirm")).toBeVisible();
    await expect(page.getByTestId("dialog-confirm")).toContainText("不会删除你的 GitHub");
    await page.screenshot({ path: "/tmp/op-e2e-screenshots/03-logout-confirm.png", fullPage: true });

    await page.getByRole("button", { name: "取消" }).click();
    await expect(page.getByTestId("dialog-confirm")).toHaveCount(0);
    await expect(page.getByTestId("app-shell")).toBeVisible();
    await expect(page.getByTestId("user-login")).toHaveText("e2e-user");

    await page.goto("/#/settings/site");
    await expect(page.getByTestId("settings-page")).toBeVisible();
    await expect(page.locator(".settings-repo-name")).toContainText("@cocofhu/introduction");
    await page.screenshot({ path: "/tmp/op-e2e-screenshots/04-cancel-keeps-binding.png", fullPage: true });
    await page.getByTestId("settings-close").click();
    await expect(page.getByTestId("settings-page")).toHaveCount(0);

    await page.getByTestId("btn-account").click();
    await page.getByTestId("btn-logout").click();
    await expect(page.getByTestId("dialog-confirm")).toBeVisible();
    await page.getByTestId("confirm-ok").click();
    await expect(page.getByTestId("repo-onboarding")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("app-shell")).toHaveCount(0);
    await expect(page.getByTestId("title-input")).toHaveCount(0);
    await page.screenshot({ path: "/tmp/op-e2e-screenshots/05-onboarding-after-wipe.png", fullPage: true });
  });
});

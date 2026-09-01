import { expect, test, type Page } from "@playwright/test";
import {
  MEASURE_VISIBLE_TEXT,
  describeMeasured,
  previewVerdict,
  type Measured,
} from "./preview-visibility";

/**
 * Every built-in theme gets its own preview check, because "hexo generate
 * succeeded" and "the user sees a page" are different claims: a theme can build
 * cleanly and still render an empty frame. Each case drives the real editor UI,
 * so it covers the whole chain — generate, the preview origin, the sandboxed
 * frame, and the theme's own scripts.
 *
 * The list is duplicated from THEMES in packages/shared on purpose: Playwright
 * needs it at collection time to make one test per theme. The first test below
 * fails if the editor ever offers a different set, so it cannot silently drift.
 */
const BUILTIN_THEMES = [
  "landscape",
  "cactus",
  "next",
  "kaze",
  "stellar",
  "reimu",
  "particlex",
  "stun",
  "white",
  "tranquility",
  "async",
  "apollo",
  "inside",
] as const;

// Generation runs server-side and themes animate their first screen in, so the
// verdict is re-measured on a widening interval rather than after a fixed sleep.
const SETTLE_INTERVALS = [500, 1000, 1500, 2000, 3000];
const SETTLE_TIMEOUT = 60_000;

async function openThemeSettings(page: Page) {
  await page.goto("/");
  await expect(page.getByTestId("app-shell")).toBeVisible();
  await page.getByTestId("btn-settings").click();
  await expect(page.getByTestId("settings-page")).toBeVisible();
  await expect(page.getByTestId("theme-settings")).toBeVisible();
}

/**
 * Records preview assets the server failed to produce. Requests to the app
 * origin and to theme CDNs are left out: the former is not the preview, and the
 * latter is unreachable from a sealed test machine.
 */
function watchPreviewAssets(page: Page, appOrigin: string): string[] {
  const failed: string[] = [];
  page.on("response", (response) => {
    if (response.status() < 400) return;
    const url = response.url();
    if (!url.includes("/preview/")) return;
    if (new URL(url).origin === appOrigin) return;
    failed.push(`${response.status()} ${url}`);
  });
  return failed;
}

function previewFrame(page: Page) {
  return page.frames().find((candidate) => candidate.url().includes("/preview/"));
}

/**
 * Resolves to null once the theme's first screen is readable, or to a string
 * explaining what is still wrong. Anything unresolved is phrased as a reason so
 * the poll keeps retrying and reports that reason if it never clears.
 */
async function previewProblem(page: Page, appOrigin: string): Promise<string | null> {
  const failure = page.getByTestId("theme-preview-error");
  if (await failure.count()) {
    return `generation failed: ${(await failure.innerText()).replace(/\s+/g, " ").trim()}`;
  }

  const frame = previewFrame(page);
  if (!frame) return "preview frame has not loaded";
  if (new URL(frame.url()).origin === appOrigin) {
    return `preview loaded from the editor origin ${appOrigin}`;
  }

  const measured = (await frame.evaluate(MEASURE_VISIBLE_TEXT).catch(() => null)) as Measured | null;
  if (!measured) return "preview frame was not evaluable yet";
  const verdict = previewVerdict(measured);
  return verdict ? `${verdict} — ${describeMeasured(measured)}` : null;
}

/**
 * Clicks the first internal page link inside the preview and reports where the
 * frame ended up. Rendering the first screen proves nothing about whether the
 * preview is navigable: a page served under the wrong content type renders fine
 * on arrival but aborts every click, because the browser treats the next
 * document as a download.
 *
 * The welcome post is preferred, but any internal page will do — themes that
 * open on a landing page build their post list client-side and link only to
 * their own pages from the first screen.
 */
async function followInternalLink(page: Page, appOrigin: string): Promise<string> {
  const frame = previewFrame(page);
  if (!frame) return "preview frame has not loaded";

  const before = frame.url();
  const href = await frame.evaluate(() => {
    const asset =
      /\.(css|js|mjs|png|jpe?g|gif|svg|ico|webp|avif|woff2?|ttf|otf|eot|xml|json|map|txt|pdf|zip)($|\?)/i;
    const here = location.pathname.replace(/\/+$/, "");
    const candidates = [...document.querySelectorAll("a[href]")].filter((link) => {
      if (link.getAttribute("target")) return false;
      const raw = (link.getAttribute("href") ?? "").trim();
      if (!raw || /^(#|mailto:|javascript:|data:|blob:)/i.test(raw)) return false;
      let resolved: URL;
      try {
        resolved = new URL(raw, location.href);
      } catch {
        return false;
      }
      if (resolved.origin !== location.origin) return false;
      if (asset.test(resolved.pathname)) return false;
      return resolved.pathname.replace(/\/+$/, "") !== here;
    });
    const link =
      candidates.find((candidate) => (candidate.getAttribute("href") ?? "").includes("hello-open-pages"))
      ?? candidates[0];
    if (!link) return null;
    // Tagged rather than matched by href: some themes emit hrefs with stray
    // whitespace, which no attribute selector would find again.
    link.setAttribute("data-op-e2e-target", "1");
    link.scrollIntoView({ block: "center" });
    return new URL(link.getAttribute("href")!.trim(), location.href).pathname;
  });
  if (!href) return "no internal page link on the first screen";

  // The click destroys this execution context on success, which surfaces as a
  // rejected evaluate rather than a failure.
  await frame
    .evaluate(() => {
      document.querySelector<HTMLAnchorElement>("[data-op-e2e-target]")?.click();
    })
    .catch(() => undefined);

  // Polled from the driver: the editor is a different origin, so the page itself
  // cannot read the frame's location, which is exactly what the isolation test
  // asserts.
  try {
    await expect
      .poll(() => previewFrame(page)?.url() ?? before, { timeout: 15_000, intervals: [250, 500, 1000] })
      .not.toBe(before);
  } catch {
    return `click on ${href} did not navigate the preview`;
  }

  const after = previewFrame(page);
  if (!after) return "preview frame disappeared after the click";
  if (new URL(after.url()).origin === appOrigin) {
    return `click escaped to the editor origin ${appOrigin}`;
  }
  return "";
}

async function selectTheme(page: Page, theme: string) {
  const card = page.getByTestId(`theme-${theme}`);
  await expect(card, `theme card ${theme} is missing`).toBeVisible();
  if (!(await card.evaluate((el) => el.classList.contains("on")))) {
    await card.click();
  }
  await expect(card).toHaveClass(/on/);
}

test.describe("built-in theme previews", () => {
  test("the editor offers exactly the built-in themes under test", async ({ page }) => {
    await openThemeSettings(page);
    const offered = await page
      .locator('[data-testid="theme-settings"] button.theme-pick-card')
      .evaluateAll((cards) =>
        cards
          .map((card) => card.getAttribute("data-testid") ?? "")
          .map((id) => id.replace(/^theme-/, ""))
          .filter(Boolean),
      );
    expect(
      offered.sort(),
      "themes.spec.ts must cover every theme the editor offers",
    ).toEqual([...BUILTIN_THEMES].sort());
  });

  test("the preview frame cannot reach the editor it is embedded in", async ({ page }) => {
    await openThemeSettings(page);
    const appOrigin = new URL(page.url()).origin;
    await expect(page.getByTestId("theme-preview-frame")).toBeVisible({ timeout: SETTLE_TIMEOUT });
    await expect
      .poll(() => Boolean(previewFrame(page)), {
        timeout: SETTLE_TIMEOUT,
        message: "preview frame never appeared",
      })
      .toBe(true);

    const isolation = await previewFrame(page)!.evaluate(() => ({
      origin: location.origin,
      cookies: document.cookie,
      parentReachable: (() => {
        try {
          void window.parent.document.title;
          return true;
        } catch {
          return false;
        }
      })(),
      storageUsable: (() => {
        try {
          localStorage.setItem("__probe", "1");
          localStorage.removeItem("__probe");
          return true;
        } catch {
          return false;
        }
      })(),
    }));

    // Theme code is untrusted third-party JavaScript, and it does run. What
    // keeps it harmless is that it runs on an origin holding no session and
    // exposing no app API, so these are the actual security boundary.
    expect(isolation.origin, "preview must not share the editor's origin").not.toBe(appOrigin);
    expect(isolation.cookies, "preview origin must carry no session cookie").toBe("");
    expect(isolation.parentReachable, "preview must not reach the editor DOM").toBe(false);
    // Themes keep their colour-scheme choice here; an opaque origin would make
    // this throw and take the whole theme down with it.
    expect(isolation.storageUsable, "preview frame needs a usable storage origin").toBe(true);
  });

  for (const theme of BUILTIN_THEMES) {
    test(`${theme} renders a visible first screen`, async ({ page }) => {
      await openThemeSettings(page);
      const appOrigin = new URL(page.url()).origin;
      const failedAssets = watchPreviewAssets(page, appOrigin);
      await selectTheme(page, theme);

      await expect
        .poll(() => previewProblem(page, appOrigin), {
          timeout: SETTLE_TIMEOUT,
          intervals: SETTLE_INTERVALS,
          message: `${theme} preview never showed a readable first screen`,
        })
        .toBeNull();

      expect(failedAssets, `${theme} preview assets failed to load`).toEqual([]);

      expect(await followInternalLink(page, appOrigin), `${theme} preview is not navigable`).toBe("");
    });
  }
});

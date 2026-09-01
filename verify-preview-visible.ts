import { createServer } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { chromium } from "@playwright/test";
import { generateSite, scaffoldSite } from "./packages/hexo-runner/src/index.ts";
import {
  DEFAULT_SITE_CONFIG,
  THEMES,
  WELCOME_POST_PATH,
  welcomeMarkdown,
  type ThemeId,
} from "./packages/shared/src/index.ts";
import {
  MEASURE_VISIBLE_TEXT,
  describeMeasured,
  previewVerdict,
  type Measured,
} from "./e2e/preview-visibility.ts";

/**
 * Walks every built-in theme through a real browser and measures the text that
 * is actually hit-testable on the first screen. This is the fast sweep over
 * generate + serve only; `e2e/themes.spec.ts` covers the same ground through
 * the editor UI and the real preview origin.
 */

const VIEWPORT = { width: 1100, height: 900 };

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".xml": "application/xml; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

interface Report extends Measured {
  theme: ThemeId;
  error?: string;
}

function verdict(report: Report): string | null {
  return report.error ?? previewVerdict(report);
}

async function serve(publicDir: string, mount: string) {
  const base = resolve(publicDir);
  const server = createServer(async (req, res) => {
    let path = decodeURIComponent((req.url ?? "/").split("?")[0] ?? "/");
    if (path.startsWith(mount)) path = path.slice(mount.length - 1);
    const rel = normalize(path).replace(/^(\.\.[/\\])+/, "").replace(/^\/+/, "");
    let file = resolve(base, rel || "index.html");
    if (!file.startsWith(base + sep) && file !== base) {
      res.writeHead(403).end("forbidden");
      return;
    }
    if (!extname(file)) file = join(file, "index.html");
    try {
      const body = await readFile(file);
      res.writeHead(200, {
        "content-type": CONTENT_TYPES[extname(file).toLowerCase()] ?? "application/octet-stream",
        "cache-control": "no-store",
      });
      res.end(body);
    } catch {
      res.writeHead(404).end("not found");
    }
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return {
    origin: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((done) => server.close(() => done())),
  };
}

const shotDir = process.env.PREVIEW_SHOT_DIR;
if (shotDir) await mkdir(shotDir, { recursive: true });

const root = await mkdtemp(join(tmpdir(), "open-pages-preview-visible-"));
const selected = process.env.THEME
  ? THEMES.filter((theme) => theme === process.env.THEME)
  : [...THEMES];
const reports: Report[] = [];
const browser = await chromium.launch();

try {
  for (const theme of selected) {
    const mount = `/preview/${theme}/`;
    const siteDir = join(root, theme);
    try {
      await scaffoldSite({
        siteDir,
        config: { ...DEFAULT_SITE_CONFIG, theme },
        files: [{ path: WELCOME_POST_PATH, content: welcomeMarkdown(), encoding: "utf8" }],
      });
      const { publicDir } = await generateSite(siteDir, { rebaseRoot: mount });
      const { origin, close } = await serve(publicDir, mount);
      try {
        // The preview frame runs theme scripts, so the check has to as well:
        // most themes only reveal their content once their own JS has run.
        const context = await browser.newContext({ viewport: VIEWPORT });
        const page = await context.newPage();
        try {
          await page.goto(`${origin}${mount}`, { waitUntil: "load", timeout: 60_000 });
          // Themes fade their loader out and run entrance animations after load,
          // so measure only once those have had time to finish.
          await page.waitForTimeout(2500);
          if (shotDir) await page.screenshot({ path: join(shotDir, `${theme}.png`) });
          const measured = (await page.evaluate(MEASURE_VISIBLE_TEXT)) as Measured;
          reports.push({ theme, ...measured });
        } finally {
          await context.close();
        }
      } finally {
        await close();
      }
    } catch (error) {
      reports.push({
        theme,
        visibleChars: 0,
        lowContrastChars: 0,
        transparentChars: 0,
        totalChars: 0,
        overlays: [],
        topAtCenter: "",
        blockers: [],
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
} finally {
  await browser.close();
  if (process.env.KEEP_PREVIEW_WORKSPACES) console.log(`PREVIEW_ROOT ${root}`);
  else await rm(root, { recursive: true, force: true });
}

const failed: Report[] = [];
for (const report of reports) {
  const reason = verdict(report);
  const detail = describeMeasured(report);
  if (reason) {
    failed.push(report);
    console.error(`PREVIEW_BLANK ${report.theme} ${detail} reason=${reason}`);
  } else {
    console.log(`PREVIEW_OK ${report.theme} ${detail}`);
  }
}

if (failed.length) {
  throw new Error(
    `Preview first screen renders blank:\n${failed.map((r) => r.theme).join("\n")}`,
  );
}

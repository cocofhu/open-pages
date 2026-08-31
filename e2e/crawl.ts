import { expect, type Page } from "@playwright/test";

const SKIP = /^(#|mailto:|javascript:|data:|blob:)/i;
const ASSET = /\.(js|css|png|jpe?g|gif|ico|svg|xml|json|woff2?|map)($|\?)/i;

export async function crawlPreview(popup: Page, previewPrefix = "/preview/default") {
  const origin = new URL(popup.url()).origin;
  const start = new URL(previewPrefix.endsWith("/") ? previewPrefix : `${previewPrefix}/`, origin).href;
  const queue = [start];
  const seen = new Set<string>();
  const missing: string[] = [];
  const pages: string[] = [];

  while (queue.length && seen.size < 120) {
    const current = normalize(queue.shift()!);
    if (seen.has(current)) continue;
    seen.add(current);
    if (!current.startsWith(`${origin}${previewPrefix}`)) continue;

    const response = await popup.request.get(current);
    const status = response.status();
    const contentType = response.headers()["content-type"] ?? "";
    const body = await response.text();
    if (status >= 400 || isJsonNotFound(body)) {
      missing.push(`${status} ${current}`);
      continue;
    }
    if (contentType.includes("html") || current.endsWith("/") || current.endsWith(".html")) {
      pages.push(current);
      enqueue(queue, seen, extractHtmlUrls(body, current), origin, previewPrefix);
    }
    if (contentType.includes("css") || current.includes(".css")) {
      enqueue(queue, seen, extractCssUrls(body, current), origin, previewPrefix);
    }
  }

  return { seen: [...seen], pages, missing };
}

export async function assertNoBrokenPreviewLinks(popup: Page, previewPrefix = "/preview/default") {
  const required = [
    `${previewPrefix}/`,
    `${previewPrefix}/atom.xml`,
    `${previewPrefix}/archives/`,
  ];
  for (const path of required) {
    const response = await popup.request.get(path);
    const body = await response.text();
    expect(response.status(), path).toBe(200);
    expect(body, path).not.toMatch(/"error"\s*:\s*"Not found"/);
  }

  const atom = await popup.request.get(`${previewPrefix}/atom.xml`);
  const atomBody = await atom.text();
  expect(atomBody).toMatch(/<feed[\s>]|<rss[\s>]/);

  const { missing, pages } = await crawlPreview(popup, previewPrefix);
  expect(pages.length, "preview crawl found no HTML pages").toBeGreaterThan(0);
  expect(missing, `broken preview URLs:\n${missing.join("\n")}`).toEqual([]);
}

export async function collectFailedAssets(page: Page, failed: string[]) {
  page.on("response", (response) => {
    const url = response.url();
    if (response.status() >= 400 && (ASSET.test(url) || url.includes("/preview/"))) {
      failed.push(`${response.status()} ${url}`);
    }
  });
}

function isJsonNotFound(body: string): boolean {
  return /"error"\s*:\s*"Not found"/.test(body.trim());
}

function extractHtmlUrls(html: string, base: string): string[] {
  const found: string[] = [];
  const attr = /(?:href|src|poster|action)=["']([^"']+)["']/gi;
  let match: RegExpExecArray | null;
  while ((match = attr.exec(html))) {
    found.push(resolveUrl(base, match[1] ?? "") ?? "");
  }
  return found.filter(Boolean);
}

function extractCssUrls(css: string, base: string): string[] {
  const found: string[] = [];
  const re = /url\((['"]?)([^'")]+)\1\)/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(css))) {
    found.push(resolveUrl(base, match[2] ?? "") ?? "");
  }
  return found.filter(Boolean);
}

function enqueue(
  queue: string[],
  seen: Set<string>,
  urls: string[],
  origin: string,
  previewPrefix: string,
) {
  for (const url of urls) {
    if (!url.startsWith(origin)) continue;
    if (!url.includes(previewPrefix)) continue;
    const next = normalize(url);
    if (!seen.has(next) && !queue.includes(next)) queue.push(next);
  }
}

function resolveUrl(base: string, raw: string): string | null {
  const href = raw.trim();
  if (!href || SKIP.test(href)) return null;
  try {
    const url = new URL(href, base);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
}

function normalize(url: string): string {
  const parsed = new URL(url);
  parsed.hash = "";
  if (parsed.pathname.endsWith("/index.html")) {
    parsed.pathname = parsed.pathname.slice(0, -"index.html".length);
  }
  return parsed.href;
}

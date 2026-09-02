import { expect, type Page } from "@playwright/test";

const SKIP = /^(#|mailto:|javascript:|data:|blob:)/i;
const ASSET = /\.(js|css|png|jpe?g|gif|ico|svg|xml|json|woff2?|map)($|\?)/i;

/**
 * A preview lives at /preview/<capability key>/ on its own origin, so the crawl
 * scope is read off the preview URL rather than hard-coded. The preview now
 * renders in an in-app iframe, so callers pass the frame's src here and hand in
 * the editor page purely for its request context.
 */
export function previewScopeFrom(href: string): { origin: string; prefix: string } {
  const url = new URL(href);
  const [, mount, key] = url.pathname.split("/");
  return { origin: url.origin, prefix: `/${mount}/${key}` };
}

function previewScope(popup: Page): { origin: string; prefix: string } {
  return previewScopeFrom(popup.url());
}

export async function crawlPreview(popup: Page, scope = previewScope(popup)) {
  const { origin, prefix: previewPrefix } = scope;
  const start = new URL(`${previewPrefix}/`, origin).href;
  const queue = [start];
  const seen = new Set<string>();
  const missing: string[] = [];
  const pages: string[] = [];
  const mistyped: string[] = [];

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

    const looksLikePage = current.endsWith("/") || current.endsWith(".html");
    // A page served as anything but HTML is a link the browser refuses to
    // navigate to: it downloads the response instead. Trusting the URL shape
    // here once hid exactly that bug, so the header is checked on its own.
    if (looksLikePage && !contentType.includes("html")) {
      mistyped.push(`${current} -> ${contentType || "(none)"}`);
    }
    // Nothing a preview serves should ever arrive as a download, whatever the
    // URL looks like.
    if (contentType.includes("octet-stream") || response.headers()["content-disposition"]) {
      mistyped.push(`${current} -> ${contentType} (browser would download this)`);
    }
    if (contentType.includes("html") || looksLikePage) {
      pages.push(current);
      enqueue(queue, seen, extractHtmlUrls(body, current), origin, previewPrefix);
    }
    if (contentType.includes("css") || current.includes(".css")) {
      enqueue(queue, seen, extractCssUrls(body, current), origin, previewPrefix);
    }
  }

  return { seen: [...seen], pages, missing, mistyped };
}

export async function assertNoBrokenPreviewLinks(popup: Page, scope = previewScope(popup)) {
  // The preview is on a different origin than the app, so every probe has to be
  // an absolute URL; a relative one would resolve against the test baseURL.
  const base = `${scope.origin}${scope.prefix}`;
  for (const path of [`${base}/`, `${base}/atom.xml`, `${base}/archives/`]) {
    const response = await popup.request.get(path);
    const body = await response.text();
    expect(response.status(), path).toBe(200);
    expect(body, path).not.toMatch(/"error"\s*:\s*"Not found"/);
  }

  const atom = await popup.request.get(`${base}/atom.xml`);
  const atomBody = await atom.text();
  expect(atomBody).toMatch(/<feed[\s>]|<rss[\s>]/);

  const { missing, pages, mistyped } = await crawlPreview(popup, scope);
  expect(pages.length, "preview crawl found no HTML pages").toBeGreaterThan(0);
  expect(missing, `broken preview URLs:\n${missing.join("\n")}`).toEqual([]);
  expect(mistyped, `preview pages not served as HTML:\n${mistyped.join("\n")}`).toEqual([]);
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

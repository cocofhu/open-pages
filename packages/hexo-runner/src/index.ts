import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, rm, writeFile, readFile, cp, symlink, lstat, readdir, stat } from "node:fs/promises";
import { deflateSync } from "node:zlib";
import {
  type SiteConfig,
  type SiteFile,
  THEME_META,
  type ThemeId,
  applySiteConfigToYaml,
  defaultHexoConfigYaml,
  defaultThemeSettings,
  isUserEditablePath,
  parseThemeSettings,
  resolvedColorScheme,
  serializeThemeSettings,
  themeConfigPath,
} from "@open-pages/shared";

const require = createRequire(import.meta.url);
const runnerRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const runnerNodeModules = join(runnerRoot, "node_modules");
const generateWorkerPath = fileURLToPath(new URL("./generate-worker.mjs", import.meta.url));

const GENERATE_TIMEOUT_MS = 60_000;
const GENERATE_KILL_GRACE_MS = 5_000;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_FILES = 200;
const MAX_PUBLIC_FILES = 500;
const MAX_PUBLIC_BYTES = 20 * 1024 * 1024;

function assertInside(root: string, target: string): string {
  const base = resolve(root);
  const abs = resolve(target);
  if (abs !== base && !abs.startsWith(base + sep)) {
    throw new Error(`Path not allowed: ${target}`);
  }
  return abs;
}

const COMMON_SITE_DEPENDENCIES = {
  hexo: "^7.3.0",
  "hexo-fs": "^4.1.3",
  "hexo-generator-archive": "^2.0.0",
  "hexo-generator-category": "^2.0.0",
  "hexo-generator-feed": "^3.0.0",
  "hexo-generator-index": "^4.0.0",
  "hexo-generator-search": "^2.4.3",
  "hexo-generator-tag": "^2.0.0",
  "hexo-log": "^4.1.0",
  "hexo-pagination": "^3.0.0",
  "hexo-renderer-ejs": "^2.0.0",
  "hexo-renderer-marked": "^7.0.1",
  "hexo-renderer-pug": "^3.0.0",
  "hexo-renderer-stylus": "^3.0.1",
  "hexo-util": "^3.3.0",
  nunjucks: "^3.2.4",
};

const THEME_PACKAGES: Record<ThemeId, string> = {
  landscape: "^1.1.0",
  cactus: "github:probberechts/hexo-theme-cactus",
  next: "^8.25.0",
  kaze: "^1.0.5",
  stellar: "^1.44.0",
  reimu: "^1.12.6",
  particlex: "^2.8.1",
  stun: "^2.8.0",
  white: "^1.0.8",
  tranquility: "^1.7.1",
  async: "^2.2.7",
  apollo: "^1.0.6",
  inside: "^2.7.2",
};

const THEME_EXTRA_DEPENDENCIES: Partial<Record<ThemeId, Record<string, string>>> = {
  async: {
    "hexo-renderer-less": "^4.0.0",
  },
  particlex: {
    "hexo-helper-crypto": "^1.2.1",
  },
  white: {
    "hexo-renderer-dartsass": "^1.2.0",
  },
};

function siteDependencies(theme: ThemeId): Record<string, string> {
  return {
    ...COMMON_SITE_DEPENDENCIES,
    ...THEME_EXTRA_DEPENDENCIES[theme],
    [THEME_META[theme].packageName]: THEME_PACKAGES[theme],
  };
}

const FAVICON_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

async function writeSiteManifest(siteDir: string, theme: ThemeId): Promise<void> {
  await writeFile(
    join(siteDir, "package.json"),
    JSON.stringify(
      {
        name: "open-pages-site",
        private: true,
        hexo: {},
        dependencies: siteDependencies(theme),
      },
      null,
      2,
    ),
  );
}

export interface ScaffoldOptions {
  siteDir: string;
  config: SiteConfig;
  files?: SiteFile[];
}

export interface GenerateResult {
  publicDir: string;
  elapsedMs: number;
}

const inflight = new Map<string, Promise<GenerateResult>>();

export async function scaffoldSite(options: ScaffoldOptions): Promise<void> {
  const { siteDir, config } = options;
  await mkdir(join(siteDir, "source/_posts"), { recursive: true });
  await mkdir(join(siteDir, "source/_drafts"), { recursive: true });
  await mkdir(join(siteDir, "source/images"), { recursive: true });
  await mkdir(join(siteDir, "themes"), { recursive: true });

  await writeSiteManifest(siteDir, config.theme);
  await writeFile(
    join(siteDir, themeConfigPath(config.theme)),
    serializeThemeSettings(config.theme, defaultThemeSettings(config.theme)),
  );
  await writeFile(join(siteDir, "source/favicon.png"), FAVICON_PNG);
  await writeFile(join(siteDir, "source/favicon.ico"), FAVICON_PNG);

  await writeFile(join(siteDir, "_config.yml"), defaultHexoConfigYaml(config));
  await linkNodeModules(siteDir);
  await ensureTheme(siteDir, config.theme);
  if (options.files?.length) {
    await writeUserFiles(siteDir, options.files);
  }
}

export async function writeUserFiles(siteDir: string, files: SiteFile[]): Promise<void> {
  if (files.length > MAX_FILES) {
    throw new Error(`Too many files (max ${MAX_FILES})`);
  }
  for (const file of files) {
    if (!isUserEditablePath(file.path)) {
      throw new Error(`Path not allowed: ${file.path}`);
    }
    const bytes =
      file.encoding === "base64"
        ? Buffer.from(file.content, "base64").length
        : Buffer.byteLength(file.content, "utf8");
    if (bytes > MAX_FILE_BYTES) {
      throw new Error(`File too large: ${file.path}`);
    }
    const abs = assertInside(siteDir, join(siteDir, file.path));
    await mkdir(dirname(abs), { recursive: true });
    if (file.encoding === "base64") {
      await writeFile(abs, Buffer.from(file.content, "base64"));
    } else {
      await writeFile(abs, file.content, "utf8");
    }
  }
}

export async function updateSiteConfig(siteDir: string, config: SiteConfig): Promise<void> {
  const configPath = join(siteDir, "_config.yml");
  let existing = "";
  try {
    existing = await readFile(configPath, "utf8");
  } catch {
    existing = "";
  }
  await writeFile(configPath, applySiteConfigToYaml(config, existing));
  await ensureTheme(siteDir, config.theme);
  const themePath = join(siteDir, themeConfigPath(config.theme));
  try {
    await stat(themePath);
  } catch {
    await writeFile(themePath, serializeThemeSettings(config.theme, defaultThemeSettings(config.theme)));
  }
}

export async function generateSite(
  siteDir: string,
  options: { rebaseRoot?: string } = {},
): Promise<GenerateResult> {
  const key = resolve(siteDir);
  const existing = inflight.get(key);
  if (existing) return existing;

  const job = runGenerate(siteDir, options).finally(() => {
    inflight.delete(key);
  });
  inflight.set(key, job);
  return job;
}

async function runGenerate(
  siteDir: string,
  options: { rebaseRoot?: string },
): Promise<GenerateResult> {
  const started = Date.now();
  const theme = await readThemeId(siteDir);
  await writeSiteManifest(siteDir, theme);
  await linkNodeModules(siteDir);
  await ensureFeedConfig(siteDir);
  await ensureTheme(siteDir, theme);
  try {
    await writeFile(join(siteDir, "source/favicon.png"), FAVICON_PNG, { flag: "wx" });
  } catch {
    // already present
  }
  try {
    await writeFile(join(siteDir, "source/favicon.ico"), FAVICON_PNG, { flag: "wx" });
  } catch {
    // already present
  }
  await rm(join(siteDir, "public"), { recursive: true, force: true });
  await rm(join(siteDir, "db.json"), { force: true });
  await ensureMarkedSanitize(siteDir);
  await runHexoInWorker(siteDir);

  const publicDir = join(siteDir, "public");
  await assertGeneratedIndex(publicDir);
  await polishPublicDir(publicDir, options.rebaseRoot);
  await applyForcedColorScheme(siteDir, publicDir);
  await fillMissingThemeImages(publicDir, options.rebaseRoot);
  return {
    publicDir,
    elapsedMs: Date.now() - started,
  };
}

export async function listPublicFiles(publicDir: string): Promise<SiteFile[]> {
  const files: SiteFile[] = [];
  const root = resolve(publicDir);
  await walk(root, root, files, { bytes: 0 });
  return files;
}

async function walk(
  root: string,
  dir: string,
  files: SiteFile[],
  tally: { bytes: number },
): Promise<void> {
  let entries: string[] = [];
  try {
    entries = await readdir(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    const abs = resolve(dir, name);
    if (!abs.startsWith(root + sep) && abs !== root) continue;
    const stat = await lstat(abs);
    if (stat.isDirectory()) {
      await walk(root, abs, files, tally);
      continue;
    }
    if (files.length >= MAX_PUBLIC_FILES) {
      throw new Error(`Too many files (max ${MAX_PUBLIC_FILES})`);
    }
    const rel = abs.slice(root.length + 1).replaceAll("\\", "/");
    const buf = await readFile(abs);
    tally.bytes += buf.length;
    if (tally.bytes > MAX_PUBLIC_BYTES) {
      throw new Error("File too large: public/");
    }
    const isText = /\.(html?|css|js|xml|json|txt|svg)$/i.test(rel);
    files.push({
      path: rel,
      content: isText ? buf.toString("utf8") : buf.toString("base64"),
      encoding: isText ? "utf8" : "base64",
    });
  }
}

async function ensureTheme(siteDir: string, theme: ThemeId): Promise<void> {
  const dest = join(siteDir, "themes", theme);
  const marker = join(dest, ".open-pages-theme");
  try {
    const existing = await readFile(marker, "utf8");
    if (existing.trim() === theme) return;
  } catch {
    // missing or incomplete copy
  }
  const src = resolveThemePackage(theme);
  await rm(dest, { recursive: true, force: true });
  await mkdir(dirname(dest), { recursive: true });
  // Copy instead of symlink so theme scripts resolve hexo-util / hexo-fs
  // from the site node_modules instead of the pnpm store path.
  // Skip the theme's own node_modules so a nested semver@6 cannot shadow ours.
  await cp(src, dest, {
    recursive: true,
    dereference: false,
    filter: (from) => !from.slice(src.length).split(sep).includes("node_modules"),
  });
  await writeFile(marker, `${theme}\n`);
}

function resolveThemePackage(theme: ThemeId): string {
  const pkg = THEME_META[theme].packageName;
  try {
    return dirname(require.resolve(`${pkg}/package.json`, { paths: [runnerRoot] }));
  } catch {
    return join(runnerNodeModules, pkg);
  }
}

async function linkNodeModules(siteDir: string): Promise<void> {
  const dest = join(siteDir, "node_modules");
  try {
    const stat = await lstat(dest);
    if (stat.isSymbolicLink() || stat.isDirectory()) return;
  } catch {
    // missing
  }
  try {
    await symlink(runnerNodeModules, dest, "dir");
  } catch {
    // already linked
  }
}

async function ensureFeedConfig(siteDir: string): Promise<void> {
  const configPath = join(siteDir, "_config.yml");
  let raw = "";
  try {
    raw = await readFile(configPath, "utf8");
  } catch {
    return;
  }
  if (!/^feed:/m.test(raw)) {
    raw += `
feed:
  enable: true
  type: atom
  path: atom.xml
  limit: 20
  content: false
`;
  }
  if (!/^search:/m.test(raw)) {
    raw += `
search:
  path: search.xml
  field: post
  content: true
`;
  }
  await writeFile(configPath, raw);
}

const MARKED_BLOCK = `marked:
  dompurify: true
  sanitizeUrl: true
`;

/** Force markdown HTML sanitization for every server-side generate. */
async function ensureMarkedSanitize(siteDir: string): Promise<void> {
  const configPath = join(siteDir, "_config.yml");
  let raw = "";
  try {
    raw = await readFile(configPath, "utf8");
  } catch {
    return;
  }
  if (/^marked:/m.test(raw)) {
    raw = raw.replace(/^marked:[\s\S]*?(?=\n[a-z_][a-z0-9_]*:|\n*$)/im, MARKED_BLOCK);
  } else {
    raw = `${raw.trimEnd()}\n${MARKED_BLOCK}`;
  }
  await writeFile(configPath, raw.endsWith("\n") ? raw : `${raw}\n`);
}

function workerEnv(): NodeJS.ProcessEnv {
  const allow = ["PATH", "HOME", "LANG", "LC_ALL", "LC_CTYPE", "TMPDIR", "TMP", "TEMP", "USER", "LOGNAME"];
  const env: NodeJS.ProcessEnv = {
    NODE_ENV: process.env.NODE_ENV ?? "production",
    NODE_PATH: runnerNodeModules,
  };
  for (const key of allow) {
    const value = process.env[key];
    if (value) env[key] = value;
  }
  return env;
}

async function runHexoInWorker(siteDir: string): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(process.execPath, [generateWorkerPath, siteDir], {
      cwd: siteDir,
      env: workerEnv(),
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    let stderr = "";
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
      if (stderr.length > 8_000) stderr = stderr.slice(-8_000);
    });

    let settled = false;
    const killTimer = setTimeout(() => {
      child.kill("SIGKILL");
    }, GENERATE_TIMEOUT_MS + GENERATE_KILL_GRACE_MS);

    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(killTimer);
      if (error) reject(error);
      else resolvePromise();
    };

    child.on("error", (error) => finish(error));
    child.on("exit", (code, signal) => {
      if (code === 0) {
        finish();
        return;
      }
      if (code === 124 || signal === "SIGKILL" || signal === "SIGTERM") {
        finish(new Error("hexo generate timed out"));
        return;
      }
      const detail = stderr.trim().split("\n").filter(Boolean).at(-1);
      finish(new Error(detail || `hexo generate failed (exit ${code ?? signal ?? "?"})`));
    });
  });
}

async function readThemeId(siteDir: string): Promise<ThemeId> {
  try {
    const raw = await readFile(join(siteDir, "_config.yml"), "utf8");
    const match = raw.match(/^theme:\s*(\S+)/m);
    const theme = match?.[1] as ThemeId | undefined;
    if (theme && theme in THEME_META) return theme;
  } catch {
    // default
  }
  return "landscape";
}

async function assertGeneratedIndex(publicDir: string): Promise<void> {
  const index = join(publicDir, "index.html");
  let html = "";
  try {
    html = await readFile(index, "utf8");
  } catch {
    throw new Error("Hexo 没有生成首页");
  }
  if (html.trim().length < 200) {
    throw new Error("Hexo 首页是空的，当前主题渲染失败");
  }
}

async function applyForcedColorScheme(siteDir: string, publicDir: string): Promise<void> {
  const theme = await readThemeId(siteDir);
  if (theme !== "next") return;
  let yaml = "";
  try {
    yaml = await readFile(join(siteDir, themeConfigPath(theme)), "utf8");
  } catch {
    return;
  }
  const scheme = resolvedColorScheme(theme, parseThemeSettings(theme, yaml));
  if (scheme !== "dark" && scheme !== "light") return;

  const files: string[] = [];
  await collectTextFiles(resolve(publicDir), resolve(publicDir), files);
  for (const abs of files) {
    let text = await readFile(abs, "utf8");
    if (abs.endsWith(".css")) {
      text = rewritePrefersColorScheme(text, scheme);
    } else if (abs.endsWith(".html") || abs.endsWith(".htm")) {
      text = rewritePrefersColorScheme(text, scheme);
      text = injectColorSchemeMeta(text, scheme);
    }
    await writeFile(abs, text);
  }
}

function rewritePrefersColorScheme(text: string, scheme: "dark" | "light"): string {
  if (scheme === "dark") {
    return text
      .replace(/\(\s*prefers-color-scheme\s*:\s*dark\s*\)/gi, "(min-width: 0)")
      .replace(/\(\s*prefers-color-scheme\s*:\s*light\s*\)/gi, "(max-width: 0)");
  }
  return text.replace(/\(\s*prefers-color-scheme\s*:\s*dark\s*\)/gi, "(max-width: 0)");
}

function injectColorSchemeMeta(html: string, scheme: "dark" | "light"): string {
  if (/name=["']color-scheme["']/i.test(html)) {
    return html.replace(
      /<meta\s+name=["']color-scheme["'][^>]*>/i,
      `<meta name="color-scheme" content="${scheme}">`,
    );
  }
  const tag = `<meta name="color-scheme" content="${scheme}"><style>html{color-scheme:${scheme}}</style>`;
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (open) => `${open}${tag}`);
  return tag + html;
}

async function polishPublicDir(publicDir: string, rebaseRoot?: string): Promise<void> {
  const root = resolve(publicDir);
  const files: string[] = [];
  await collectTextFiles(root, root, files);
  const rebase = Boolean(rebaseRoot && rebaseRoot !== "/");
  const preview = Boolean(rebaseRoot);
  for (const abs of files) {
    let text = await readFile(abs, "utf8");
    if (abs.endsWith(".html") || abs.endsWith(".htm")) {
      text = unescapeEscapedHeadTags(text);
      text = hardenPreviewHtml(text, preview);
    }
    if (rebase && rebaseRoot) {
      text = rebaseAbsoluteUrls(text, rebaseRoot);
    }
    await writeFile(abs, text);
  }
}

const PREVIEW_CHROME_CSS = `
html { scrollbar-width: thin; scrollbar-color: rgba(28, 25, 21, 0.35) transparent; }
::-webkit-scrollbar { width: 10px; height: 10px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb {
  background: rgba(28, 25, 21, 0.28);
  border: 2px solid transparent;
  border-radius: 999px;
  background-clip: padding-box;
}
::-webkit-scrollbar-button { display: none; width: 0; height: 0; }
`;

const PREVIEW_CSP =
  "default-src 'none'; base-uri 'none'; form-action 'self'; " +
  "script-src 'none'; style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data: https: blob:; font-src 'self' data:; " +
  "connect-src 'none'; frame-src 'none'; object-src 'none'";

function hardenPreviewHtml(html: string, previewChrome: boolean): string {
  if (!previewChrome) return html;

  let next = html
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<script\b[^>]*>/gi, "")
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\shref\s*=\s*(['"])\s*javascript:[\s\S]*?\1/gi, ' href="#"')
    .replace(/\ssrc\s*=\s*(['"])\s*javascript:[\s\S]*?\1/gi, "");

  const csp = `<meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}">`;
  const chrome = `<style id="op-preview-chrome">${PREVIEW_CHROME_CSS}</style>`;
  if (/<head[^>]*>/i.test(next)) {
    next = next.replace(/<head[^>]*>/i, (open) => `${open}${csp}${chrome}`);
  } else {
    next = `${csp}${chrome}${next}`;
  }
  return next;
}

async function collectTextFiles(root: string, dir: string, out: string[]): Promise<void> {
  let entries: string[] = [];
  try {
    entries = await readdir(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    const abs = resolve(dir, name);
    if (!abs.startsWith(root + sep) && abs !== root) continue;
    const info = await lstat(abs);
    if (info.isDirectory()) {
      await collectTextFiles(root, abs, out);
      continue;
    }
    if (/\.(html?|css|js|xml|json)$/i.test(abs)) out.push(abs);
  }
}

function unescapeEscapedHeadTags(html: string): string {
  const split = html.search(/<\/head>/i);
  if (split < 0) return html;
  const head = html.slice(0, split).replace(
    /&lt;(\s*\/?\s*(?:meta|link|title|base)(?:\s[\s\S]*?)?)\s*&gt;/gi,
    "<$1>",
  );
  return head + html.slice(split);
}

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|ico|svg|bmp)$/i;

function crc32(data: Buffer): number {
  let crc = ~0;
  for (const byte of data) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) {
      const mask = -(crc & 1);
      crc = (crc >>> 1) ^ (0xedb88320 & mask);
    }
  }
  return ~crc >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const name = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, crc]);
}

function brandPng(size = 160): Buffer {
  const ink = [0x1c, 0x19, 0x15];
  const paper = [0xff, 0xfd, 0xf8];
  const accent = [0xc4, 0x5c, 0x26];
  const stride = size * 3 + 1;
  const raw = Buffer.alloc(stride * size);
  const lineY = [
    [0.4, 0.46, 0.55],
    [0.52, 0.58, 0.7],
    [0.64, 0.7, 0.48],
  ];
  for (let y = 0; y < size; y++) {
    raw[y * stride] = 0;
    for (let x = 0; x < size; x++) {
      const i = y * stride + 1 + x * 3;
      let color = ink;
      const nx = x / size;
      const ny = y / size;
      const inCard = nx > 0.22 && nx < 0.78 && ny > 0.18 && ny < 0.82;
      if (inCard) {
        color = paper;
        for (const [top, bottom, width] of lineY) {
          if (ny >= top && ny <= bottom && nx > 0.3 && nx < 0.3 + width) {
            color = ny > 0.62 ? accent : ink;
          }
        }
      }
      raw[i] = color[0];
      raw[i + 1] = color[1];
      raw[i + 2] = color[2];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

const BRAND_PNG = brandPng();
const BRAND_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="14" fill="#1c1915"/>
  <rect x="16" y="14" width="32" height="40" rx="4" fill="#fffdf8"/>
  <rect x="22" y="24" width="20" height="3" rx="1.5" fill="#1c1915"/>
  <rect x="22" y="32" width="16" height="3" rx="1.5" fill="#1c1915"/>
  <rect x="22" y="40" width="18" height="3" rx="1.5" fill="#c45c26"/>
</svg>
`;

function extractLocalImagePaths(text: string, rebaseRoot?: string): string[] {
  const found = new Set<string>();
  const add = (raw: string) => {
    let url = raw.trim().split(/[?#]/)[0] ?? "";
    if (!url || /^(https?:|data:|mailto:|javascript:|#)/i.test(url) || url.startsWith("//")) {
      return;
    }
    if (rebaseRoot) {
      const base = rebaseRoot.endsWith("/") ? rebaseRoot : `${rebaseRoot}/`;
      if (url.startsWith(base)) url = `/${url.slice(base.length)}`;
    }
    if (!url.startsWith("/") || !IMAGE_EXT.test(url)) return;
    found.add(url.replace(/^\/+/, ""));
  };
  const attr = /(?:src|href|data-src|data-original|content)\s*=\s*["']([^"']+)["']/gi;
  const css = /url\(\s*["']?([^"')]+)["']?\s*\)/gi;
  let match: RegExpExecArray | null;
  while ((match = attr.exec(text))) add(match[1] ?? "");
  while ((match = css.exec(text))) add(match[1] ?? "");
  return [...found];
}

async function fillMissingThemeImages(publicDir: string, rebaseRoot?: string): Promise<void> {
  const root = resolve(publicDir);
  const files: string[] = [];
  await collectTextFiles(root, root, files);
  const missing = new Set<string>();
  for (const abs of files) {
    const text = await readFile(abs, "utf8");
    for (const rel of extractLocalImagePaths(text, rebaseRoot)) missing.add(rel);
  }
  for (const rel of missing) {
    const dest = assertInside(root, join(root, rel));
    try {
      await stat(dest);
      continue;
    } catch {
      // write a brand mark so theme default avatars / logos are not broken
    }
    await mkdir(dirname(dest), { recursive: true });
    if (rel.endsWith(".svg")) {
      await writeFile(dest, BRAND_SVG);
    } else {
      await writeFile(dest, BRAND_PNG);
    }
  }
}

function rebaseAbsoluteUrls(text: string, root: string): string {
  const base = root.endsWith("/") ? root.slice(0, -1) : root;
  const skip = (after: string) => after.startsWith(`${base}/`) || after === `${base}"` || after === `${base}'`;
  return text
    .replace(/(?<=(?:href|src|action)\s*=\s*["'])\/(?!\/)/gi, (match, offset: number, source: string) => {
      const after = source.slice(offset);
      return skip(after) ? match : `${base}/`;
    })
    .replace(/(?<=url\(\s*["']?)\/(?!\/)/gi, (match, offset: number, source: string) => {
      const after = source.slice(offset);
      return skip(after) ? match : `${base}/`;
    });
}

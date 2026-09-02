import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, rm, writeFile, readFile, cp, symlink, lstat, readdir, rename, stat } from "node:fs/promises";
import { deflateSync } from "node:zlib";
import {
  type SiteConfig,
  type SiteFile,
  THEME_META,
  type BuiltinThemeId,
  type ThemeId,
  applySiteConfigToYaml,
  defaultHexoConfigYaml,
  defaultThemeSettings,
  isThemeId,
  isUserEditablePath,
  parseThemeSettings,
  resolvedColorScheme,
  serializeThemeSettings,
  themeConfigPath,
} from "@open-pages/shared";

const require = createRequire(import.meta.url);
const runnerRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const runnerNodeModules = join(runnerRoot, "node_modules");
const workspaceNodeModules = resolve(runnerRoot, "../../node_modules");
const hexoNodeModules = (() => {
  try {
    return resolve(dirname(require.resolve("hexo/package.json", { paths: [runnerRoot] })), "..");
  } catch {
    return runnerNodeModules;
  }
})();
const nodeModuleSearch = [workspaceNodeModules, hexoNodeModules, runnerNodeModules]
  .filter((value, index, all) => all.indexOf(value) === index)
  .join(delimiter);
const generateWorkerPath = fileURLToPath(new URL("./generate-worker.mjs", import.meta.url));

const GENERATE_TIMEOUT_MS = 60_000;
const GENERATE_KILL_GRACE_MS = 5_000;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_FILES = 200;
const MAX_PUBLIC_FILES = 500;
const MAX_PUBLIC_BYTES = 20 * 1024 * 1024;
const THEME_COPY_VERSION = 3;
/** Hexo's own default theme, and the one a missing package falls back to. */
const FALLBACK_THEME: BuiltinThemeId = "landscape";
const BUILDS_DIR = ".builds";

function assertInside(root: string, target: string): string {
  const base = resolve(root);
  const abs = resolve(target);
  if (abs !== base && !abs.startsWith(base + sep)) {
    throw new Error(`Path not allowed: ${target}`);
  }
  return abs;
}

const COMMON_SITE_DEPENDENCIES = {
  chalk: "4.1.2",
  css: "^3.0.0",
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
  "highlight.js": "^11.12.0",
  "html-to-text": "^9.0.5",
  "js-yaml": "^5.4.1",
  "markdown-it": "^14.1.0",
  "markdown-it-container": "^4.0.0",
  moize: "^6.1.7",
  moment: "^2.30.1",
  nunjucks: "^3.2.4",
  "opentype.js": "^1.3.4",
  picocolors: "^1.1.1",
};

const THEME_PACKAGES: Record<BuiltinThemeId, string> = {
  landscape: "^1.1.0",
  cactus: "github:probberechts/hexo-theme-cactus",
  next: "^8.25.0",
  kaze: "^1.0.5",
  stellar: "^1.44.0",
  reimu: "^1.12.6",
  particlex: "^2.8.1",
  stun: "^2.8.0",
  white: "github:FuShaoLei/hexo-theme-white#c86eed90ab84a0de9dc1ff91525db74e8ff79145",
  tranquility: "^1.7.1",
  async: "^2.2.7",
  apollo: "^1.0.6",
  inside: "^2.7.2",
};

const THEME_EXTRA_DEPENDENCIES: Partial<Record<BuiltinThemeId, Record<string, string>>> = {
  async: {
    "hexo-renderer-less": "^4.0.0",
    "hexo-wordcount": "^6.0.1",
  },
  particlex: {
    "hexo-helper-crypto": "^1.2.1",
  },
  white: {
    "hexo-renderer-dartsass": "^1.2.0",
  },
};

function builtinTheme(theme: ThemeId): BuiltinThemeId | null {
  return theme in THEME_META ? (theme as BuiltinThemeId) : null;
}

function siteDependencies(theme: ThemeId, disabledPlugins: string[] = []): Record<string, string> {
  const builtin = builtinTheme(theme);
  const dependencies: Record<string, string> = {
    ...COMMON_SITE_DEPENDENCIES,
    ...(builtin ? THEME_EXTRA_DEPENDENCIES[builtin] : {}),
    ...(builtin ? { [THEME_META[builtin].packageName]: THEME_PACKAGES[builtin] } : {}),
  };
  for (const name of disabledPlugins) delete dependencies[name];
  return dependencies;
}

const FAVICON_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

function resolvedHexoVersion(): string {
  return require("hexo/package.json").version as string;
}

async function writeSiteManifest(
  siteDir: string,
  theme: ThemeId,
  disabledPlugins: string[] = [],
): Promise<void> {
  await writeFile(
    join(siteDir, "package.json"),
    JSON.stringify(
      {
        name: "open-pages-site",
        private: true,
        // Match the installed Hexo version so init's update_package is a no-op
        // and does not need to rewrite package.json inside the sandboxed worker.
        hexo: { version: resolvedHexoVersion() },
        dependencies: siteDependencies(theme, disabledPlugins),
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
  themeSource?: string;
}

export interface GenerateResult {
  publicDir: string;
  elapsedMs: number;
}

export interface GenerateOptions {
  rebaseRoot?: string;
  themeSource?: string;
  plugins?: Array<{ id: string; path: string }>;
  disabledPluginNames?: string[];
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
  await ensureTheme(siteDir, config.theme, options.themeSource);
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

export async function updateSiteConfig(
  siteDir: string,
  config: SiteConfig,
  themeSource?: string,
): Promise<void> {
  const configPath = join(siteDir, "_config.yml");
  let existing = "";
  try {
    existing = await readFile(configPath, "utf8");
  } catch {
    existing = "";
  }
  await writeFile(configPath, applySiteConfigToYaml(config, existing));
  await ensureTheme(siteDir, config.theme, themeSource);
  const themePath = join(siteDir, themeConfigPath(config.theme));
  try {
    await stat(themePath);
  } catch {
    await writeFile(themePath, serializeThemeSettings(config.theme, defaultThemeSettings(config.theme)));
  }
}

export async function generateSite(
  siteDir: string,
  options: GenerateOptions = {},
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
  options: GenerateOptions,
): Promise<GenerateResult> {
  const started = Date.now();
  const theme = await readThemeId(siteDir);
  await writeSiteManifest(siteDir, theme, options.disabledPluginNames);
  await linkNodeModules(siteDir);
  await ensureFeedConfig(siteDir);
  await ensureTheme(siteDir, theme, options.themeSource);
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
  await rm(join(siteDir, "db.json"), { force: true });
  await ensureMarkedSanitize(siteDir);

  // Build into a scratch directory so `public/` keeps serving the previous
  // build until this one is fully generated and post-processed.
  const buildId = `${process.pid}-${Date.now()}`;
  const buildRel = join(BUILDS_DIR, buildId);
  const buildDir = join(siteDir, buildRel);
  await mkdir(buildDir, { recursive: true });

  try {
    let firstError: unknown;
    try {
      await runHexoInWorker(siteDir, buildRel, options.plugins, options.themeSource);
    } catch (error) {
      firstError = error;
    }

    // A few third-party themes initialize generated state in Hexo's database on
    // their first pass. Retry once when that pass errors or produces no homepage.
    if (firstError || !(await hasGeneratedIndex(buildDir))) {
      await runHexoInWorker(siteDir, buildRel, options.plugins, options.themeSource);
    }

    await assertGeneratedIndex(buildDir);
    await polishPublicDir(buildDir, options.rebaseRoot);
    await applyForcedColorScheme(siteDir, buildDir);
    await fillMissingThemeImages(buildDir, options.rebaseRoot);
    await fillMissingThemeStyles(buildDir, options.rebaseRoot);
    const publicDir = await publishBuild(siteDir, buildId);
    return {
      publicDir,
      elapsedMs: Date.now() - started,
    };
  } catch (error) {
    await rm(buildDir, { recursive: true, force: true });
    throw error;
  }
}

/**
 * Points `public/` at a finished build by swapping a symlink, so a preview
 * request can never observe a half-written directory.
 */
async function publishBuild(siteDir: string, buildId: string): Promise<string> {
  const publicDir = join(siteDir, "public");
  const staged = join(siteDir, `.public.tmp-${buildId}`);
  await rm(staged, { recursive: true, force: true });
  await symlink(join(BUILDS_DIR, buildId), staged, "dir");
  try {
    // rename() cannot replace a real directory, only the symlink we manage.
    const existing = await lstat(publicDir).catch(() => null);
    if (existing?.isDirectory() && !existing.isSymbolicLink()) {
      await rm(publicDir, { recursive: true, force: true });
    }
    await rename(staged, publicDir);
  } catch (error) {
    await rm(staged, { recursive: true, force: true });
    throw error;
  }
  await pruneBuilds(siteDir, buildId);
  return publicDir;
}

async function pruneBuilds(siteDir: string, keep: string): Promise<void> {
  const root = join(siteDir, BUILDS_DIR);
  const entries = await readdir(root).catch(() => [] as string[]);
  await Promise.all(
    entries
      .filter((entry) => entry !== keep)
      .map((entry) => rm(join(root, entry), { recursive: true, force: true })),
  );
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
    if (stat.isSymbolicLink()) continue;
    if (stat.isDirectory()) {
      await walk(root, abs, files, tally);
      continue;
    }
    if (!stat.isFile()) continue;
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

async function ensureTheme(siteDir: string, theme: ThemeId, sourceOverride?: string): Promise<void> {
  const dest = join(siteDir, "themes", theme);
  const marker = join(dest, ".open-pages-theme");
  // Resolved before the marker check because the marker records which source
  // the copy came from: a site rendered with the fallback has to be rebuilt
  // once the real package shows up again.
  const { dir: src, content, origin } = await themePackageSource(theme, sourceOverride);
  const markerValue = `${theme}:${THEME_COPY_VERSION}:${origin}`;
  try {
    const existing = await readFile(marker, "utf8");
    if (existing.trim() === markerValue) return;
  } catch {
    // missing or incomplete copy
  }

  const staging = join(siteDir, "themes", `.${theme}.tmp-${process.pid}-${Date.now()}`);
  await mkdir(dirname(dest), { recursive: true });
  await rm(staging, { recursive: true, force: true });
  try {
    // Copy instead of symlink so theme scripts resolve hexo-util / hexo-fs
    // from the site node_modules instead of the pnpm store path.
    // Skip the theme's own node_modules so a nested dependency cannot shadow ours.
    await cp(src, staging, {
      recursive: true,
      dereference: Boolean(sourceOverride),
      filter: sourceOverride
        ? undefined
        : (from) => !from.slice(src.length).split(sep).includes("node_modules"),
    });
    if (sourceOverride) {
      // npm may hoist a custom theme's runtime dependencies next to the theme
      // package. Keep that complete install tree reachable after copying.
      await rm(join(staging, "node_modules"), { recursive: true, force: true });
      await symlink(dirname(src), join(staging, "node_modules"), "dir");
    }
    // Keyed to the files actually copied: patching a fallback copy as if it
    // were the requested theme would look for scripts that are not in it.
    await patchThemeCompatibility(staging, content);
    await writeFile(join(staging, ".open-pages-theme"), `${markerValue}\n`);
    await rm(dest, { recursive: true, force: true });
    try {
      await rename(staging, dest);
    } catch (error) {
      // Another API process may have installed the same complete theme first.
      const installed = await readFile(marker, "utf8").catch(() => "");
      if (installed.trim() !== markerValue) throw error;
    }
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

async function patchThemeCompatibility(themeDir: string, theme: ThemeId): Promise<void> {
  if (theme === "next") {
    const highlightPath = join(themeDir, "scripts/events/lib/highlight.js");
    const source = await readFile(highlightPath, "utf8");
    await writeFile(
      highlightPath,
      source.replace(
        "if (!fs.existsSync(file)) file = resolve('prism-themes'",
        "if (file && !fs.existsSync(file)) file = resolve('prism-themes'",
      ),
    );
    return;
  }
  if (theme !== "inside") return;
  const configPath = join(themeDir, "lib/generator/config.js");
  const source = await readFile(configPath, "utf8");
  const legacy = "const link = post.link.split('/').filter(i => i)";
  if (!source.includes(legacy)) return;
  await writeFile(
    configPath,
    source.replace(legacy, "const link = (post.link || post.path || '').split('/').filter(i => i)"),
  );
}

interface ThemeSource {
  /** Directory the theme files are copied from. */
  dir: string;
  /** Theme the copied files belong to, which is not `theme` after a fallback. */
  content: ThemeId;
  /** Recorded in the copy marker so a fallback is never mistaken for the real thing. */
  origin: string;
}

/**
 * A theme we cannot find used to fail the whole render, which turns one broken
 * package into an editor that shows nothing at all. Fall back to the same theme
 * `readThemeId` defaults to instead, keeping the destination directory named
 * after the requested theme so the site config still points at something real.
 */
async function themePackageSource(
  theme: ThemeId,
  sourceOverride?: string,
): Promise<ThemeSource> {
  if (sourceOverride) {
    // A path the user supplied: silently rendering something else would hide
    // their mistake, so this still fails.
    const dir = resolve(sourceOverride);
    if (!(await isDirectory(dir))) throw new Error(`Theme package not installed: ${theme}`);
    // The path stays in the marker so pointing at a different source re-copies.
    return { dir, content: theme, origin: sourceOverride };
  }

  const dir = await resolveThemePackage(theme).catch(() => null);
  if (dir && (await isDirectory(dir))) return { dir, content: theme, origin: "builtin" };

  const name = themePackageName(theme);
  if (theme !== FALLBACK_THEME) {
    const fallback = await resolveThemePackage(FALLBACK_THEME).catch(() => null);
    if (fallback && (await isDirectory(fallback))) {
      console.warn(
        `[open-pages] theme package ${name} is not installed; rendering with ${FALLBACK_THEME} instead`,
      );
      return { dir: fallback, content: FALLBACK_THEME, origin: `fallback:${FALLBACK_THEME}` };
    }
  }
  throw new Error(`Theme package not installed: ${name}`);
}

function themePackageName(theme: ThemeId): string {
  const builtin = builtinTheme(theme);
  return builtin ? THEME_META[builtin].packageName : theme;
}

/**
 * Some themes ship no package.json (hexo-theme-white is a bare GitHub tarball),
 * so require.resolve cannot find them and only the directory lookup works.
 * Falling back to the runner-local node_modules alone was enough in the pnpm
 * workspace, where that directory holds a link to every dependency, but the
 * packaged desktop runtime is a hoisted tree with no such directory — the theme
 * sat in the bundle root the whole time and still reported "not installed".
 */
async function resolveThemePackage(theme: ThemeId): Promise<string> {
  const builtin = builtinTheme(theme);
  if (!builtin) throw new Error(`Theme package not installed: ${theme}`);
  const pkg = THEME_META[builtin].packageName;
  try {
    return dirname(require.resolve(`${pkg}/package.json`, { paths: [runnerRoot] }));
  } catch {
    // Ordered so a workspace checkout keeps preferring its own copy.
    for (const root of [runnerNodeModules, hexoNodeModules, workspaceNodeModules]) {
      const candidate = join(root, pkg);
      if (await isDirectory(candidate)) return candidate;
    }
    return join(runnerNodeModules, pkg);
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Packaging guard, used by the desktop bundle step. The bundle has a different
 * node_modules shape than the workspace, so a theme can be reachable here and
 * missing there — which is how hexo-theme-white shipped broken while every test
 * in the workspace passed.
 */
export async function missingThemePackages(): Promise<string[]> {
  const missing: string[] = [];
  for (const theme of Object.keys(THEME_META) as BuiltinThemeId[]) {
    const path = await resolveThemePackage(theme).catch(() => null);
    if (!path || !(await isDirectory(path))) missing.push(THEME_META[theme].packageName);
  }
  return missing;
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
    await symlink(workspaceNodeModules, dest, "dir");
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
  const lines = raw.split("\n");
  const start = lines.findIndex((line) => /^marked:\s*(?:#.*)?$/i.test(line));
  if (start >= 0) {
    let end = start + 1;
    while (end < lines.length && (/^\s/.test(lines[end] ?? "") || !lines[end]?.trim())) end += 1;
    lines.splice(start, end - start, ...MARKED_BLOCK.trimEnd().split("\n"));
    raw = lines.join("\n");
  } else {
    raw = `${raw.trimEnd()}\n${MARKED_BLOCK}`;
  }
  await writeFile(configPath, raw.endsWith("\n") ? raw : `${raw}\n`);
}

function workerEnv(): NodeJS.ProcessEnv {
  const allow = [
    "PATH",
    "HOME",
    "HOMEDRIVE",
    "HOMEPATH",
    "USERPROFILE",
    "APPDATA",
    "LOCALAPPDATA",
    "SYSTEMROOT",
    "SYSTEMDRIVE",
    "WINDIR",
    "COMSPEC",
    "PATHEXT",
    "LANG",
    "LC_ALL",
    "LC_CTYPE",
    "TMPDIR",
    "TMP",
    "TEMP",
    "USER",
    "LOGNAME",
  ];
  const env: NodeJS.ProcessEnv = {
    NODE_ENV: process.env.NODE_ENV ?? "production",
    NODE_PATH: nodeModuleSearch,
  };
  for (const key of allow) {
    const value = process.env[key];
    if (value) env[key] = value;
  }
  return env;
}

async function runHexoInWorker(
  siteDir: string,
  publicRel: string,
  plugins: Array<{ id: string; path: string }> = [],
  themeSource?: string,
): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const args = [
      ...workerPermissionArgs(siteDir, publicRel, plugins, themeSource),
      generateWorkerPath,
      siteDir,
      publicRel,
      JSON.stringify(plugins),
    ];
    const child = spawn(
      process.execPath,
      args,
      {
      cwd: siteDir,
      env: workerEnv(),
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      },
    );

    let stderr = "";
    // Hexo and themes use stdout for progress logs. Drain without retaining it
    // so verbose themes cannot fill the pipe and block generation.
    child.stdout?.resume();
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
      const lines = stderr.trim().split("\n").filter(Boolean);
      const detail =
        lines.find((line) => /(?:^|\s)(?:error|fatal)(?::|\s)/i.test(line)) ??
        lines.find((line) => !/^\s+at\s/.test(line)) ??
        lines.at(-1);
      const error = new Error(detail || `hexo generate failed (exit ${code ?? signal ?? "?"})`);
      if (stderr.trim()) {
        error.stack = `${error.stack}\n\nHexo worker stderr:\n${stderr.trim()}`;
        console.error(error.stack);
      }
      finish(error);
    });
  });
}

function workerPermissionArgs(
  siteDir: string,
  publicRel: string,
  plugins: Array<{ id: string; path: string }>,
  themeSource?: string,
): string[] {
  if (Number(process.versions.node.split(".")[0]) < 20) return [];
  const readRoots = new Set([
    siteDir,
    dirname(generateWorkerPath),
    hexoNodeModules,
    runnerNodeModules,
    workspaceNodeModules,
    resolve(runnerRoot, "../.."),
    resolve(runnerNodeModules, "../../../node_modules"),
    tmpdir(),
  ]);
  for (const path of [themeSource, ...plugins.map((plugin) => plugin.path)]) {
    if (!path) continue;
    const marker = `${sep}node_modules${sep}`;
    const at = path.lastIndexOf(marker);
    readRoots.add(at >= 0 ? path.slice(0, at) : dirname(path));
  }
  const permissionFlag =
    Number(process.versions.node.split(".")[0]) >= 22 ? "--permission" : "--experimental-permission";
  // Hexo-fs always mkdir()s the parent before writing a file, so the site root
  // itself must be writable for db.json / package.json. Writes outside the site
  // and tmpdir remain denied.
  const writeRoots = [siteDir, resolve(siteDir, publicRel), tmpdir()];
  return [
    permissionFlag,
    ...[...readRoots].map((path) => `--allow-fs-read=${path}`),
    ...writeRoots.map((path) => `--allow-fs-write=${path}`),
  ];
}

async function readThemeId(siteDir: string): Promise<ThemeId> {
  try {
    const raw = await readFile(join(siteDir, "_config.yml"), "utf8");
    const match = raw.match(/^theme:\s*(\S+)/m);
    const theme = match?.[1];
    if (isThemeId(theme)) return theme;
  } catch {
    // default
  }
  return FALLBACK_THEME;
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

async function hasGeneratedIndex(publicDir: string): Promise<boolean> {
  try {
    const html = await readFile(join(publicDir, "index.html"), "utf8");
    return html.trim().length >= 200;
  } catch {
    return false;
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
      text = injectPreviewChrome(text, preview);
    }
    if (rebase && rebaseRoot) {
      text = rebaseAbsoluteUrls(text, rebaseRoot);
    }
    await writeFile(abs, text);
  }
  // GitHub Pages legacy deploys skip Jekyll only when this file is present.
  await writeFile(join(root, ".nojekyll"), "");
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

/**
 * The preview is served from its own origin and runs the theme's own scripts,
 * so the page is left exactly as Hexo produced it. The only injection is the
 * scrollbar styling that makes the frame match the editor chrome.
 */
function injectPreviewChrome(html: string, previewChrome: boolean): string {
  if (!previewChrome) return html;
  const chrome = `<style id="op-preview-chrome">${PREVIEW_CHROME_CSS}</style>`;
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head[^>]*>/i, (open) => `${open}${chrome}`);
  }
  return `${chrome}${html}`;
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
    if (info.isSymbolicLink()) continue;
    if (info.isDirectory()) {
      await collectTextFiles(root, abs, out);
      continue;
    }
    if (!info.isFile()) continue;
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

/**
 * Turns a reference into a path relative to the site root, resolving relative
 * ones against the document that contains them. Themes emit both forms — Stun
 * links its override stylesheet as a bare `css/custom.css` — so a filler that
 * only understood absolute paths would miss half of them. Returns null when the
 * reference escapes the site root.
 */
function resolveAssetPath(url: string, fileDir: string): string | null {
  const base = url.startsWith("/") ? url.slice(1) : `${fileDir ? `${fileDir}/` : ""}${url}`;
  const stack: string[] = [];
  for (const part of base.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (!stack.length) return null;
      stack.pop();
      continue;
    }
    stack.push(part);
  }
  return stack.length ? stack.join("/") : null;
}

function extractLocalPaths(
  text: string,
  accept: RegExp,
  fileDir: string,
  rebaseRoot?: string,
): string[] {
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
    const rel = resolveAssetPath(url, fileDir);
    if (!rel || !accept.test(rel)) return;
    found.add(rel);
  };
  const attr = /(?:src|href|data-src|data-original|content)\s*=\s*["']([^"']+)["']/gi;
  const css = /url\(\s*["']?([^"')]+)["']?\s*\)/gi;
  let match: RegExpExecArray | null;
  while ((match = attr.exec(text))) add(match[1] ?? "");
  while ((match = css.exec(text))) add(match[1] ?? "");
  return [...found];
}

/**
 * Themes link a site-supplied override stylesheet (Stun's `css_custom` is the
 * one built in here) whether or not the site provides one, so a stock build
 * always 404s it. An empty file is what "no overrides" should look like, and it
 * leaves the hook the theme intended in place.
 */
async function fillMissingThemeStyles(publicDir: string, rebaseRoot?: string): Promise<void> {
  const root = resolve(publicDir);
  const files: string[] = [];
  await collectTextFiles(root, root, files);
  const missing = new Set<string>();
  for (const abs of files) {
    const text = await readFile(abs, "utf8");
    for (const rel of extractLocalPaths(text, /\.css$/i, dirRelativeTo(root, abs), rebaseRoot)) {
      missing.add(rel);
    }
  }
  for (const rel of missing) {
    const dest = assertInside(root, join(root, rel));
    if (await stat(dest).then(() => true).catch(() => false)) continue;
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, "/* no site overrides */\n");
  }
}

function dirRelativeTo(root: string, file: string): string {
  return relative(root, dirname(file)).split(sep).filter(Boolean).join("/");
}

async function fillMissingThemeImages(publicDir: string, rebaseRoot?: string): Promise<void> {
  const root = resolve(publicDir);
  const files: string[] = [];
  await collectTextFiles(root, root, files);
  const missing = new Set<string>();
  for (const abs of files) {
    const text = await readFile(abs, "utf8");
    for (const rel of extractLocalPaths(text, IMAGE_EXT, dirRelativeTo(root, abs), rebaseRoot)) {
      missing.add(rel);
    }
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

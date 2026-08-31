import { createRequire } from "node:module";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, rm, writeFile, readFile, cp, symlink, lstat, readdir } from "node:fs/promises";
import {
  type SiteConfig,
  type SiteFile,
  THEME_META,
  type ThemeId,
  applySiteConfigToYaml,
  defaultHexoConfigYaml,
  isUserEditablePath,
} from "@open-pages/shared";

const require = createRequire(import.meta.url);
const runnerRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const runnerNodeModules = join(runnerRoot, "node_modules");

const GENERATE_TIMEOUT_MS = 60_000;
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

const SITE_DEPENDENCIES = {
  hexo: "^7.3.0",
  "hexo-generator-archive": "^2.0.0",
  "hexo-generator-category": "^2.0.0",
  "hexo-generator-feed": "^3.0.0",
  "hexo-generator-index": "^4.0.0",
  "hexo-generator-search": "^2.4.3",
  "hexo-generator-tag": "^2.0.0",
  "hexo-renderer-ejs": "^2.0.0",
  "hexo-renderer-marked": "^7.0.1",
  "hexo-renderer-pug": "^3.0.0",
  "hexo-renderer-stylus": "^3.0.1",
  "hexo-theme-cactus": "github:probberechts/hexo-theme-cactus",
  "hexo-theme-landscape": "^1.1.0",
  "hexo-theme-next": "^8.25.0",
};

const FAVICON_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

async function writeSiteManifest(siteDir: string): Promise<void> {
  await writeFile(
    join(siteDir, "package.json"),
    JSON.stringify(
      {
        name: "open-pages-site",
        private: true,
        hexo: {},
        dependencies: SITE_DEPENDENCIES,
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

  await writeSiteManifest(siteDir);
  await writeFile(join(siteDir, "_config.next.yml"), "scheme: Gemini\n");
  await writeFile(join(siteDir, "source/favicon.png"), FAVICON_PNG);

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
}

export async function generateSite(siteDir: string): Promise<GenerateResult> {
  const key = resolve(siteDir);
  const existing = inflight.get(key);
  if (existing) return existing;

  const job = runGenerate(siteDir).finally(() => {
    inflight.delete(key);
  });
  inflight.set(key, job);
  return job;
}

async function runGenerate(siteDir: string): Promise<GenerateResult> {
  const started = Date.now();
  await writeSiteManifest(siteDir);
  await linkNodeModules(siteDir);
  await ensureFeedConfig(siteDir);
  const config = await readThemeId(siteDir);
  await ensureTheme(siteDir, config);
  try {
    await writeFile(join(siteDir, "source/favicon.png"), FAVICON_PNG, { flag: "wx" });
  } catch {
    // already present
  }
  await rm(join(siteDir, "public"), { recursive: true, force: true });
  await rm(join(siteDir, "db.json"), { force: true });

  const Hexo = require("hexo") as new (
    base: string,
    options?: { silent?: boolean; draft?: boolean; debug?: boolean },
  ) => {
    init: () => Promise<void>;
    call: (name: string, args?: Record<string, unknown>) => Promise<void>;
    exit: (err?: unknown) => Promise<void>;
  };

  const hexo = new Hexo(siteDir, { silent: true, draft: false });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      void hexo.exit(new Error("hexo generate timed out")).catch(() => undefined);
      reject(new Error("hexo generate timed out"));
    }, GENERATE_TIMEOUT_MS);
  });

  try {
    await Promise.race([
      (async () => {
        await hexo.init();
        await hexo.call("generate", { force: true, deploy: false });
        await hexo.exit();
      })(),
      timeout,
    ]);
  } catch (error) {
    try {
      await hexo.exit(error);
    } catch {
      // ignore exit errors
    }
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
  }

  return {
    publicDir: join(siteDir, "public"),
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
  const src = resolveThemePackage(theme);
  await rm(dest, { recursive: true, force: true });
  await mkdir(dirname(dest), { recursive: true });
  try {
    await symlink(src, dest, "dir");
  } catch {
    await cp(src, dest, { recursive: true });
  }
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

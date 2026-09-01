import { relative, resolve, sep } from "node:path";
import { lstat, mkdir, readdir, readFile, realpath, rm, stat } from "node:fs/promises";
import {
  DEFAULT_SITE_CONFIG,
  isSafeSiteId,
  isSafeWorkspaceId,
  parseSiteConfig,
  type SiteConfig,
  type SiteFile,
  aboutPageMarkdown,
  welcomeMarkdown,
  WELCOME_POST_PATH,
} from "@open-pages/shared";
import {
  generateSite,
  scaffoldSite,
  updateSiteConfig,
  writeUserFiles,
  type GenerateResult,
} from "@open-pages/hexo-runner";
import { ClientError } from "../errors.js";
import { env } from "../env.js";
import { previewKey } from "./preview-token.js";
import { resolveGenerationAddons } from "./addons.js";

const siteTails = new Map<string, Promise<void>>();

async function withSiteGate<T>(owner: string, id: string, task: () => Promise<T>): Promise<T> {
  const key = `${owner}/${id}`;
  const previous = siteTails.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolvePromise) => {
    release = resolvePromise;
  });
  siteTails.set(key, current);
  await previous;
  try {
    return await task();
  } finally {
    release();
    if (siteTails.get(key) === current) siteTails.delete(key);
  }
}

function isInside(root: string, target: string): boolean {
  const base = resolve(root);
  const abs = resolve(target);
  return abs === base || abs.startsWith(base + sep);
}

export function siteDir(owner: string, siteId: string): string {
  if (!isSafeWorkspaceId(owner) || !isSafeSiteId(siteId)) {
    throw new ClientError("Invalid site id");
  }
  const root = resolve(env.workspaceRoot);
  const ownerDir = resolve(root, owner);
  const dir = resolve(ownerDir, siteId);
  if (!isInside(root, ownerDir) || !isInside(ownerDir, dir)) {
    throw new ClientError("Invalid site id");
  }
  return dir;
}

async function ensureSiteUnlocked(
  owner: string,
  siteId: string,
  config: SiteConfig = DEFAULT_SITE_CONFIG,
  themeSource?: string,
): Promise<string> {
  const safeConfig = parseSiteConfig(config);
  const dir = siteDir(owner, siteId);
  try {
    await stat(resolve(dir, "_config.yml"));
  } catch {
    await scaffoldSite({
      siteDir: dir,
      config: safeConfig,
      themeSource,
      files: [
        { path: WELCOME_POST_PATH, content: welcomeMarkdown() },
        { path: "source/about/index.md", content: aboutPageMarkdown() },
      ],
    });
  }
  return dir;
}

export function ensureSite(
  owner: string,
  siteId: string,
  config: SiteConfig = DEFAULT_SITE_CONFIG,
): Promise<string> {
  return withSiteGate(owner, siteId, async () => {
    const addons = await resolveGenerationAddons(owner, config.theme);
    return ensureSiteUnlocked(owner, siteId, config, addons.themeSource);
  });
}

async function syncSiteUnlocked(
  owner: string,
  siteId: string,
  files: SiteFile[],
  config?: SiteConfig,
  themeSource?: string,
): Promise<string> {
  const safeConfig = config ? parseSiteConfig(config) : undefined;
  const dir = await ensureSiteUnlocked(owner, siteId, safeConfig, themeSource);
  if (safeConfig) {
    await updateSiteConfig(dir, safeConfig, themeSource);
  }
  const rest = files.filter((file) => file.path !== "_config.yml");
  await writeUserFiles(dir, rest);
  return dir;
}

export function syncSite(
  owner: string,
  siteId: string,
  files: SiteFile[],
  config?: SiteConfig,
): Promise<string> {
  return withSiteGate(owner, siteId, async () => {
    const addons = await resolveGenerationAddons(owner, config?.theme ?? DEFAULT_SITE_CONFIG.theme);
    return syncSiteUnlocked(owner, siteId, files, config, addons.themeSource);
  });
}

export function previewMount(owner: string, siteId: string): string {
  if (!isSafeWorkspaceId(owner) || !isSafeSiteId(siteId)) {
    throw new ClientError("Invalid site id");
  }
  return `/preview/${previewKey(owner, siteId)}/`;
}

export function previewUrl(owner: string, siteId: string): string {
  return `${env.previewOrigin}${previewMount(owner, siteId)}`;
}

export async function previewSite(
  owner: string,
  siteId: string,
  files: SiteFile[],
  config?: SiteConfig,
) {
  const root = previewMount(owner, siteId);
  const previewConfig = parseSiteConfig({
    ...(config ?? DEFAULT_SITE_CONFIG),
    url: env.previewOrigin,
    root,
  });
  return withSiteGate(owner, siteId, async () => {
    const addons = await resolveGenerationAddons(owner, previewConfig.theme);
    const dir = await syncSiteUnlocked(owner, siteId, files, previewConfig, addons.themeSource);
    return generateSite(dir, { rebaseRoot: root, ...addons });
  });
}

/** Keep publish sync and generation atomic with respect to previews for the same site. */
export function generatePublishedSite(
  owner: string,
  siteId: string,
  files: SiteFile[],
  config?: SiteConfig,
): Promise<{ dir: string; result: GenerateResult }> {
  return withSiteGate(owner, siteId, async () => {
    const safeConfig = config ? parseSiteConfig(config) : DEFAULT_SITE_CONFIG;
    const addons = await resolveGenerationAddons(owner, safeConfig.theme);
    const dir = await syncSiteUnlocked(owner, siteId, files, safeConfig, addons.themeSource);
    const result = await generateSite(dir, addons);
    return { dir, result };
  });
}

async function readRegularFile(
  abs: string,
  realRoot: string,
  publicRoot: string,
): Promise<PublicFile | null> {
  const info = await lstat(abs);
  if (info.isSymbolicLink() || !info.isFile()) return null;
  const realAbs = await realpath(abs);
  if (!isInside(realRoot, realAbs)) return null;
  return { body: await readFile(abs), path: relative(publicRoot, abs) };
}

export interface PublicFile {
  body: Buffer;
  /**
   * The file that was actually read, relative to the site's public root. A
   * request for `/2026/09/01/post/` resolves to `2026/09/01/post/index.html`,
   * and only that resolved name can tell a caller the right content type.
   */
  path: string;
}

export async function readPublicFile(
  owner: string,
  siteId: string,
  relPath: string,
): Promise<PublicFile | null> {
  let dir: string;
  try {
    dir = siteDir(owner, siteId);
  } catch {
    return null;
  }
  const publicRoot = resolve(dir, "public");
  let realRoot: string;
  try {
    realRoot = await realpath(publicRoot);
  } catch {
    return null;
  }
  if (!isInside(dir, realRoot)) return null;

  const safe = relPath.replace(/^\/+/, "").replace(/\/+$/, "").replaceAll("\\", "/");
  if (safe.includes("..")) return null;

  const tryRead = async (abs: string): Promise<PublicFile | null> => {
    if (!isInside(publicRoot, abs) && !isInside(realRoot, abs)) return null;
    try {
      const info = await lstat(abs);
      if (info.isSymbolicLink()) return null;
      if (info.isDirectory()) {
        const index = resolve(abs, "index.html");
        if (!isInside(publicRoot, index) && !isInside(realRoot, index)) return null;
        return readRegularFile(index, realRoot, publicRoot);
      }
      return readRegularFile(abs, realRoot, publicRoot);
    } catch {
      return null;
    }
  };

  const found =
    (await tryRead(resolve(publicRoot, safe))) ??
    (await tryRead(resolve(publicRoot, safe, "index.html")));
  if (found) return found;
  const looksLikePage = !safe.includes(".") || /\.html?$/i.test(safe);
  if (looksLikePage) return tryRead(resolve(publicRoot, "index.html"));
  return null;
}

export async function resetSite(owner: string, siteId: string): Promise<void> {
  await withSiteGate(owner, siteId, async () => {
    const dir = siteDir(owner, siteId);
    const ownerDir = resolve(env.workspaceRoot, owner);
    await rm(dir, { recursive: true, force: true });
    if (isInside(resolve(env.workspaceRoot), ownerDir)) {
      await mkdir(ownerDir, { recursive: true });
    }
  });
}

export async function listWorkspaces(owner: string): Promise<string[]> {
  if (!isSafeWorkspaceId(owner)) return [];
  try {
    return await readdir(resolve(env.workspaceRoot, owner));
  } catch {
    return [];
  }
}

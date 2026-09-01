import { resolve, sep } from "node:path";
import { mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
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
import { generateSite, scaffoldSite, updateSiteConfig, writeUserFiles } from "@open-pages/hexo-runner";
import { ClientError } from "../errors.js";
import { env } from "../env.js";

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

export async function ensureSite(
  owner: string,
  siteId: string,
  config: SiteConfig = DEFAULT_SITE_CONFIG,
): Promise<string> {
  const safeConfig = parseSiteConfig(config);
  const dir = siteDir(owner, siteId);
  try {
    await stat(resolve(dir, "_config.yml"));
  } catch {
    await scaffoldSite({
      siteDir: dir,
      config: safeConfig,
      files: [
        { path: WELCOME_POST_PATH, content: welcomeMarkdown() },
        { path: "source/about/index.md", content: aboutPageMarkdown() },
      ],
    });
  }
  return dir;
}

export async function syncSite(
  owner: string,
  siteId: string,
  files: SiteFile[],
  config?: SiteConfig,
): Promise<string> {
  const safeConfig = config ? parseSiteConfig(config) : undefined;
  const dir = await ensureSite(owner, siteId, safeConfig);
  if (safeConfig) {
    await updateSiteConfig(dir, safeConfig);
  }
  const rest = files.filter((file) => file.path !== "_config.yml");
  await writeUserFiles(dir, rest);
  return dir;
}

export function previewMount(siteId: string): string {
  if (!isSafeSiteId(siteId)) {
    throw new ClientError("Invalid site id");
  }
  return `/preview/${siteId}/`;
}

export async function previewSite(
  owner: string,
  siteId: string,
  files: SiteFile[],
  config?: SiteConfig,
) {
  const root = previewMount(siteId);
  const previewConfig = parseSiteConfig({
    ...(config ?? DEFAULT_SITE_CONFIG),
    url: env.appOrigin,
    root,
  });
  const dir = await syncSite(owner, siteId, files, previewConfig);
  return generateSite(dir, { rebaseRoot: root });
}

export async function readPublicFile(owner: string, siteId: string, relPath: string): Promise<Buffer | null> {
  let dir: string;
  try {
    dir = siteDir(owner, siteId);
  } catch {
    return null;
  }
  const publicRoot = resolve(dir, "public");
  const safe = relPath.replace(/^\/+/, "").replace(/\/+$/, "").replaceAll("\\", "/");
  if (safe.includes("..")) return null;

  const tryRead = async (abs: string): Promise<Buffer | null> => {
    if (!isInside(publicRoot, abs)) return null;
    try {
      const info = await stat(abs);
      if (info.isDirectory()) {
        const index = resolve(abs, "index.html");
        if (!isInside(publicRoot, index)) return null;
        return await readFile(index);
      }
      return await readFile(abs);
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
  const dir = siteDir(owner, siteId);
  const ownerDir = resolve(env.workspaceRoot, owner);
  await rm(dir, { recursive: true, force: true });
  if (isInside(resolve(env.workspaceRoot), ownerDir)) {
    await mkdir(ownerDir, { recursive: true });
  }
}

export async function listWorkspaces(owner: string): Promise<string[]> {
  if (!isSafeWorkspaceId(owner)) return [];
  try {
    return await readdir(resolve(env.workspaceRoot, owner));
  } catch {
    return [];
  }
}

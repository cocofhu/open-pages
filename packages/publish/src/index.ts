import { homedir } from "node:os";
import { join } from "node:path";
import { mkdir, readFile, stat } from "node:fs/promises";
import {
  DEFAULT_SITE_CONFIG,
  fileKind,
  isSafeSiteId,
  isUserEditablePath,
  manifestAddonsFromCatalog,
  openPagesManifestFile,
  openPagesReadmeFile,
  ORIGIN_PREFIX,
  pagesUrl,
  parseCustomDomain,
  parseRepoName,
  parseSiteConfig,
  publishUrlAndRoot,
  withCnameFile,
  aboutPageMarkdown,
  welcomeMarkdown,
  WELCOME_POST_PATH,
  type AddonManifest,
  type SiteConfig,
  type SiteFile,
} from "@open-pages/shared";
import { assessRepoForPublish, commitFiles, createRepo, enablePages, listBranchPathsWithPrefix, readPagesCustomDomain } from "@open-pages/github";
import type { GenerationAddons } from "@open-pages/addons";
import {
  generateSite,
  joinPreviewUrl,
  listPublicFiles,
  resolveSourcePermalink,
  scaffoldSite,
  updateSiteConfig,
  writeUserFiles,
} from "@open-pages/hexo-runner";

export function defaultSitesRoot(): string {
  return join(homedir(), ".open-pages", "sites");
}

export function localSiteDir(siteId: string, root = defaultSitesRoot()): string {
  if (!isSafeSiteId(siteId)) throw new Error("Invalid site id");
  return join(root, siteId);
}

export async function prepareSite(
  siteDir: string,
  files: SiteFile[],
  config: SiteConfig,
  themeSource?: string,
): Promise<string> {
  const safe = parseSiteConfig(config);
  await mkdir(siteDir, { recursive: true });
  try {
    await stat(join(siteDir, "_config.yml"));
  } catch {
    await scaffoldSite({
      siteDir,
      config: safe,
      files: [
        { path: WELCOME_POST_PATH, content: welcomeMarkdown() },
        { path: "source/about/index.md", content: aboutPageMarkdown() },
      ],
      themeSource,
    });
  }
  await updateSiteConfig(siteDir, safe, themeSource);
  const rest = files.filter((file) => file.path !== "_config.yml");
  await writeUserFiles(siteDir, rest);
  return siteDir;
}

export function publishableSourceFiles(files: SiteFile[]): SiteFile[] {
  return files.filter((file) => isUserEditablePath(file.path));
}

export async function previewLocalSite(options: {
  siteId: string;
  files: SiteFile[];
  config?: unknown;
  previewOrigin: string;
  sitesRoot?: string;
  addons?: GenerationAddons;
  sourcePath?: string;
}): Promise<{ publicDir: string; elapsedMs: number; url: string; rebaseRoot: string }> {
  const rebaseRoot = `/preview/${options.siteId}/`;
  const config = parseSiteConfig({
    ...(options.config ?? DEFAULT_SITE_CONFIG),
    url: options.previewOrigin,
    root: rebaseRoot,
  });
  const siteDir = localSiteDir(options.siteId, options.sitesRoot);
  await prepareSite(siteDir, options.files, config, options.addons?.themeSource);
  const includeDrafts = Boolean(options.sourcePath && fileKind(options.sourcePath) === "draft");
  const result = await generateSite(siteDir, {
    rebaseRoot,
    draft: includeDrafts,
    ...options.addons,
  });
  const baseUrl = `${options.previewOrigin}${rebaseRoot}`;
  if (!options.sourcePath) {
    return {
      publicDir: result.publicDir,
      elapsedMs: result.elapsedMs,
      url: baseUrl,
      rebaseRoot,
    };
  }
  const pagePath = resolveSourcePermalink(result.sourcePaths, options.sourcePath);
  if (!pagePath) {
    throw new Error(`找不到当前文档的预览页：${options.sourcePath}`);
  }
  return {
    publicDir: result.publicDir,
    elapsedMs: result.elapsedMs,
    url: joinPreviewUrl(baseUrl, pagePath),
    rebaseRoot,
  };
}

/**
 * Resolve domain for publish: explicit settings value wins; otherwise preserve remote.
 * Always parse so CNAME injection and url/root stay consistent (reject illegal hosts).
 */
export async function resolvePublishCustomDomain(
  token: string,
  owner: string,
  repo: string,
  requested?: string | null,
): Promise<string | null> {
  if (typeof requested === "string") {
    const parsed = parseCustomDomain(requested);
    if (!parsed.ok) {
      throw new Error(parsed.error);
    }
    return parsed.hostname || null;
  }
  return readPagesCustomDomain(token, owner, repo);
}

export async function publishSite(options: {
  token: string;
  siteId: string;
  files: SiteFile[];
  config?: unknown;
  owner: string;
  repo: string;
  createRepo?: boolean;
  sitesRoot?: string;
  addons?: GenerationAddons;
  catalog?: AddonManifest[];
  /** Target custom domain from settings; omit to preserve GitHub/CNAME; empty to clear. */
  customDomain?: string | null;
}): Promise<{ url: string; owner: string; repo: string; root: string }> {
  const owner = options.owner;
  const repo = parseRepoName(options.repo);
  if (!isSafeSiteId(options.siteId)) throw new Error("Invalid site id");
  if (options.createRepo) {
    await createRepo(options.token, repo, false);
  } else {
    const check = await assessRepoForPublish(options.token, owner, repo, options.siteId);
    if (!check.eligible) throw new Error(check.message);
  }

  const hostname = await resolvePublishCustomDomain(
    options.token,
    owner,
    repo,
    options.customDomain,
  );
  const { url: siteUrl, root: siteRoot } = publishUrlAndRoot(owner, repo, hostname);

  const config = options.config
    ? parseSiteConfig({
        ...parseSiteConfig(options.config),
        url: siteUrl,
        root: siteRoot,
      })
    : parseSiteConfig({
        ...DEFAULT_SITE_CONFIG,
        url: siteUrl,
        root: siteRoot,
      });

  const siteDir = localSiteDir(options.siteId, options.sitesRoot);
  await prepareSite(siteDir, options.files ?? [], config, options.addons?.themeSource);
  await generateSite(siteDir, { rebaseRoot: config.root, ...options.addons });

  const sourceFiles = publishableSourceFiles(options.files ?? []).filter(
    (file) => file.path !== "_config.yml",
  );
  try {
    sourceFiles.push({
      path: "_config.yml",
      content: await readFile(join(siteDir, "_config.yml"), "utf8"),
    });
  } catch {
    // keep empty if missing
  }
  const displayPagesUrl = hostname ? `https://${hostname}/` : pagesUrl(owner, repo);
  sourceFiles.push(
    openPagesManifestFile(options.siteId, {
      theme: config.theme,
      addons: manifestAddonsFromCatalog(options.catalog ?? [], config.theme),
    }),
  );
  sourceFiles.push(
    openPagesReadmeFile({
      title: config.title,
      description: config.description,
      pagesUrl: displayPagesUrl,
      theme: config.theme,
      owner,
      repo,
    }),
  );

  // Plan g3.2: never commit origin; delete any remote source/origin blobs from current tree.
  const remoteOriginPaths = await listBranchPathsWithPrefix({
    token: options.token,
    owner,
    repo,
    branch: "main",
    prefix: ORIGIN_PREFIX,
  });
  await commitFiles({
    token: options.token,
    owner,
    repo,
    branch: "main",
    message: "chore: update site source from Open Pages",
    files: sourceFiles,
    deletePaths: remoteOriginPaths,
  });

  const publicFiles = withCnameFile(await listPublicFiles(join(siteDir, "public")), hostname);
  await commitFiles({
    token: options.token,
    owner,
    repo,
    branch: "gh-pages",
    message: "chore: publish hexo public from Open Pages",
    files: publicFiles,
    replace: true,
  });

  const url = await enablePages(options.token, owner, repo, hostname);
  return {
    url,
    owner,
    repo,
    root: siteRoot,
  };
}

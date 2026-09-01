import { homedir } from "node:os";
import { join } from "node:path";
import { mkdir, readFile, stat } from "node:fs/promises";
import {
  DEFAULT_SITE_CONFIG,
  isSafeSiteId,
  isUserEditablePath,
  openPagesManifestFile,
  openPagesReadmeFile,
  pagesRoot,
  pagesUrl,
  parseRepoName,
  parseSiteConfig,
  aboutPageMarkdown,
  welcomeMarkdown,
  WELCOME_POST_PATH,
  type SiteConfig,
  type SiteFile,
} from "@open-pages/shared";
import { assessRepoForPublish, commitFiles, createRepo, enablePages } from "@open-pages/github";
import {
  generateSite,
  listPublicFiles,
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
    });
  }
  await updateSiteConfig(siteDir, safe);
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
}): Promise<{ publicDir: string; elapsedMs: number; url: string; rebaseRoot: string }> {
  const rebaseRoot = `/preview/${options.siteId}/`;
  const config = parseSiteConfig({
    ...(options.config ?? DEFAULT_SITE_CONFIG),
    url: options.previewOrigin,
    root: rebaseRoot,
  });
  const siteDir = localSiteDir(options.siteId, options.sitesRoot);
  await prepareSite(siteDir, options.files, config);
  const result = await generateSite(siteDir, { rebaseRoot });
  return {
    publicDir: result.publicDir,
    elapsedMs: result.elapsedMs,
    url: `${options.previewOrigin}${rebaseRoot}`,
    rebaseRoot,
  };
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

  const config = options.config
    ? parseSiteConfig({
        ...parseSiteConfig(options.config),
        url: pagesUrl(owner, repo).replace(/\/$/, ""),
        root: pagesRoot(owner, repo),
      })
    : parseSiteConfig({
        ...DEFAULT_SITE_CONFIG,
        url: pagesUrl(owner, repo).replace(/\/$/, ""),
        root: pagesRoot(owner, repo),
      });

  const siteDir = localSiteDir(options.siteId, options.sitesRoot);
  await prepareSite(siteDir, options.files ?? [], config);
  await generateSite(siteDir, { rebaseRoot: config.root });

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
  sourceFiles.push(openPagesManifestFile(options.siteId));
  sourceFiles.push(
    openPagesReadmeFile({
      title: config.title,
      description: config.description,
      pagesUrl: pagesUrl(owner, repo),
      theme: config.theme,
      owner,
      repo,
    }),
  );

  await commitFiles({
    token: options.token,
    owner,
    repo,
    branch: "main",
    message: "chore: update site source from Open Pages",
    files: sourceFiles,
  });

  const publicFiles = await listPublicFiles(join(siteDir, "public"));
  await commitFiles({
    token: options.token,
    owner,
    repo,
    branch: "gh-pages",
    message: "chore: publish hexo public from Open Pages",
    files: publicFiles,
    replace: true,
  });

  const url = await enablePages(options.token, owner, repo);
  return {
    url,
    owner,
    repo,
    root: pagesRoot(owner, repo),
  };
}

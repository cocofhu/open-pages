import {
  DEFAULT_SITE_CONFIG,
  aboutPageMarkdown,
  defaultHexoConfigYaml,
  isOriginPath,
  isThemeConfigPath,
  isThemeId,
  isUserEditablePath,
  originSnapshotPath,
  parseOpenPagesSiteManifest,
  siteConfigFromHexoYaml,
  welcomeMarkdown,
  WELCOME_POST_PATH,
  type AddonKind,
  type AddonManifest,
  type GithubBinding,
  type SiteConfig,
  type SiteFile,
} from "@open-pages/shared";
import { deleteByPrefix, deleteFile, listFiles, writeFile, writeFiles } from "./vfs";
import { platform } from "./platform";

export interface SyncProgress {
  label: string;
  percent: number;
}

export interface RepoSyncResult {
  config: SiteConfig;
  binding: GithubBinding;
  warning?: string;
}

export function isLiveImportPath(path: string): boolean {
  if (isOriginPath(path)) return false;
  if (path === "README.md" || path === "manifest.json") return false;
  return isUserEditablePath(path) || isThemeConfigPath(path);
}

/** Live paths present locally but absent from the new snapshot must be removed. */
export function livePathsMissingFromSnapshot(
  existingPaths: string[],
  snapshotPaths: string[],
): string[] {
  const keep = new Set(snapshotPaths.filter((path) => isLiveImportPath(path)));
  return existingPaths.filter((path) => isLiveImportPath(path) && !keep.has(path));
}

export function blankSiteSeedFiles(): SiteFile[] {
  return [
    {
      path: "_config.yml",
      content: defaultHexoConfigYaml(DEFAULT_SITE_CONFIG),
      encoding: "utf8",
    },
    {
      path: WELCOME_POST_PATH,
      content: welcomeMarkdown(),
      encoding: "utf8",
    },
    {
      path: "source/about/index.md",
      content: aboutPageMarkdown(),
      encoding: "utf8",
    },
  ];
}

/** Pure check used by Settings and publish-finish tests. */
export function unpublishedRepoChangesFromFiles(
  files: Array<{ path: string; content: string; encoding: string }>,
): boolean {
  const byPath = new Map(files.map((file) => [file.path, file]));
  const origins = files.filter((file) => isOriginPath(file.path));
  if (!origins.length) return files.some((file) => isLiveImportPath(file.path));
  for (const file of files) {
    if (!isLiveImportPath(file.path)) continue;
    const origin = byPath.get(originSnapshotPath(file.path));
    if (!origin || origin.content !== file.content || origin.encoding !== file.encoding) return true;
  }
  for (const origin of origins) {
    const live = origin.path.slice("source/origin/".length);
    if (!isLiveImportPath(live)) continue;
    if (!byPath.has(live)) return true;
  }
  return false;
}

export async function hasUnpublishedRepoChanges(): Promise<boolean> {
  return unpublishedRepoChangesFromFiles(await listFiles());
}

/** Snapshot live editable files into source/origin/ (publish success / blank seed). */
export function originSnapshotsFromLive(
  files: Array<{ path: string; content: string; encoding?: "utf8" | "base64" }>,
): SiteFile[] {
  return files
    .filter((file) => isLiveImportPath(file.path))
    .map((file) => ({
      path: originSnapshotPath(file.path),
      content: file.content,
      encoding: file.encoding ?? "utf8",
    }));
}

/** Rewrite origin from current live editable files after a successful publish. */
export async function captureOriginFromLive(): Promise<void> {
  const files = await listFiles();
  await deleteByPrefix("source/origin/");
  await writeFiles(originSnapshotsFromLive(files));
}

async function removeLivePaths(paths: string[]): Promise<void> {
  for (const path of paths) {
    await deleteFile(path);
  }
}

/**
 * Replace local live files + origin with the remote snapshot.
 * Empty snapshots fall back to the product blank-site seed so old posts cannot linger.
 */
export async function applyRepoSnapshot(
  snapshot: { files: SiteFile[]; defaultBranch: string },
  owner: string,
  repo: string,
  onProgress?: (progress: SyncProgress) => void,
  previous?: GithubBinding,
): Promise<RepoSyncResult> {
  const liveFromSnapshot = snapshot.files.filter((file) => isLiveImportPath(file.path));
  const useBlankSeed = liveFromSnapshot.length === 0;
  const targetLive = useBlankSeed ? blankSiteSeedFiles() : liveFromSnapshot;

  onProgress?.({ label: "正在写入 origin 备份", percent: 72 });
  await deleteByPrefix("source/origin/");
  // Empty remote → blank seed: still write origin so the bind card is not forever dirty.
  const originSource = useBlankSeed ? targetLive : snapshot.files;
  if (originSource.length) {
    await writeFiles(originSnapshotsFromLive(originSource));
  }

  onProgress?.({ label: "正在替换本地站点", percent: 80 });
  const existing = await listFiles();
  const stale = livePathsMissingFromSnapshot(
    existing.map((file) => file.path),
    targetLive.map((file) => file.path),
  );
  await removeLivePaths(stale);
  await writeFiles(targetLive);

  const configFile = useBlankSeed
    ? undefined
    : snapshot.files.find((file) => file.path === "_config.yml" && file.encoding !== "base64");
  let config = configFile ? siteConfigFromHexoYaml(configFile.content) : { ...DEFAULT_SITE_CONFIG };
  const manifestFile = snapshot.files.find((file) => file.path === "manifest.json" && file.encoding !== "base64");
  const manifest = manifestFile ? parseOpenPagesSiteManifest(manifestFile.content) : null;
  if (manifest?.theme && isThemeId(manifest.theme)) {
    config = { ...config, theme: manifest.theme };
  }

  onProgress?.({ label: "正在恢复主题和插件", percent: 86 });
  const warning = useBlankSeed
    ? undefined
    : await restoreAddons(manifest?.addons ?? [], config, onProgress);
  if (configFile) await writeFile("_config.yml", configFile.content);

  return {
    config,
    binding: {
      owner,
      repo,
      defaultBranch: snapshot.defaultBranch,
      ...(typeof previous?.customDomain === "string" ? { customDomain: previous.customDomain } : {}),
    },
    warning,
  };
}

/** Clear old live files and origin, then write the product blank-site seed + matching origin. */
export async function resetBlankSite(
  owner: string,
  repo: string,
  pagesUrl?: string,
  onProgress?: (progress: SyncProgress) => void,
): Promise<RepoSyncResult> {
  onProgress?.({ label: "正在重置为空白站点", percent: 60 });
  await deleteByPrefix("source/origin/");
  const existing = await listFiles();
  const live = existing.map((file) => file.path).filter((path) => isLiveImportPath(path));
  await removeLivePaths(live);
  const seeds = blankSiteSeedFiles();
  await writeFiles(seeds);
  // Seed origin with the same blank site so hasUnpublishedRepoChanges stays false until edits.
  await writeFiles(originSnapshotsFromLive(seeds));
  return {
    config: { ...DEFAULT_SITE_CONFIG },
    binding: {
      owner,
      repo,
      defaultBranch: "main",
      pagesUrl,
    },
  };
}

async function restoreAddons(
  recorded: Array<{ kind: "theme" | "plugin"; source?: string; id?: string; enabled?: boolean }>,
  config: SiteConfig,
  onProgress?: (progress: SyncProgress) => void,
): Promise<string | undefined> {
  const catalog = await platform.addons().then((data) => data.addons).catch(() => [] as AddonManifest[]);
  const warnings: string[] = [];

  if (!recorded.length && !catalog.some((addon) => addon.kind === "theme" && addon.id === config.theme)) {
    if (!catalog.some((addon) => addon.id === config.theme)) {
      warnings.push(`主题 ${config.theme} 没有记录安装地址，请在设置里手动安装`);
    }
  }

  for (const item of recorded) {
    if (!item.source) {
      if (item.kind === "plugin" && item.id && item.enabled === false) {
        await platform.setAddonEnabled(item.id, false).catch(() => undefined);
      }
      continue;
    }
    const source = item.source;
    const already = catalog.some((addon) => {
      if (item.id && addon.id === item.id) return true;
      if (addon.source.type === "github") return source === addon.source.repo;
      if (addon.source.type === "npm") return source.startsWith(addon.packageName);
      return false;
    });
    if (already) {
      if (item.kind === "plugin" && item.id && item.enabled === false) {
        await platform.setAddonEnabled(item.id, false).catch(() => undefined);
      }
      continue;
    }
    onProgress?.({
      label: item.kind === "theme" ? `正在恢复主题 ${source}` : `正在恢复插件 ${source}`,
      percent: 90,
    });
    try {
      await platform.installAddon(source, item.kind as AddonKind);
      if (item.kind === "plugin" && item.id && item.enabled === false) {
        await platform.setAddonEnabled(item.id, false).catch(() => undefined);
      }
    } catch (error) {
      warnings.push(error instanceof Error ? error.message : `无法安装 ${item.source}`);
    }
  }

  return warnings.length ? warnings.join("；") : undefined;
}

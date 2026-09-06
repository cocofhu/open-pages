import {
  DEFAULT_SITE_CONFIG,
  isOriginPath,
  isThemeConfigPath,
  isThemeId,
  isUserEditablePath,
  originSnapshotPath,
  parseOpenPagesSiteManifest,
  siteConfigFromHexoYaml,
  type AddonKind,
  type AddonManifest,
  type GithubBinding,
  type SiteConfig,
  type SiteFile,
} from "@open-pages/shared";
import { deleteByPrefix, writeFile, writeFiles } from "./vfs";
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

function isLiveImportPath(path: string): boolean {
  if (isOriginPath(path)) return false;
  if (path === "README.md" || path === "manifest.json") return false;
  return isUserEditablePath(path) || isThemeConfigPath(path);
}

export async function applyRepoSnapshot(
  snapshot: { files: SiteFile[]; defaultBranch: string },
  owner: string,
  repo: string,
  onProgress?: (progress: SyncProgress) => void,
): Promise<RepoSyncResult> {
  onProgress?.({ label: "正在写入 origin 备份", percent: 72 });
  await deleteByPrefix("source/origin/");
  await writeFiles(
    snapshot.files.map((file) => ({
      path: originSnapshotPath(file.path),
      content: file.content,
      encoding: file.encoding,
    })),
  );

  const live = snapshot.files.filter((file) => isLiveImportPath(file.path));
  if (live.length) {
    onProgress?.({ label: "正在导入文章和配置", percent: 80 });
    await writeFiles(live);
  }

  const configFile = snapshot.files.find((file) => file.path === "_config.yml" && file.encoding !== "base64");
  let config = configFile ? siteConfigFromHexoYaml(configFile.content) : { ...DEFAULT_SITE_CONFIG };
  const manifestFile = snapshot.files.find((file) => file.path === "manifest.json" && file.encoding !== "base64");
  const manifest = manifestFile ? parseOpenPagesSiteManifest(manifestFile.content) : null;
  if (manifest?.theme && isThemeId(manifest.theme)) {
    config = { ...config, theme: manifest.theme };
  }

  onProgress?.({ label: "正在恢复主题和插件", percent: 86 });
  const warning = await restoreAddons(manifest?.addons ?? [], config, onProgress);
  if (configFile) await writeFile("_config.yml", configFile.content);

  return {
    config,
    binding: {
      owner,
      repo,
      defaultBranch: snapshot.defaultBranch,
    },
    warning,
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

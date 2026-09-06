import {
  type AddonKind,
  type AddonManifest,
  type SiteConfig,
  type SiteFile,
} from "@open-pages/shared";
import { api, type AuthUser, type GithubRepo, type InstallStep } from "./api";
import type { PublishRepoCheck } from "@open-pages/shared";
import { errorMessage } from "./errors";

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    const { invoke: tauriInvoke } = await import("@tauri-apps/api/core");
    return await tauriInvoke<T>(command, args);
  } catch (error) {
    throw new Error(errorMessage(error, `${command} failed`));
  }
}

export const platform = {
  isDesktop: isTauri,

  async me(): Promise<AuthUser | null> {
    if (!isTauri()) {
      try {
        return await api.me();
      } catch {
        return null;
      }
    }
    return invoke<AuthUser>("github_get_session");
  },

  async login(opts?: {
    onCode?: (userCode: string, verificationUri: string) => void;
  }): Promise<AuthUser | null> {
    if (isTauri()) {
      return invoke<AuthUser>("github_login");
    }
    const started = await api.startDeviceLogin();
    opts?.onCode?.(
      started.userCode,
      started.verificationUriComplete || started.verificationUri,
    );
    let intervalMs = Math.max(started.interval, 5) * 1000;
    const deadline = Date.now() + Math.min(started.expiresIn, 900) * 1000;
    while (Date.now() < deadline) {
      await new Promise((resolve) => window.setTimeout(resolve, intervalMs));
      const result = await api.pollDeviceLogin();
      if (result.status === "ok" && result.user) return result.user;
      if (result.status === "slow_down") intervalMs += 5000;
    }
    throw new Error("GitHub 登录码已过期，请重新登录。");
  },

  async logout(): Promise<AuthUser | null> {
    if (!isTauri()) {
      await api.logout();
      return api.me();
    }
    return invoke<AuthUser>("github_logout");
  },

  async addons(kind?: AddonKind): Promise<{ addons: AddonManifest[] }> {
    if (!isTauri()) return api.addons(kind);
    return invoke<{ addons: AddonManifest[] }>("list_addons", kind ? { kind } : {});
  },

  async preview(siteId: string, files: SiteFile[], config: SiteConfig, sourcePath?: string) {
    if (!isTauri()) return api.preview(siteId, files, config, sourcePath);
    return invoke<{ ok: boolean; url: string; elapsedMs: number }>("preview_site", {
      payload: { siteId, files, config, ...(sourcePath ? { sourcePath } : {}) },
    });
  },

  async repos(siteId = "default"): Promise<{ repos: GithubRepo[] }> {
    if (!isTauri()) return api.repos(siteId);
    return invoke<{ repos: GithubRepo[] }>("list_repos", { siteId });
  },

  async checkRepoForPublish(owner: string, repo: string, siteId: string): Promise<PublishRepoCheck> {
    if (!isTauri()) return api.publishCheck(owner, repo, siteId);
    return invoke<PublishRepoCheck>("check_repo_publish", { owner, repo, siteId });
  },

  async downloadRepoSnapshot(owner: string, repo: string) {
    if (!isTauri()) return api.repoSnapshot(owner, repo);
    return invoke<{ files: SiteFile[]; defaultBranch: string }>("download_repo_snapshot", {
      owner,
      repo,
    });
  },

  async createRepo(name: string) {
    if (!isTauri()) return api.createRepo(name);
    return invoke<{ owner: string; repo: string; pagesUrl: string; root: string }>("create_repo", {
      name,
    });
  },

  async publish(
    siteId: string,
    payload: {
      files: SiteFile[];
      config: SiteConfig;
      owner?: string;
      repo: string;
      createRepo?: boolean;
    },
  ) {
    if (!isTauri()) return api.publish(siteId, payload);
    return invoke<{ ok: boolean; url: string; owner: string; repo: string }>("publish_site", {
      payload: { siteId, ...payload },
    });
  },

  async installAddon(source: string, kind: AddonKind, onProgress?: (step: InstallStep) => void) {
    if (!isTauri()) return api.installAddon(source, kind, onProgress);
    onProgress?.({ label: "正在安装", percent: 12 });
    const result = await invoke<{ addon: AddonManifest }>("install_addon", { source, kind });
    onProgress?.({ label: "安装完成", percent: 100 });
    return result;
  },

  async updateAddon(id: string, onProgress?: (step: InstallStep) => void) {
    if (!isTauri()) return api.updateAddon(id, onProgress);
    onProgress?.({ label: "正在更新", percent: 12 });
    const result = await invoke<{ addon: AddonManifest }>("update_addon", { id });
    onProgress?.({ label: "更新完成", percent: 100 });
    return result;
  },

  async setAddonEnabled(id: string, enabled: boolean) {
    if (!isTauri()) return api.setAddonEnabled(id, enabled);
    return invoke<{ addon: AddonManifest }>("set_addon_enabled", { id, enabled });
  },

  async removeAddon(id: string) {
    if (!isTauri()) return api.removeAddon(id);
    return invoke<{ ok: boolean }>("remove_addon", { id });
  },

  async openSiteDir(siteId: string, path?: string): Promise<void> {
    if (!isTauri()) throw new Error("仅桌面版支持打开本地文件夹");
    await invoke("open_site_dir", { siteId, path });
  },
};

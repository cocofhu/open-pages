import {
  BUILTIN_ADDONS,
  type AddonKind,
  type AddonManifest,
  type SiteConfig,
  type SiteFile,
} from "@open-pages/shared";
import { api, type AuthUser, type GithubRepo, type InstallStep } from "./api";
import type { PublishRepoCheck } from "@open-pages/shared";

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke: tauriInvoke } = await import("@tauri-apps/api/core");
  return tauriInvoke<T>(command, args);
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

  async login(): Promise<AuthUser | null> {
    if (!isTauri()) {
      window.location.href = "/auth/github";
      return null;
    }
    return invoke<AuthUser>("github_login");
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
    const addons = kind ? BUILTIN_ADDONS.filter((addon) => addon.kind === kind) : BUILTIN_ADDONS;
    return { addons };
  },

  async preview(siteId: string, files: SiteFile[], config: SiteConfig) {
    if (!isTauri()) return api.preview(siteId, files, config);
    return invoke<{ ok: boolean; url: string; elapsedMs: number }>("preview_site", {
      payload: { siteId, files, config },
    });
  },

  async repos(): Promise<{ repos: GithubRepo[] }> {
    if (!isTauri()) return api.repos();
    return invoke<{ repos: GithubRepo[] }>("list_repos");
  },

  async checkRepoForPublish(owner: string, repo: string, siteId: string): Promise<PublishRepoCheck> {
    if (!isTauri()) return api.publishCheck(owner, repo, siteId);
    return invoke<PublishRepoCheck>("check_repo_publish", { owner, repo, siteId });
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
    if (isTauri()) throw new Error("桌面版暂不支持安装扩展");
    return api.installAddon(source, kind, onProgress);
  },

  async setAddonEnabled(id: string, enabled: boolean) {
    if (isTauri()) throw new Error("桌面版暂不支持安装扩展");
    return api.setAddonEnabled(id, enabled);
  },

  async removeAddon(id: string) {
    if (isTauri()) throw new Error("桌面版暂不支持安装扩展");
    return api.removeAddon(id);
  },
};

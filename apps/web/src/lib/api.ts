import type { SiteConfig, SiteFile } from "@open-pages/shared";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: "include",
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) {
    throw new Error(data.error || response.statusText);
  }
  return data;
}

export interface AuthUser {
  guestId: string;
  login: string | null;
  name: string | null;
  avatarUrl: string | null;
  githubEnabled: boolean;
}

export interface GithubRepo {
  id: number;
  name: string;
  fullName: string;
  private: boolean;
  defaultBranch: string;
  htmlUrl: string;
  pagesUrl: string;
}

export const api = {
  me: () => request<AuthUser>("/auth/me"),
  logout: () => request<{ ok: boolean }>("/auth/logout", { method: "POST" }),
  preview: (siteId: string, files: SiteFile[], config: SiteConfig) =>
    request<{ ok: boolean; url: string; elapsedMs: number }>(`/sites/${siteId}/preview`, {
      method: "POST",
      body: JSON.stringify({ files, config }),
    }),
  sync: (siteId: string, files: SiteFile[], config: SiteConfig) =>
    request<{ ok: boolean }>(`/sites/${siteId}/sync`, {
      method: "POST",
      body: JSON.stringify({ files, config }),
    }),
  repos: () => request<{ repos: GithubRepo[] }>("/sites/github/repos"),
  createRepo: (name: string) =>
    request<{ owner: string; repo: string; pagesUrl: string; root: string }>("/sites/github/repos", {
      method: "POST",
      body: JSON.stringify({ name }),
    }),
  publish: (siteId: string, payload: {
    files: SiteFile[];
    config: SiteConfig;
    owner?: string;
    repo: string;
    createRepo?: boolean;
  }) =>
    request<{ ok: boolean; url: string; owner: string; repo: string }>(`/sites/${siteId}/publish`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
};

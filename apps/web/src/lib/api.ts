import type { AddonKind, AddonManifest, PublishRepoCheck, SiteConfig, SiteFile } from "@open-pages/shared";

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

export interface InstallStep {
  label: string;
  percent: number;
}

/**
 * Installs run for tens of seconds, so the API streams stage updates over SSE
 * instead of leaving the UI blocked on a single response.
 */
async function installAddon(
  source: string,
  kind: AddonKind,
  onProgress?: (step: InstallStep) => void,
): Promise<{ addon: AddonManifest }> {
  const response = await fetch("/addons/install", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify({ source, kind }),
  });
  if (!response.ok || !response.body) {
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error || response.statusText);
  }

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  let installed: AddonManifest | null = null;
  let failure: string | null = null;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += value;
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      const payload = frame
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .join("");
      if (!payload) continue;
      const event = JSON.parse(payload) as {
        type: "progress" | "done" | "error";
        label?: string;
        percent?: number;
        addon?: AddonManifest;
        error?: string;
      };
      if (event.type === "progress") onProgress?.({ label: event.label ?? "", percent: event.percent ?? 0 });
      if (event.type === "done" && event.addon) installed = event.addon;
      if (event.type === "error") failure = event.error ?? "安装失败";
    }
  }

  if (failure) throw new Error(failure);
  if (!installed) throw new Error("安装中断，请重试");
  return { addon: installed };
}

export const api = {
  me: () => request<AuthUser>("/auth/me"),
  logout: () => request<{ ok: boolean }>("/auth/logout", { method: "POST" }),
  addons: (kind?: AddonKind) =>
    request<{ addons: AddonManifest[] }>(`/addons${kind ? `?kind=${kind}` : ""}`),
  installAddon: (source: string, kind: AddonKind, onProgress?: (step: InstallStep) => void) =>
    installAddon(source, kind, onProgress),
  setAddonEnabled: (id: string, enabled: boolean) =>
    request<{ addon: AddonManifest }>(`/addons/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ enabled }),
    }),
  removeAddon: (id: string) =>
    request<{ ok: boolean }>(`/addons/${encodeURIComponent(id)}`, { method: "DELETE" }),
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
  publishCheck: (owner: string, repo: string, siteId: string) =>
    request<PublishRepoCheck>(
      `/sites/github/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/publish-check?siteId=${encodeURIComponent(siteId)}`,
    ),
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

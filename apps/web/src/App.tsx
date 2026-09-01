import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  applySiteConfigToYaml,
  defaultFrontMatter,
  defaultHexoConfigYaml,
  defaultThemeSettings,
  fileKind,
  isThemeId,
  parseFrontMatter,
  parseSiteConfig,
  parseThemeSettings,
  serializeFrontMatter,
  serializeThemeSettings,
  slugify,
  themeConfigPath,
  type FrontMatter,
  type GithubBinding,
  type SiteConfig,
  type SiteFile,
  type ThemeId,
  type ThemeSettings,
} from "@open-pages/shared";
import { ConfirmDialog } from "./components/ConfirmDialog";
import type { SettingsDraft } from "./components/SettingsPage";
import { DocMetaPanel } from "./components/DocMetaPanel";
import { MarkdownEditor, SourceEditor } from "./components/Editor";
import { FileTree } from "./components/FileTree";
import { FrontMatterBar } from "./components/FrontMatterBar";
import { NewDocDialog, type DocKind } from "./components/NewDocDialog";
import { PublishPage } from "./components/PublishPage";
import { SettingsPage, type SettingsTab } from "./components/SettingsPage";
import { Toast, type ToastState } from "./components/Toast";
import { TopBar, type EditorMode } from "./components/TopBar";
import { api, type AuthUser } from "./lib/api";
import {
  deleteFile,
  listFiles,
  loadConfig,
  readFile,
  saveConfig,
  siteId,
  snapshotFiles,
  storeLocalImage,
  resolveLocalImageUrl,
  uniqueUserPath,
  writeFile,
} from "./lib/vfs";

export function App() {
  const [files, setFiles] = useState<{ path: string; title: string }[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [body, setBody] = useState("");
  const [matter, setMatter] = useState<FrontMatter>(defaultFrontMatter());
  const [source, setSource] = useState("");
  const [config, setConfig] = useState<SiteConfig | null>(null);
  const [github, setGithub] = useState<GithubBinding | undefined>();
  const [rawYaml, setRawYaml] = useState("");
  const [mode, setMode] = useState<EditorMode>("wysiwyg");
  const [docMetaOpen, setDocMetaOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(
    () => !window.matchMedia("(max-width: 860px)").matches,
  );
  const [online, setOnline] = useState(navigator.onLine);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [route, setRoute] = useState<AppRoute>(routeFromHash);
  const [publishBusy, setPublishBusy] = useState(false);
  const [publishStatus, setPublishStatus] = useState("");
  const [publishUrl, setPublishUrl] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [newDocOpen, setNewDocOpen] = useState(false);
  const [newDocKind, setNewDocKind] = useState<DocKind>("post");
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [themeSettings, setThemeSettings] = useState<ThemeSettings>({});
  const [themeReady, setThemeReady] = useState(false);
  const [themePreviewUrl, setThemePreviewUrl] = useState<string | null>(null);
  const [themePreviewError, setThemePreviewError] = useState<string | null>(null);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsLeaveOpen, setSettingsLeaveOpen] = useState(false);
  const settingsDraftRef = useRef<SettingsDraft | null>(null);
  const settingsDirtyRef = useRef(false);
  const pendingRouteRef = useRef<AppRoute | null>(null);
  const themeReadyRef = useRef(false);
  const routeRef = useRef(route);
  const writeChainRef = useRef(Promise.resolve());
  routeRef.current = route;

  const enqueueWrite = useCallback((task: () => Promise<void>) => {
    const next = writeChainRef.current.then(task, task);
    writeChainRef.current = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }, []);

  const refreshTree = useCallback(async () => {
    const list = await listFiles();
    setFiles(
      list
        .filter((file) => {
          const kind = fileKind(file.path);
          return kind === "post" || kind === "draft" || kind === "page";
        })
        .map((file) => ({
          path: file.path,
          title:
            file.encoding !== "base64" && file.path.endsWith(".md")
              ? parseFrontMatter(file.content).matter.title
              : file.path.split("/").pop() ?? file.path,
        })),
    );
    return list;
  }, []);

  const openPath = useCallback(async (path: string) => {
    const file = await readFile(path);
    if (!file || file.encoding === "base64") {
      setActivePath(path);
      return;
    }
    const parsed = parseFrontMatter(file.content);
    setActivePath(path);
    setMatter(parsed.matter);
    setBody(parsed.body);
    setSource(file.content);
    setMode("wysiwyg");
    setDocMetaOpen(false);
  }, []);

  useEffect(() => {
    void (async () => {
      const { config: nextConfig, github: binding } = await loadConfig();
      setConfig(nextConfig);
      setGithub(binding);
      const list = await refreshTree();
      const yamlFile = list.find((file) => file.path === "_config.yml" && file.encoding !== "base64");
      setRawYaml(yamlFile?.content ?? defaultHexoConfigYaml(nextConfig));
      const first =
        list.find((file) => fileKind(file.path) === "post") ??
        list.find((file) => {
          const kind = fileKind(file.path);
          return kind === "draft" || kind === "page";
        });
      if (first) await openPath(first.path);
    })();
  }, [openPath, refreshTree]);

  useEffect(() => {
    if (!activePath?.endsWith(".md")) return;
    setFiles((current) =>
      current.map((file) => (file.path === activePath ? { ...file, title: matter.title } : file)),
    );
  }, [activePath, matter.title]);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 860px)");
    const onChange = () => {
      if (mq.matches) setSidebarOpen(false);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    void api
      .me()
      .then(setUser)
      .catch(() => setUser(null));
  }, []);

  useEffect(() => {
    const sync = () => {
      const next = routeFromHash();
      const leavingSettings = isSettingsRoute(routeRef.current) && !isSettingsRoute(next);
      if (leavingSettings && settingsDirtyRef.current) {
        pendingRouteRef.current = next;
        window.location.hash = hashFor(routeRef.current);
        setSettingsLeaveOpen(true);
        return;
      }
      setRoute(next);
    };
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  const go = (next: AppRoute) => {
    if (isSettingsRoute(routeRef.current) && !isSettingsRoute(next) && settingsDirtyRef.current) {
      pendingRouteRef.current = next;
      setSettingsLeaveOpen(true);
      return;
    }
    window.location.hash = hashFor(next);
    setRoute(next);
  };

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  useEffect(() => {
    if (!toast || toast.kind === "error") return;
    const timer = window.setTimeout(() => setToast(null), 6000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const persistCurrent = useCallback(
    async (nextMatter = matter, nextBody = body, path = activePath) => {
      if (!path || fileKind(path) === "image") return;
      const serialized = serializeFrontMatter(nextMatter, nextBody);
      if (path === activePath) setSource(serialized);
      await enqueueWrite(() => writeFile(path, serialized));
    },
    [activePath, body, enqueueWrite, matter],
  );

  const openDoc = useCallback(
    async (path: string) => {
      if (activePath && activePath !== path) {
        await persistCurrent();
      }
      await openPath(path);
    },
    [activePath, openPath, persistCurrent],
  );

  const onBodyChange = (markdown: string) => {
    setBody(markdown);
    void persistCurrent(matter, markdown);
  };

  const onMatterChange = (next: FrontMatter) => {
    setMatter(next);
    void persistCurrent(next, body);
  };

  const onSourceChange = (value: string) => {
    setSource(value);
    const parsed = parseFrontMatter(value);
    setMatter(parsed.matter);
    setBody(parsed.body);
    if (activePath) void enqueueWrite(() => writeFile(activePath, value));
  };

  const createDoc = async (kind: DocKind, title: string) => {
    const slug = slugify(title);
    const requested =
      kind === "post"
        ? `source/_posts/${slug}.md`
        : kind === "draft"
          ? `source/_drafts/${slug}.md`
          : `source/${slug}/index.md`;
    const { path, renamed } = await uniqueUserPath(requested);
    const content = serializeFrontMatter(
      { ...defaultFrontMatter(title), layout: kind === "page" ? "page" : "post" },
      "\n",
    );
    await persistCurrent();
    await writeFile(path, content);
    setNewDocOpen(false);
    await refreshTree();
    await openPath(path);
    if (renamed) {
      setToast({ kind: "info", text: `已存在同名文件，已保存为 ${path.split("/").pop()}` });
    }
  };

  const removeDoc = async (path: string) => {
    await deleteFile(path);
    const list = await refreshTree();
    if (activePath === path) {
      const next = list.find((file) => {
        const kind = fileKind(file.path);
        return kind === "post" || kind === "draft" || kind === "page";
      });
      if (next) await openPath(next.path);
      else {
        setActivePath(null);
        setBody("");
        setSource("");
      }
    }
  };

  const settingsOpen = isSettingsRoute(route);

  const renderSettingsPreview = useCallback(
    async (nextConfig: SiteConfig, draft?: SettingsDraft) => {
      if (!online) {
        setThemePreviewError("预览需要联网，由服务端运行 hexo generate。");
        return;
      }
      setPreviewing(true);
      setThemePreviewError(null);
      try {
        await persistCurrent();
        const filesSnapshot = overlayDraftFiles(await snapshotFiles(), draft);
        const result = await api.preview(siteId(), filesSnapshot, nextConfig);
        setThemePreviewUrl(`${result.url}?t=${Date.now()}`);
      } catch (error) {
        setThemePreviewUrl(null);
        setThemePreviewError(error instanceof Error ? error.message : "预览失败");
      } finally {
        setPreviewing(false);
      }
    },
    [online, persistCurrent],
  );

  useEffect(() => {
    if (!config) return;
    let cancelled = false;
    themeReadyRef.current = false;
    setThemeReady(false);
    void (async () => {
      const path = themeConfigPath(config.theme);
      const existing = await readFile(path);
      const values =
        existing && existing.encoding !== "base64" && existing.content.trim()
          ? parseThemeSettings(config.theme, existing.content)
          : defaultThemeSettings(config.theme);
      if (!existing || existing.encoding === "base64") {
        await enqueueWrite(() => writeFile(path, serializeThemeSettings(config.theme, values)));
      }
      if (cancelled) return;
      setThemeSettings(values);
      themeReadyRef.current = true;
      setThemeReady(true);
      if (isSettingsRoute(routeRef.current)) {
        void renderSettingsPreview(config);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [config?.theme, enqueueWrite, renderSettingsPreview]);

  useEffect(() => {
    if (!settingsOpen || !config || !themeReady) return;
    void renderSettingsPreview(config);
  }, [settingsOpen, themeReady]);

  const loadThemeSettings = async (theme: ThemeId): Promise<ThemeSettings> => {
    const path = themeConfigPath(theme);
    const existing = await readFile(path);
    return existing && existing.encoding !== "base64" && existing.content.trim()
      ? parseThemeSettings(theme, existing.content)
      : defaultThemeSettings(theme);
  };

  const saveSettings = async (draft: SettingsDraft): Promise<SettingsDraft> => {
    const safe = parseSiteConfig(draft.config);
    const yaml = applySiteConfigToYaml(safe, draft.rawYaml);
    const themes = { ...draft.themeDrafts, [safe.theme]: draft.themeSettings };
    setSettingsSaving(true);
    try {
      await saveConfig(safe, github);
      await writeFile("_config.yml", yaml);
      for (const [id, values] of Object.entries(themes)) {
        if (!values || !isThemeId(id)) continue;
        await writeFile(themeConfigPath(id), serializeThemeSettings(id, values));
      }
      setConfig(safe);
      setRawYaml(yaml);
      setThemeSettings(draft.themeSettings);
      const saved = { config: safe, rawYaml: yaml, themeSettings: draft.themeSettings, themeDrafts: themes };
      settingsDraftRef.current = saved;
      settingsDirtyRef.current = false;
      setToast({ kind: "ok", text: "已保存站点信息和主题" });
      void renderSettingsPreview(safe, saved);
      return saved;
    } catch (error) {
      setToast({ kind: "error", text: error instanceof Error ? error.message : "保存失败" });
      throw error;
    } finally {
      setSettingsSaving(false);
    }
  };

  const discardSettingsAndLeave = () => {
    settingsDirtyRef.current = false;
    setSettingsLeaveOpen(false);
    const pending = pendingRouteRef.current ?? "editor";
    pendingRouteRef.current = null;
    window.location.hash = hashFor(pending);
    setRoute(pending);
  };

  const runPreview = async () => {
    if (!config) return;
    if (!online) {
      setToast({ kind: "error", text: "预览需要联网，由服务端运行 hexo generate。" });
      return;
    }
    const tab = window.open("about:blank", "open-pages-preview");
    if (tab) {
      tab.document.title = "Hexo 预览";
      tab.document.body.innerHTML =
        '<p style="font:16px/1.6 system-ui;padding:24px;color:#6f685c">正在用 Hexo 生成站点…</p>';
    }
    setPreviewing(true);
    setToast({ kind: "info", text: "正在用 Hexo 生成，将在新标签打开…" });
    try {
      await persistCurrent();
      const filesSnapshot = await snapshotFiles();
      const result = await api.preview(siteId(), filesSnapshot, config);
      const url = `${result.url}?t=${Date.now()}`;
      if (tab && !tab.closed) {
        tab.location.replace(url);
      } else {
        window.open(url, "open-pages-preview");
      }
      setToast({
        kind: "ok",
        text: `已在新标签打开 Hexo 预览（${result.elapsedMs}ms）`,
        href: url,
      });
    } catch (error) {
      if (tab && !tab.closed) tab.close();
      setToast({ kind: "error", text: error instanceof Error ? error.message : "预览失败" });
    } finally {
      setPreviewing(false);
    }
  };

  const login = () => {
    window.location.href = "/auth/github";
  };

  const logout = async () => {
    await api.logout();
    setUser(await api.me());
  };

  const publish = async (opts: { owner?: string; repo: string; createRepo?: boolean }) => {
    if (!config) return;
    setPublishBusy(true);
    setPublishStatus("同步文件并运行 hexo generate…");
    setPublishUrl(null);
    try {
      await persistCurrent();
      const filesSnapshot = await snapshotFiles();
      const result = await api.publish(siteId(), {
        files: filesSnapshot,
        config,
        ...opts,
      });
      const binding = {
        owner: result.owner,
        repo: result.repo,
        defaultBranch: "main",
        pagesUrl: result.url,
      };
      setGithub(binding);
      await saveConfig(config, binding);
      setPublishStatus("已提交 main + gh-pages，并尝试启用 GitHub Pages。");
      setPublishUrl(result.url);
    } catch (error) {
      setPublishStatus(error instanceof Error ? error.message : "发布失败");
    } finally {
      setPublishBusy(false);
    }
  };

  const editable = useMemo(
    () => Boolean(activePath && fileKind(activePath) !== "image"),
    [activePath],
  );

  if (!config) {
    return (
      <div className="boot" data-testid="boot">
        正在从本地打开站点…
      </div>
    );
  }

  return (
    <div className={sidebarOpen ? "shell" : "shell sidebar-collapsed"} data-testid="app-shell">
      {sidebarOpen && (
        <button
          type="button"
          className="sidebar-backdrop"
          data-testid="sidebar-backdrop"
          aria-label="关闭目录"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      <FileTree
        files={files}
        activePath={activePath}
        open={sidebarOpen}
        siteTitle={config.title}
        onOpen={(path) => {
          void openDoc(path);
          if (window.matchMedia("(max-width: 860px)").matches) setSidebarOpen(false);
        }}
        onCreate={(kind) => {
          setNewDocKind(kind);
          setNewDocOpen(true);
        }}
        onDelete={(path) => setPendingDelete(path)}
        onSettings={() => go("settings")}
        onHide={() => setSidebarOpen(false)}
      />
      <div className="main">
        <TopBar
          mode={mode}
          previewing={previewing}
          online={online}
          user={user}
          sidebarOpen={sidebarOpen}
          onMode={setMode}
          onPreview={() => void runPreview()}
          onToggleSidebar={() => setSidebarOpen(true)}
          onPublish={() => go("publish-github")}
          onLogin={login}
          onLogout={() => void logout()}
        />
        <div className="editor-pane" data-testid="editor-pane">
          {editable && (
            <FrontMatterBar
              matter={matter}
              onChange={onMatterChange}
              onOpenMeta={() => setDocMetaOpen(true)}
            />
          )}
          {mode === "source" ? (
            <SourceEditor value={source} onChange={onSourceChange} />
          ) : (
            editable && activePath && (
              <MarkdownEditor
                key={activePath}
                value={body}
                onChange={onBodyChange}
                onUploadImage={storeLocalImage}
                resolveImageUrl={resolveLocalImageUrl}
              />
            )
          )}
        </div>
      </div>
      <DocMetaPanel
        open={docMetaOpen}
        matter={matter}
        onChange={onMatterChange}
        onClose={() => setDocMetaOpen(false)}
      />
      {settingsOpen && themeReady && (
        <SettingsPage
          tab={settingsTabFromHash()}
          config={config}
          themeSettings={themeSettings}
          rawYaml={rawYaml}
          previewUrl={themePreviewUrl}
          loading={previewing}
          error={themePreviewError}
          saving={settingsSaving}
          onTab={(tab) => go(tab === "site" ? "settings-site" : "settings")}
          onDirtyChange={(dirty) => {
            settingsDirtyRef.current = dirty;
          }}
          onLoadTheme={loadThemeSettings}
          onPreview={(draft) => {
            settingsDraftRef.current = draft;
            void renderSettingsPreview(draft.config, draft);
          }}
          onSave={saveSettings}
          onRetry={() => {
            const draft = settingsDraftRef.current;
            void renderSettingsPreview(draft?.config ?? config, draft ?? undefined);
          }}
          onClose={() => {
            settingsDirtyRef.current = false;
            window.location.hash = hashFor("editor");
            setRoute("editor");
          }}
        />
      )}
      {route === "publish-github" && (
        <PublishPage
          user={user}
          theme={config.theme}
          defaultRepo={github?.repo}
          busy={publishBusy}
          status={publishStatus}
          resultUrl={publishUrl}
          onBack={() => go("editor")}
          onClose={() => go("editor")}
          onLogin={login}
          onPublish={(opts) => void publish(opts)}
        />
      )}
      <NewDocDialog
        open={newDocOpen}
        kind={newDocKind}
        onKind={setNewDocKind}
        onClose={() => setNewDocOpen(false)}
        onCreate={(kind, title) => void createDoc(kind, title)}
      />
      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="删除文件"
        message={pendingDelete ? `删除 ${pendingDelete}？此操作只影响本机草稿。` : ""}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => {
          if (pendingDelete) void removeDoc(pendingDelete);
          setPendingDelete(null);
        }}
      />
      <ConfirmDialog
        open={settingsLeaveOpen}
        title="放弃未保存的改动？"
        message="站点信息和主题都还没保存。离开后这些修改会丢掉。"
        confirmLabel="放弃"
        danger={false}
        onClose={() => {
          setSettingsLeaveOpen(false);
          pendingRouteRef.current = null;
        }}
        onConfirm={discardSettingsAndLeave}
      />
      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </div>
  );
}

type AppRoute = "editor" | "settings" | "settings-site" | "publish-github";

function isSettingsRoute(route: AppRoute) {
  return route === "settings" || route === "settings-site";
}

function settingsTabFromHash(): SettingsTab {
  return window.location.hash === "#/settings/site" ? "site" : "theme";
}

function routeFromHash(): AppRoute {
  const hash = window.location.hash;
  if (hash === "#/publish/github" || hash === "#/publish/theme") {
    return "publish-github";
  }
  if (hash === "#/settings/site") return "settings-site";
  if (hash.startsWith("#/settings")) return "settings";
  return "editor";
}

function hashFor(route: AppRoute): string {
  if (route === "publish-github") return "#/publish/github";
  if (route === "settings-site") return "#/settings/site";
  if (route === "settings") return "#/settings";
  return "";
}

function overlayDraftFiles(files: SiteFile[], draft?: SettingsDraft): SiteFile[] {
  if (!draft) return files;
  const yaml = applySiteConfigToYaml(draft.config, draft.rawYaml);
  const replacements = new Map<string, string>([["_config.yml", yaml]]);
  const themes = { ...draft.themeDrafts, [draft.config.theme]: draft.themeSettings };
  for (const [id, values] of Object.entries(themes)) {
    if (!values || !isThemeId(id)) continue;
    replacements.set(themeConfigPath(id), serializeThemeSettings(id, values));
  }
  const next = files.filter((file) => !replacements.has(file.path));
  for (const [path, content] of replacements) {
    next.push({ path, content, encoding: "utf8" });
  }
  return next;
}


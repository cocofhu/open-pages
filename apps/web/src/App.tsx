import { useCallback, useEffect, useMemo, useState } from "react";
import {
  applySiteConfigToYaml,
  defaultFrontMatter,
  defaultHexoConfigYaml,
  fileKind,
  parseFrontMatter,
  parseSiteConfig,
  serializeFrontMatter,
  slugify,
  type FrontMatter,
  type GithubBinding,
  type SiteConfig,
  type ThemeId,
} from "@open-pages/shared";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { MarkdownEditor, SourceEditor } from "./components/Editor";
import { FileTree } from "./components/FileTree";
import { FrontMatterBar } from "./components/FrontMatterBar";
import { NewDocDialog, type DocKind } from "./components/NewDocDialog";
import { PublishPage } from "./components/PublishPage";
import { SettingsPanel } from "./components/SettingsPanel";
import { ThemeStudio } from "./components/ThemeStudio";
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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(
    () => !window.matchMedia("(max-width: 860px)").matches,
  );
  const [online, setOnline] = useState(navigator.onLine);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [route, setRoute] = useState<AppRoute>(routeFromHash);
  const [themePreviewUrl, setThemePreviewUrl] = useState<string | null>(null);
  const [themePreviewError, setThemePreviewError] = useState<string | null>(null);
  const [publishBusy, setPublishBusy] = useState(false);
  const [publishStatus, setPublishStatus] = useState("");
  const [publishUrl, setPublishUrl] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [newDocOpen, setNewDocOpen] = useState(false);
  const [newDocKind, setNewDocKind] = useState<DocKind>("post");
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

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
    const sync = () => setRoute(routeFromHash());
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  const go = (next: AppRoute) => {
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
      await writeFile(path, serialized);
    },
    [activePath, body, matter],
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
    if (activePath) void writeFile(activePath, value);
  };

  const onConfigChange = (next: SiteConfig) => {
    const safe = parseSiteConfig(next);
    const yaml = applySiteConfigToYaml(safe, rawYaml);
    setConfig(safe);
    setRawYaml(yaml);
    void saveConfig(safe, github);
    void writeFile("_config.yml", yaml);
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

  const renderThemePreview = useCallback(
    async (nextConfig: SiteConfig) => {
      if (!online) {
        setThemePreviewError("预览需要联网，由服务端运行 hexo generate。");
        return;
      }
      setPreviewing(true);
      setThemePreviewError(null);
      try {
        await persistCurrent();
        const filesSnapshot = await snapshotFiles();
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
    if (route !== "publish-theme" || !config) return;
    void renderThemePreview(config);
  }, [route, config?.theme]);

  const pickTheme = (theme: ThemeId) => {
    if (!config) return;
    onConfigChange({ ...config, theme });
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
        onSettings={() => setSettingsOpen(true)}
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
          onPublish={() => go("publish-theme")}
          onLogin={login}
          onLogout={() => void logout()}
        />
        <div className="editor-pane" data-testid="editor-pane">
          {editable && <FrontMatterBar matter={matter} onChange={onMatterChange} />}
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
      <SettingsPanel
        open={settingsOpen}
        config={config}
        onChange={onConfigChange}
        rawYaml={rawYaml}
        onRawYaml={(value) => {
          setRawYaml(value);
          void writeFile("_config.yml", value);
        }}
        onClose={() => setSettingsOpen(false)}
      />
      {route === "publish-theme" && (
        <ThemeStudio
          theme={config.theme}
          previewUrl={themePreviewUrl}
          loading={previewing}
          error={themePreviewError}
          onTheme={pickTheme}
          onBack={() => go("editor")}
          onNext={() => go("publish-github")}
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
          onBack={() => go("publish-theme")}
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
      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </div>
  );
}

type AppRoute = "editor" | "publish-theme" | "publish-github";

function routeFromHash(): AppRoute {
  if (window.location.hash === "#/publish/theme") return "publish-theme";
  if (window.location.hash === "#/publish/github") return "publish-github";
  return "editor";
}

function hashFor(route: AppRoute): string {
  if (route === "publish-theme") return "#/publish/theme";
  if (route === "publish-github") return "#/publish/github";
  return "";
}


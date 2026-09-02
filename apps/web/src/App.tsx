import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  applySiteConfigToYaml,
  BUILTIN_ADDONS,
  defaultFrontMatter,
  defaultHexoConfigYaml,
  defaultSettingsForFields,
  fileKind,
  isThemeId,
  parseFrontMatter,
  parseSiteConfig,
  parseThemeSettings,
  pagesRoot,
  pagesUrl,
  pluginConfigPath,
  serializeFrontMatter,
  serializeThemeSettings,
  slugify,
  themeConfigPath,
  themeSettingFields,
  type FrontMatter,
  type AddonManifest,
  type GithubBinding,
  type SiteConfig,
  type SiteFile,
  type ThemeId,
  type ThemeSettings,
} from "@open-pages/shared";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { errorMessage } from "./lib/errors";
import type { SettingsDraft } from "./components/SettingsPage";
import { DocMetaPanel } from "./components/DocMetaPanel";
import { MarkdownEditor, SourceEditor, type SourceEditorHandle } from "./components/Editor";
import { FilesPage, type FileEntry } from "./components/FilesPage";
import { Outline } from "./components/Outline";
import { FrontMatterBar } from "./components/FrontMatterBar";
import { NewDocDialog, type DocKind } from "./components/NewDocDialog";
import { PublishPage } from "./components/PublishPage";
import { SettingsPage, type SettingsTab } from "./components/SettingsPage";
import { Toast, type ToastState } from "./components/Toast";
import { TopBar, type EditorMode } from "./components/TopBar";
import type { AuthUser } from "./lib/api";
import { isTauri, platform } from "./lib/platform";
import { type OutlineHeading } from "./lib/outline";
import {
  deleteFile,
  listFiles,
  loadConfig,
  readFile,
  saveConfig,
  siteId,
  snapshotFiles,
  storeLocalImage,
  storeSiteAvatar,
  resolveLocalImageUrl,
  uniqueUserPath,
  writeFile,
} from "./lib/vfs";

export function App() {
  const [files, setFiles] = useState<FileEntry[]>([]);
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
  const [themeYaml, setThemeYaml] = useState("");
  const [addons, setAddons] = useState<AddonManifest[]>(BUILTIN_ADDONS);
  const [themeReady, setThemeReady] = useState(false);
  const [themePreviewUrl, setThemePreviewUrl] = useState<string | null>(null);
  const [themePreviewError, setThemePreviewError] = useState<string | null>(null);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsLeaveOpen, setSettingsLeaveOpen] = useState(false);
  const settingsDraftRef = useRef<SettingsDraft | null>(null);
  const settingsDirtyRef = useRef(false);
  const themePreviewRequestRef = useRef(0);
  const pendingRouteRef = useRef<AppRoute | null>(null);
  const themeReadyRef = useRef(false);
  const routeRef = useRef(route);
  const writeChainRef = useRef(Promise.resolve());
  const editingPathRef = useRef<string | null>(null);
  const sourceEditorRef = useRef<SourceEditorHandle>(null);
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
        .map((file) => {
          const parsed =
            file.encoding !== "base64" && file.path.endsWith(".md") ? parseFrontMatter(file.content) : null;
          return {
            path: file.path,
            title: parsed ? parsed.matter.title : file.path.split("/").pop() ?? file.path,
            updatedAt: file.updatedAt,
            words: parsed ? countWords(parsed.body) : 0,
          };
        }),
    );
    return list;
  }, []);

  const openPath = useCallback(async (path: string) => {
    const file = await readFile(path);
    editingPathRef.current = path;
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
    if (route === "files") void refreshTree();
  }, [route, refreshTree]);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 860px)");
    const onChange = () => {
      if (mq.matches) setSidebarOpen(false);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    void platform.me().then(setUser);
    void platform
      .addons()
      .then(({ addons }) => {
        if (Array.isArray(addons)) setAddons(addons);
      })
      .catch(() => undefined);
  }, []);

  const fieldsForTheme = useCallback(
    (theme: ThemeId) =>
      addons.find((addon) => addon.kind === "theme" && addon.id === theme)?.settings ??
      themeSettingFields(theme),
    [addons],
  );

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

  useEffect(() => {
    if (route === "publish-github") {
      setPublishStatus("");
      setPublishUrl(null);
    }
  }, [route]);

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
    if (!toast || toast.kind === "error" || toast.sticky) return;
    const timer = window.setTimeout(() => setToast(null), 6000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  // The desktop client signs in through GitHub's device flow, so the verification
  // code has to reach the user even if the helper browser tab never opens.
  useEffect(() => {
    if (!isTauri()) return;
    let dispose: (() => void) | undefined;
    let cancelled = false;
    void (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      const unlisten = await listen<{ userCode: string; verificationUri: string }>(
        "github-device-code",
        (event) => {
          setToast({
            kind: "info",
            text: `在 GitHub 输入验证码 ${event.payload.userCode} 完成登录`,
            href: event.payload.verificationUri,
            linkText: "打开 GitHub",
            sticky: true,
          });
        },
      );
      if (cancelled) unlisten();
      else dispose = unlisten;
    })();
    return () => {
      cancelled = true;
      dispose?.();
    };
  }, []);

  const persistCurrent = useCallback(
    async (nextMatter = matter, nextBody = body, path = editingPathRef.current) => {
      if (!path || fileKind(path) === "image") return;
      const serialized = serializeFrontMatter(nextMatter, nextBody);
      if (path === editingPathRef.current) setSource(serialized);
      await enqueueWrite(() => writeFile(path, serialized));
    },
    [body, enqueueWrite, matter],
  );

  const openDoc = useCallback(
    async (path: string) => {
      if (editingPathRef.current && editingPathRef.current !== path) {
        await persistCurrent();
      }
      await openPath(path);
    },
    [openPath, persistCurrent],
  );

  const onBodyChange = (markdown: string) => {
    setBody(markdown);
    void persistCurrent(matter, markdown, editingPathRef.current);
  };

  const onMatterChange = (next: FrontMatter) => {
    setMatter(next);
    void persistCurrent(next, body, editingPathRef.current);
  };

  const onSourceChange = (value: string) => {
    setSource(value);
    const parsed = parseFrontMatter(value);
    setMatter(parsed.matter);
    setBody(parsed.body);
    const path = editingPathRef.current;
    if (path) void enqueueWrite(() => writeFile(path, value));
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
    go("editor");
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
      const request = ++themePreviewRequestRef.current;
      if (!online && !isTauri()) {
        if (request === themePreviewRequestRef.current) {
          setThemePreviewError("预览需要联网，由服务端运行 hexo generate。");
        }
        return;
      }
      setPreviewing(true);
      setThemePreviewError(null);
      try {
        await persistCurrent();
        const filesSnapshot = overlayDraftFiles(await snapshotFiles(), draft, fieldsForTheme);
        const result = await platform.preview(siteId(), filesSnapshot, nextConfig);
        if (request === themePreviewRequestRef.current) {
          setThemePreviewUrl(`${result.url}?t=${Date.now()}`);
        }
      } catch (error) {
        if (request === themePreviewRequestRef.current) {
          setThemePreviewUrl(null);
          setThemePreviewError(errorMessage(error, "预览失败"));
        }
      } finally {
        if (request === themePreviewRequestRef.current) setPreviewing(false);
      }
    },
    [fieldsForTheme, online, persistCurrent],
  );

  useEffect(() => {
    if (!config) return;
    let cancelled = false;
    themeReadyRef.current = false;
    setThemeReady(false);
    void (async () => {
      const path = themeConfigPath(config.theme);
      const existing = await readFile(path);
      const fields = fieldsForTheme(config.theme);
      const values =
        existing && existing.encoding !== "base64" && existing.content.trim()
          ? parseThemeSettings(config.theme, existing.content, fields)
          : defaultSettingsForFields(fields);
      if (!existing || existing.encoding === "base64") {
        await enqueueWrite(() =>
          writeFile(path, serializeThemeSettings(config.theme, values, fields)),
        );
      }
      if (cancelled) return;
      setThemeSettings(values);
      setThemeYaml(
        existing && existing.encoding !== "base64"
          ? existing.content
          : serializeThemeSettings(config.theme, values, fields),
      );
      themeReadyRef.current = true;
      setThemeReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [config?.theme, enqueueWrite, fieldsForTheme, renderSettingsPreview]);

  useEffect(() => {
    if (!settingsOpen || !config || !themeReady) return;
    void renderSettingsPreview(config);
  }, [settingsOpen, themeReady]);

  const loadThemeSettings = async (
    theme: ThemeId,
  ): Promise<{ values: ThemeSettings; yaml: string }> => {
    const path = themeConfigPath(theme);
    const existing = await readFile(path);
    const fields = fieldsForTheme(theme);
    const yaml = existing && existing.encoding !== "base64" ? existing.content : "";
    const values = yaml.trim()
      ? parseThemeSettings(theme, yaml, fields)
      : defaultSettingsForFields(fields);
    return { values, yaml: yaml || serializeThemeSettings(theme, values, fields) };
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
        const fields = fieldsForTheme(id);
        const rawThemeYaml = draft.themeYamlDrafts[id];
        await writeFile(
          themeConfigPath(id),
          fields.length
            ? serializeThemeSettings(id, values, fields)
            : rawThemeYaml ?? serializeThemeSettings(id, values, fields),
        );
      }
      setConfig(safe);
      setRawYaml(yaml);
      setThemeSettings(draft.themeSettings);
      setThemeYaml(draft.themeYaml);
      const saved: SettingsDraft = {
        config: safe,
        rawYaml: yaml,
        themeSettings: draft.themeSettings,
        themeYaml: draft.themeYaml,
        themeDrafts: themes,
        themeYamlDrafts: draft.themeYamlDrafts,
      };
      settingsDraftRef.current = saved;
      settingsDirtyRef.current = false;
      setToast({ kind: "ok", text: "已保存站点信息和主题" });
      void renderSettingsPreview(safe, saved);
      return saved;
    } catch (error) {
      setToast({ kind: "error", text: errorMessage(error, "保存失败") });
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
    if (!online && !isTauri()) {
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
      const result = await platform.preview(siteId(), filesSnapshot, config);
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
      setToast({ kind: "error", text: errorMessage(error, "预览失败") });
    } finally {
      setPreviewing(false);
    }
  };

  const runPublishPreview = async (opts: { repo: string; owner?: string }) => {
    if (!config || !user?.login || !opts.repo) return;
    if (!online && !isTauri()) {
      setToast({ kind: "error", text: "预览需要联网，由服务端运行 hexo generate。" });
      return;
    }
    const owner = opts.owner ?? user.login;
    const publishConfig = parseSiteConfig({
      ...config,
      url: pagesUrl(owner, opts.repo).replace(/\/$/, ""),
      root: pagesRoot(owner, opts.repo),
    });
    const tab = window.open("about:blank", "open-pages-publish-preview");
    if (tab) {
      tab.document.title = "发布预览";
      tab.document.body.innerHTML =
        '<p style="font:16px/1.6 system-ui;padding:24px;color:#6f685c">正在按 GitHub Pages 路径生成预览…</p>';
    }
    setPreviewing(true);
    setToast({ kind: "info", text: "正在生成发布预览，将在新标签打开…" });
    try {
      await persistCurrent();
      const filesSnapshot = await snapshotFiles();
      const result = await platform.preview(siteId(), filesSnapshot, publishConfig);
      const url = `${result.url}?t=${Date.now()}`;
      if (tab && !tab.closed) {
        tab.location.replace(url);
      } else {
        window.open(url, "open-pages-publish-preview");
      }
      setToast({
        kind: "ok",
        text: `已打开发布预览（${result.elapsedMs}ms），路径与 GitHub Pages 一致`,
        href: url,
      });
    } catch (error) {
      if (tab && !tab.closed) tab.close();
      setToast({ kind: "error", text: errorMessage(error, "预览失败") });
    } finally {
      setPreviewing(false);
    }
  };

  const login = () => {
    void platform
      .login()
      .then((next) => {
        if (!next) return;
        setUser(next);
        setToast(next.login ? { kind: "ok", text: `已登录 GitHub：${next.login}` } : null);
      })
      .catch((error: unknown) => {
        setToast({ kind: "error", text: errorMessage(error, "登录失败") });
      });
  };

  const logout = async () => {
    setUser(await platform.logout());
  };

  const publish = async (opts: { owner?: string; repo: string; createRepo?: boolean }) => {
    if (!config) return;
    setPublishBusy(true);
    setPublishStatus("正在发布中…");
    setPublishUrl(null);
    try {
      await persistCurrent();
      const filesSnapshot = await snapshotFiles();
      const result = await platform.publish(siteId(), {
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
      setPublishStatus("");
      setPublishUrl(result.url);
    } catch (error) {
      setPublishStatus(errorMessage(error, "发布失败"));
    } finally {
      setPublishBusy(false);
    }
  };

  const editable = useMemo(
    () => Boolean(activePath && fileKind(activePath) !== "image"),
    [activePath],
  );

  const jumpToHeading = (heading: OutlineHeading) => {
    if (mode === "source") {
      sourceEditorRef.current?.jumpToHeading(heading);
      return;
    }
    const pane = document.querySelector<HTMLElement>('[data-testid="editor-pane"]');
    if (!pane) return;
    const nodes = pane.querySelectorAll<HTMLElement>(
      ".crepe-host h1, .crepe-host h2, .crepe-host h3, .crepe-host h4, .crepe-host h5, .crepe-host h6",
    );
    nodes[heading.index]?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

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
      <Outline
        open={sidebarOpen}
        siteTitle={config.title}
        markdown={editable ? body : ""}
        onJump={(heading) => {
          jumpToHeading(heading);
          if (window.matchMedia("(max-width: 860px)").matches) setSidebarOpen(false);
        }}
        onFiles={() => go("files")}
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
          onFiles={() => go("files")}
          onPublish={() => go("publish-github")}
          onLogin={login}
          onLogout={() => void logout()}
        />
        <div className="editor-pane" data-testid="editor-pane">
          {editable && mode !== "source" && (
            <FrontMatterBar
              matter={matter}
              onChange={onMatterChange}
              onOpenMeta={() => setDocMetaOpen(true)}
            />
          )}
          {mode === "source" ? (
            <SourceEditor ref={sourceEditorRef} value={source} onChange={onSourceChange} />
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
          themeYaml={themeYaml}
          rawYaml={rawYaml}
          previewUrl={themePreviewUrl}
          loading={previewing}
          error={themePreviewError}
          saving={settingsSaving}
          addons={addons}
          onTab={(tab) =>
            go(tab === "site" ? "settings-site" : tab === "plugin" ? "settings-plugin" : "settings")
          }
          onDirtyChange={(dirty) => {
            settingsDirtyRef.current = dirty;
          }}
          onLoadTheme={loadThemeSettings}
          onPreview={(draft) => {
            settingsDraftRef.current = draft;
            void renderSettingsPreview(draft.config, draft);
          }}
          onSave={saveSettings}
          onInstallAddon={async (source, kind, onProgress) => {
            const { addon } = await platform.installAddon(source, kind, onProgress);
            const refreshed = await platform.addons();
            setAddons(refreshed.addons);
            setToast({ kind: "ok", text: `已安装 ${addon.label}` });
            if (kind === "plugin") void renderSettingsPreview(config);
          }}
          onToggleAddon={async (id, enabled) => {
            await platform.setAddonEnabled(id, enabled);
            setAddons((current) =>
              current.map((addon) => (addon.id === id ? { ...addon, enabled } : addon)),
            );
            void renderSettingsPreview(config);
          }}
          onRemoveAddon={async (id) => {
            const removed = addons.find((addon) => addon.id === id);
            await platform.removeAddon(id);
            setAddons((current) => current.filter((addon) => addon.id !== id));
            if (removed?.kind === "plugin") void renderSettingsPreview(config);
          }}
          onLoadPluginConfig={async (addon) => {
            const existing = await readFile(pluginConfigPath(addon.id));
            const yaml =
              existing && existing.encoding !== "base64" ? existing.content : "";
            return {
              values: yaml
                ? parseThemeSettings(addon.id, yaml, addon.settings)
                : defaultSettingsForFields(addon.settings),
              yaml,
            };
          }}
          onSavePluginConfig={async (addon, values, yaml) => {
            const content = addon.settings.length
              ? serializeThemeSettings(addon.id, values, addon.settings)
              : yaml;
            await enqueueWrite(() => writeFile(pluginConfigPath(addon.id), content));
            setToast({ kind: "ok", text: `已保存 ${addon.label} 配置` });
            void renderSettingsPreview(config);
          }}
          onUploadAvatar={storeSiteAvatar}
          resolveAvatarUrl={resolveLocalImageUrl}
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
      {route === "files" && (
        <FilesPage
          files={files}
          activePath={activePath}
          onOpen={(path) => {
            void openDoc(path).then(() => go("editor"));
          }}
          onCreate={(kind) => {
            setNewDocKind(kind);
            setNewDocOpen(true);
          }}
          onDelete={(path) => setPendingDelete(path)}
          onBack={() => go("editor")}
        />
      )}
      {route === "publish-github" && (
        <PublishPage
          user={user}
          siteId={siteId()}
          theme={config.theme}
          defaultRepo={github?.repo}
          busy={publishBusy}
          previewing={previewing}
          online={online}
          status={publishStatus}
          resultUrl={publishUrl}
          onBack={() => go("editor")}
          onClose={() => go("editor")}
          onLogin={login}
          onPreview={(opts) => void runPublishPreview(opts)}
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

type AppRoute =
  | "editor"
  | "files"
  | "settings"
  | "settings-site"
  | "settings-plugin"
  | "publish-github";

function isSettingsRoute(route: AppRoute) {
  return route === "settings" || route === "settings-site" || route === "settings-plugin";
}

function settingsTabFromHash(): SettingsTab {
  if (window.location.hash === "#/settings/site") return "site";
  if (window.location.hash === "#/settings/plugins") return "plugin";
  return "theme";
}

function routeFromHash(): AppRoute {
  const hash = window.location.hash;
  if (hash === "#/publish/github" || hash === "#/publish/theme") {
    return "publish-github";
  }
  if (hash === "#/settings/site") return "settings-site";
  if (hash === "#/settings/plugins") return "settings-plugin";
  if (hash.startsWith("#/settings")) return "settings";
  if (hash.startsWith("#/files")) return "files";
  return "editor";
}

function hashFor(route: AppRoute): string {
  if (route === "publish-github") return "#/publish/github";
  if (route === "files") return "#/files";
  if (route === "settings-site") return "#/settings/site";
  if (route === "settings-plugin") return "#/settings/plugins";
  if (route === "settings") return "#/settings";
  return "";
}

function countWords(body: string): number {
  const text = body.replace(/```[\s\S]*?```/g, " ").replace(/[#>*_`~\-[\]()!]/g, " ");
  const cjk = text.match(/[\u3400-\u9fff\u3040-\u30ff]/g)?.length ?? 0;
  const latin = text.match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g)?.length ?? 0;
  return cjk + latin;
}

function overlayDraftFiles(
  files: SiteFile[],
  draft: SettingsDraft | undefined,
  fieldsForTheme: (theme: ThemeId) => ReturnType<typeof themeSettingFields>,
): SiteFile[] {
  if (!draft) return files;
  const yaml = applySiteConfigToYaml(draft.config, draft.rawYaml);
  const replacements = new Map<string, string>([["_config.yml", yaml]]);
  const themes = { ...draft.themeDrafts, [draft.config.theme]: draft.themeSettings };
  for (const [id, values] of Object.entries(themes)) {
    if (!values || !isThemeId(id)) continue;
    const fields = fieldsForTheme(id);
    replacements.set(
      themeConfigPath(id),
      fields.length
        ? serializeThemeSettings(id, values, fields)
        : draft.themeYamlDrafts[id] ?? serializeThemeSettings(id, values, fields),
    );
  }
  const next = files.filter((file) => !replacements.has(file.path));
  for (const [path, content] of replacements) {
    next.push({ path, content, encoding: "utf8" });
  }
  return next;
}


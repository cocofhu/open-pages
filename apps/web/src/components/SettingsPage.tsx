import {
  ArrowLeftIcon,
  ArrowPathIcon,
  CheckIcon,
  GlobeAltIcon,
  PlusIcon,
  PuzzlePieceIcon,
  SwatchIcon,
  TrashIcon,
} from "@heroicons/react/24/outline";
import {
  applySiteConfigToYaml,
  isThemeId,
  resolvedColorScheme,
  type AddonKind,
  type AddonManifest,
  type SiteConfig,
  type ThemeId,
  type ThemeSettings,
} from "@open-pages/shared";
import { useEffect, useMemo, useRef, useState } from "react";
import type { InstallStep } from "../lib/api";
import { LANGUAGE_OPTIONS, PERMALINK_PRESETS, timezoneOptions } from "../lib/site-options";
import { ComboSelect } from "./ComboSelect";
import { ConfirmDialog } from "./ConfirmDialog";
import { ThemeSettingsForm } from "./ThemeFields";
import { StudioBar } from "./StudioBar";

const THEME_TINT: Record<ThemeId, { ink: string; paper: string }> = {
  landscape: { ink: "#c45c26", paper: "#f4e6d4" },
  cactus: { ink: "#1d1f21", paper: "#d8ece8" },
  next: { ink: "#222222", paper: "#ececec" },
  kaze: { ink: "#3273dc", paper: "#e4edfb" },
  stellar: { ink: "#1bcdfc", paper: "#e4f6fb" },
  reimu: { ink: "#ff7575", paper: "#ffe8e8" },
  particlex: { ink: "#00bcd4", paper: "#e2f6f8" },
  stun: { ink: "#49b1f5", paper: "#e3f3fc" },
  white: { ink: "#2f2f2f", paper: "#f3f3f3" },
  tranquility: { ink: "#6b7c6a", paper: "#e8eee6" },
  async: { ink: "#02162b", paper: "#e6eef6" },
  apollo: { ink: "#42b883", paper: "#e3f6ec" },
  inside: { ink: "#2a2b33", paper: "#ececee" },
};

export type SettingsDraft = {
  config: SiteConfig;
  themeSettings: ThemeSettings;
  themeYaml: string;
  rawYaml: string;
  themeDrafts: Partial<Record<ThemeId, ThemeSettings>>;
  themeYamlDrafts: Partial<Record<ThemeId, string>>;
};

interface SettingsPageProps {
  tab: SettingsTab;
  config: SiteConfig;
  themeSettings: ThemeSettings;
  themeYaml: string;
  rawYaml: string;
  previewUrl: string | null;
  loading: boolean;
  error: string | null;
  saving: boolean;
  addons: AddonManifest[];
  onTab: (tab: SettingsTab) => void;
  onDirtyChange?: (dirty: boolean) => void;
  onLoadTheme: (theme: ThemeId) => Promise<{ values: ThemeSettings; yaml: string }>;
  onPreview: (draft: SettingsDraft) => void;
  onSave: (draft: SettingsDraft) => Promise<SettingsDraft>;
  onInstallAddon: (
    source: string,
    kind: AddonKind,
    onProgress: (step: InstallStep) => void,
  ) => Promise<void>;
  onToggleAddon: (id: string, enabled: boolean) => Promise<void>;
  onRemoveAddon: (id: string) => Promise<void>;
  onLoadPluginConfig: (
    addon: AddonManifest,
  ) => Promise<{ values: ThemeSettings; yaml: string }>;
  onSavePluginConfig: (
    addon: AddonManifest,
    values: ThemeSettings,
    yaml: string,
  ) => Promise<void>;
  onRetry: () => void;
  onClose: () => void;
}

export type SettingsTab = "site" | "theme" | "plugin";

export function SettingsPage({
  tab,
  config,
  themeSettings,
  themeYaml,
  rawYaml,
  previewUrl,
  loading,
  error,
  saving,
  addons,
  onTab,
  onDirtyChange,
  onLoadTheme,
  onPreview,
  onSave,
  onInstallAddon,
  onToggleAddon,
  onRemoveAddon,
  onLoadPluginConfig,
  onSavePluginConfig,
  onRetry,
  onClose,
}: SettingsPageProps) {
  const [draftConfig, setDraftConfig] = useState(config);
  const [draftTheme, setDraftTheme] = useState(themeSettings);
  const [draftThemeYaml, setDraftThemeYaml] = useState(themeYaml);
  const [draftYaml, setDraftYaml] = useState(rawYaml);
  const [themeDrafts, setThemeDrafts] = useState<Partial<Record<ThemeId, ThemeSettings>>>(() => ({
    [config.theme]: themeSettings,
  }));
  const [themeYamlDrafts, setThemeYamlDrafts] = useState<Partial<Record<ThemeId, string>>>(() => ({
    [config.theme]: themeYaml,
  }));
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [addonSource, setAddonSource] = useState("");
  const [addonBusy, setAddonBusy] = useState(false);
  const [addonError, setAddonError] = useState("");
  const [addonStep, setAddonStep] = useState<InstallStep | null>(null);
  const [selectedPlugin, setSelectedPlugin] = useState<AddonManifest | null>(null);
  const [pluginValues, setPluginValues] = useState<ThemeSettings>({});
  const [pluginYaml, setPluginYaml] = useState("");
  const [pluginConfigBusy, setPluginConfigBusy] = useState(false);
  const previewTimer = useRef<number | undefined>(undefined);
  const themeDraftsRef = useRef(themeDrafts);
  themeDraftsRef.current = themeDrafts;

  const draft: SettingsDraft = useMemo(
    () => ({
      config: draftConfig,
      themeSettings: draftTheme,
      themeYaml: draftThemeYaml,
      rawYaml: draftYaml,
      themeDrafts: { ...themeDrafts, [draftConfig.theme]: draftTheme },
      themeYamlDrafts: { ...themeYamlDrafts, [draftConfig.theme]: draftThemeYaml },
    }),
    [draftConfig, draftTheme, draftThemeYaml, draftYaml, themeDrafts, themeYamlDrafts],
  );

  const dirty =
    JSON.stringify(draftConfig) !== JSON.stringify(config) ||
    JSON.stringify(draftTheme) !== JSON.stringify(themeSettings) ||
    draftThemeYaml !== themeYaml ||
    draftYaml !== rawYaml;

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  const schedulePreview = (next: SettingsDraft) => {
    if (previewTimer.current) window.clearTimeout(previewTimer.current);
    previewTimer.current = window.setTimeout(() => onPreview(next), 650);
  };

  const setSite = <K extends keyof SiteConfig>(key: K, value: SiteConfig[K]) => {
    const nextConfig = { ...draftConfig, [key]: value };
    const nextYaml = applySiteConfigToYaml(nextConfig, draftYaml);
    setDraftConfig(nextConfig);
    setDraftYaml(nextYaml);
    schedulePreview({ ...draft, config: nextConfig, rawYaml: nextYaml });
  };

  const setThemeValues = (next: ThemeSettings) => {
    setDraftTheme(next);
    setThemeDrafts((current) => ({ ...current, [draftConfig.theme]: next }));
    schedulePreview({
      ...draft,
      themeSettings: next,
      themeDrafts: { ...themeDraftsRef.current, [draftConfig.theme]: next },
    });
  };

  const pickTheme = (theme: ThemeId) => {
    if (theme === draftConfig.theme) return;
    const previous = draftConfig.theme;
    const nextConfig = { ...draftConfig, theme };
    const nextYaml = applySiteConfigToYaml(nextConfig, draftYaml);
    setThemeDrafts((current) => ({ ...current, [previous]: draftTheme }));
    setDraftConfig(nextConfig);
    setDraftYaml(nextYaml);
    void (async () => {
      const cached = themeDraftsRef.current[theme];
      const loaded = cached
        ? { values: cached, yaml: themeYamlDrafts[theme] ?? "" }
        : await onLoadTheme(theme);
      const values = loaded.values;
      setDraftTheme(values);
      setDraftThemeYaml(loaded.yaml);
      setThemeDrafts((current) => ({ ...current, [previous]: draftTheme, [theme]: values }));
      setThemeYamlDrafts((current) => ({
        ...current,
        [previous]: draftThemeYaml,
        [theme]: loaded.yaml,
      }));
      schedulePreview({
        config: nextConfig,
        rawYaml: nextYaml,
        themeSettings: values,
        themeYaml: loaded.yaml,
        themeDrafts: { ...themeDraftsRef.current, [previous]: draftTheme, [theme]: values },
        themeYamlDrafts: {
          ...themeYamlDrafts,
          [previous]: draftThemeYaml,
          [theme]: loaded.yaml,
        },
      });
    })();
  };

  const setYaml = (value: string) => {
    setDraftYaml(value);
    const merged = mergeYamlIntoConfig(draftConfig, value);
    setDraftConfig(merged);
    schedulePreview({ ...draft, config: merged, rawYaml: value });
  };

  const save = async () => {
    try {
      const saved = await onSave(draft);
      setDraftConfig(saved.config);
      setDraftTheme(saved.themeSettings);
      setDraftThemeYaml(saved.themeYaml);
      setDraftYaml(saved.rawYaml);
      setThemeDrafts(saved.themeDrafts);
      setThemeYamlDrafts(saved.themeYamlDrafts);
    } catch {
      // parent shows toast
    }
  };

  const requestClose = () => {
    if (dirty) setLeaveOpen(true);
    else onClose();
  };

  useEffect(() => {
    return () => {
      if (previewTimer.current) window.clearTimeout(previewTimer.current);
      onDirtyChange?.(false);
    };
  }, [onDirtyChange]);

  const themes = addons.filter((addon) => addon.kind === "theme");
  const plugins = addons.filter((addon) => addon.kind === "plugin");
  const meta =
    themes.find((addon) => addon.id === draftConfig.theme) ??
    {
      id: draftConfig.theme,
      label: draftConfig.theme,
      description: "用户安装的主题",
      settings: [],
      tint: undefined,
    };
  const tint = meta.tint ?? THEME_TINT[draftConfig.theme] ?? tintFromId(draftConfig.theme);
  const zones = useMemo(() => timezoneOptions(), []);

  const submitAddon = async (kind: AddonKind) => {
    if (!addonSource.trim()) return;
    setAddonBusy(true);
    setAddonError("");
    setAddonStep({ label: "正在准备", percent: 0 });
    try {
      await onInstallAddon(addonSource.trim(), kind, setAddonStep);
      setAddonSource("");
    } catch (error) {
      setAddonError(error instanceof Error ? error.message : "安装失败");
    } finally {
      setAddonBusy(false);
      // Keep a finished bar on screen briefly so the jump to 100% is visible.
      window.setTimeout(() => setAddonStep(null), 1_200);
    }
  };

  const selectPlugin = async (plugin: AddonManifest) => {
    setSelectedPlugin(plugin);
    setPluginConfigBusy(true);
    setAddonError("");
    try {
      const loaded = await onLoadPluginConfig(plugin);
      setPluginValues(loaded.values);
      setPluginYaml(loaded.yaml);
    } catch (error) {
      setAddonError(error instanceof Error ? error.message : "读取插件配置失败");
    } finally {
      setPluginConfigBusy(false);
    }
  };

  const mutateAddon = async (task: () => Promise<void>) => {
    setAddonError("");
    try {
      await task();
    } catch (error) {
      setAddonError(error instanceof Error ? error.message : "扩展操作失败");
    }
  };

  return (
    <div className="studio settings-page" data-testid="settings-page">
      <StudioBar
        title="站点设置"
        actions={
          <>
            <button
              type="button"
              className="primary icon-label"
              data-testid="settings-save"
              disabled={!dirty || saving}
              onClick={() => void save()}
            >
              <CheckIcon className="ui-icon" aria-hidden="true" />
              {saving ? "保存中…" : dirty ? "保存" : "已保存"}
            </button>
            <button type="button" className="ghost icon-label" data-testid="settings-close" onClick={requestClose}>
              <ArrowLeftIcon className="ui-icon" aria-hidden="true" />
              返回编辑
            </button>
          </>
        }
      />
      <div className="settings-page-body">
        <aside className="settings-pane" data-testid="settings-panel">
          <div className="settings-tabs" role="tablist" aria-label="设置分类">
            <button
              type="button"
              role="tab"
              aria-selected={tab === "site"}
              className={tab === "site" ? "on icon-label" : "icon-label"}
              data-testid="settings-tab-site"
              onClick={() => onTab("site")}
            >
              <GlobeAltIcon className="ui-icon" aria-hidden="true" />
              站点信息
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "theme"}
              className={tab === "theme" ? "on icon-label" : "icon-label"}
              data-testid="settings-tab-theme"
              onClick={() => onTab("theme")}
            >
              <SwatchIcon className="ui-icon" aria-hidden="true" />
              主题外观
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "plugin"}
              className={tab === "plugin" ? "on icon-label" : "icon-label"}
              data-testid="settings-tab-plugin"
              onClick={() => onTab("plugin")}
            >
              <PuzzlePieceIcon className="ui-icon" aria-hidden="true" />
              插件
            </button>
          </div>

          {tab === "site" ? (
            <div className="settings-pane-scroll">
              <p className="hint">改完后点保存，站点信息和主题会一起写入。右侧可以先预览未保存的改动。</p>
              <div className="grid">
                <Field testId="cfg-title" label="标题" value={draftConfig.title} onChange={(value) => setSite("title", value)} />
                <Field testId="cfg-subtitle" label="副标题" value={draftConfig.subtitle} onChange={(value) => setSite("subtitle", value)} />
                <Field testId="cfg-author" label="作者" value={draftConfig.author} hint="显示在文章页和页脚" onChange={(value) => setSite("author", value)} />
                <Field
                  testId="cfg-avatar"
                  label="头像 URL"
                  value={draftConfig.avatar}
                  hint="支持 https:// 地址或站内 /images/ 路径"
                  onChange={(value) => setSite("avatar", value)}
                />
                <ComboSelect
                  label="语言"
                  testId="cfg-language"
                  value={draftConfig.language}
                  options={LANGUAGE_OPTIONS}
                  searchPlaceholder="搜索语言或代码…"
                  onChange={(value) => setSite("language", value)}
                />
                <ComboSelect
                  label="时区"
                  testId="cfg-timezone"
                  value={draftConfig.timezone}
                  options={zones}
                  searchPlaceholder="搜索城市或时区…"
                  onChange={(value) => setSite("timezone", value)}
                />
                <PermalinkField value={draftConfig.permalink} onChange={(value) => setSite("permalink", value)} />
                <Field testId="cfg-url" label="站点 URL" value={draftConfig.url} hint="本地预览用 localhost，发布后按仓库生成" onChange={(value) => setSite("url", value)} />
                <Field testId="cfg-root" label="站点根路径" value={draftConfig.root} hint="一般是 / ，子路径站点写成 /blog/" onChange={(value) => setSite("root", value)} />
              </div>
              <label className="block">
                描述
                <textarea
                  data-testid="cfg-description"
                  value={draftConfig.description}
                  onChange={(event) => setSite("description", event.target.value)}
                />
              </label>
              <h3>高级 YAML</h3>
              <textarea
                className="yaml"
                data-testid="cfg-yaml"
                value={draftYaml}
                onChange={(event) => setYaml(event.target.value)}
                spellCheck={false}
              />
            </div>
          ) : tab === "theme" ? (
            <div className="settings-pane-scroll">
              <p className="hint">点选主题和外观后记得保存。右侧会先用当前草稿跑一次 Hexo。</p>
              <AddonInstaller
                kind="theme"
                source={addonSource}
                busy={addonBusy}
                error={addonError}
                step={addonStep}
                onSource={setAddonSource}
                onInstall={() => void submitAddon("theme")}
              />
              <div className="theme-pick" data-testid="theme-settings">
                {themes.map((item) => {
                  const swatch = item.tint ?? THEME_TINT[item.id] ?? tintFromId(item.id);
                  const on = draftConfig.theme === item.id;
                  return (
                    <div className="theme-pick-wrap" key={item.id}>
                      <button
                        type="button"
                        className={on ? "theme-pick-card on" : "theme-pick-card"}
                        data-testid={`theme-${item.id}`}
                        title={item.description}
                        onClick={() => pickTheme(item.id)}
                      >
                        <i style={{ background: `linear-gradient(135deg, ${swatch.ink}, ${swatch.paper})` }} />
                        <strong>{item.label}</strong>
                        <span>{item.description}</span>
                        <small>{item.builtin ? "预装" : "已安装"}</small>
                        {on ? <em>使用中</em> : null}
                      </button>
                      {!item.builtin ? (
                        <button
                          type="button"
                          className="theme-remove icon-btn"
                          title={on ? "正在使用的主题不能卸载" : "卸载主题"}
                          disabled={on}
                          onClick={() => void mutateAddon(() => onRemoveAddon(item.id))}
                        >
                          <TrashIcon className="ui-icon" aria-hidden="true" />
                        </button>
                      ) : null}
                    </div>
                  );
                })}
              </div>
              <div className="settings-theme-current" style={{ borderColor: tint.ink }}>
                <p className="studio-settings-kicker">当前主题</p>
                <h4>{meta.label}</h4>
                <p className="hint">{meta.description}</p>
              </div>
              <ThemeSettingsForm
                fields={meta.settings}
                settings={draftTheme}
                onChange={setThemeValues}
              />
              {!meta.settings.length ? (
                <label className="block">
                  主题 YAML
                  <textarea
                    className="yaml"
                    data-testid="theme-config-yaml"
                    value={draftThemeYaml}
                    placeholder="# 这个主题没有提供可视化 schema，请按主题文档填写"
                    onChange={(event) => {
                      const yaml = event.target.value;
                      setDraftThemeYaml(yaml);
                      setThemeYamlDrafts((current) => ({
                        ...current,
                        [draftConfig.theme]: yaml,
                      }));
                      schedulePreview({
                        ...draft,
                        themeYaml: yaml,
                        themeYamlDrafts: {
                          ...themeYamlDrafts,
                          [draftConfig.theme]: yaml,
                        },
                      });
                    }}
                  />
                </label>
              ) : null}
            </div>
          ) : (
            <div className="settings-pane-scroll" data-testid="plugin-settings">
              <p className="hint">插件会在隔离的 Hexo worker 中运行。核心插件不能关闭或删除。</p>
              <AddonInstaller
                kind="plugin"
                source={addonSource}
                busy={addonBusy}
                error={addonError}
                step={addonStep}
                onSource={setAddonSource}
                onInstall={() => void submitAddon("plugin")}
              />
              <div className="addon-list">
                {plugins.map((plugin) => (
                  <article className="addon-row" key={plugin.id} data-testid={`plugin-${plugin.id}`}>
                    <button
                      type="button"
                      className="addon-row-info"
                      onClick={() => void selectPlugin(plugin)}
                    >
                      <strong>{plugin.label}</strong>
                      <span>{plugin.description}</span>
                      <small>{plugin.builtin ? (plugin.core ? "核心预装" : "预装") : "用户安装"}</small>
                    </button>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={plugin.enabled !== false}
                      className={plugin.enabled !== false ? "studio-switch on" : "studio-switch"}
                      disabled={plugin.core}
                      data-testid={`plugin-toggle-${plugin.id}`}
                      onClick={() =>
                        void mutateAddon(() =>
                          onToggleAddon(plugin.id, plugin.enabled === false),
                        )
                      }
                    >
                      <i />
                    </button>
                    {!plugin.builtin ? (
                      <button
                        type="button"
                        className="icon-btn"
                        title="卸载插件"
                        onClick={() => void mutateAddon(() => onRemoveAddon(plugin.id))}
                      >
                        <TrashIcon className="ui-icon" aria-hidden="true" />
                      </button>
                    ) : null}
                  </article>
                ))}
              </div>
              {selectedPlugin ? (
                <section className="plugin-config" data-testid="plugin-config">
                  <h4>{selectedPlugin.label} 配置</h4>
                  {pluginConfigBusy ? <p className="hint">读取中…</p> : null}
                  {!pluginConfigBusy && selectedPlugin.settings.length ? (
                    <ThemeSettingsForm
                      fields={selectedPlugin.settings}
                      settings={pluginValues}
                      onChange={setPluginValues}
                    />
                  ) : null}
                  {!pluginConfigBusy && !selectedPlugin.settings.length ? (
                    <label className="block">
                      插件 YAML
                      <textarea
                        className="yaml"
                        value={pluginYaml}
                        data-testid="plugin-config-yaml"
                        placeholder="# 该插件没有可视化 schema，请按插件文档填写"
                        onChange={(event) => setPluginYaml(event.target.value)}
                      />
                    </label>
                  ) : null}
                  <button
                    type="button"
                    className="primary"
                    disabled={pluginConfigBusy}
                    data-testid="plugin-config-save"
                    onClick={() =>
                      void onSavePluginConfig(selectedPlugin, pluginValues, pluginYaml)
                    }
                  >
                    保存插件配置
                  </button>
                </section>
              ) : null}
            </div>
          )}
          <footer className="settings-pane-foot">
            <p className="hint">{dirty ? "站点信息和主题都还没写入本地。" : "已与本地保存的内容一致。"}</p>
            <button
              type="button"
              className="primary icon-label"
              data-testid="settings-save-footer"
              disabled={!dirty || saving}
              onClick={() => void save()}
            >
              <CheckIcon className="ui-icon" aria-hidden="true" />
              {saving ? "保存中…" : "保存全部"}
            </button>
          </footer>
        </aside>
        <section className="settings-preview" data-testid="settings-preview">
          {loading && (
            <div className="studio-cover" data-testid="theme-preview-loading" role="status" aria-live="polite" aria-busy="true">
              <div className="studio-loading">
                <div className="studio-loading-mark" aria-hidden="true">
                  <span className="studio-loading-sheet" />
                  <span className="studio-loading-sheet" />
                  <span className="studio-loading-sheet">
                    <i />
                    <i />
                    <i />
                  </span>
                </div>
                <p className="studio-loading-kicker">Hexo generate</p>
                <h3>正在渲染 {meta.label}</h3>
                <p className="studio-loading-copy">用当前草稿生成右侧预览，点保存才会写入本地。</p>
                <div className="studio-loading-bar" aria-hidden="true">
                  <i />
                </div>
              </div>
            </div>
          )}
          {error && !loading && (
            <div className="studio-cover error" data-testid="theme-preview-error">
              <div className="studio-error">
                <p className="studio-loading-kicker">预览失败</p>
                <h3>这一版没有生成出来</h3>
                <p className="studio-loading-copy">{error}</p>
                <button type="button" className="primary icon-label" data-testid="theme-preview-retry" onClick={onRetry}>
                  <ArrowPathIcon className="ui-icon" aria-hidden="true" />
                  重新生成
                </button>
              </div>
            </div>
          )}
          {!previewUrl && !loading && !error && (
            <div className="studio-cover">
              <div className="studio-error">
                <p className="studio-loading-kicker">Hexo 预览</p>
                <h3>右侧会马上看到效果</h3>
                <p className="studio-loading-copy">点选左侧主题或改外观选项，这里会重新 generate 一次。</p>
              </div>
            </div>
          )}
          {previewUrl && (
            <iframe
              title={`${meta.label} 预览`}
              data-testid="theme-preview-frame"
              data-color-scheme={resolvedColorScheme(draftConfig.theme, draftTheme) ?? ""}
              src={previewUrl}
              // The preview is a capability URL on its own origin, which holds
              // no session cookie and serves no app API. Theme scripts are what
              // build most themes' pages, so they run; the origin boundary, not
              // the sandbox, is what keeps them away from the editor. Here
              // allow-same-origin only grants the frame its own foreign origin
              // (so themes can use localStorage), never the editor's.
              sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
            />
          )}
        </section>
      </div>
      <ConfirmDialog
        open={leaveOpen}
        title="放弃未保存的改动？"
        message="站点信息和主题都还没保存。离开后这些修改会丢掉。"
        confirmLabel="放弃"
        danger={false}
        onClose={() => setLeaveOpen(false)}
        onConfirm={() => {
          setLeaveOpen(false);
          onClose();
        }}
      />
    </div>
  );
}

function readYamlScalar(yaml: string, key: string): string | undefined {
  const match = yaml.match(new RegExp(`^${key}:\\s*(.*)$`, "m"));
  if (!match) return undefined;
  let value = (match[1] ?? "").trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  return value;
}

function mergeYamlIntoConfig(current: SiteConfig, yaml: string): SiteConfig {
  const next = { ...current };
  const title = readYamlScalar(yaml, "title");
  const subtitle = readYamlScalar(yaml, "subtitle");
  const description = readYamlScalar(yaml, "description");
  const author = readYamlScalar(yaml, "author");
  const language = readYamlScalar(yaml, "language");
  const timezone = readYamlScalar(yaml, "timezone");
  const url = readYamlScalar(yaml, "url");
  const root = readYamlScalar(yaml, "root");
  const permalink = readYamlScalar(yaml, "permalink");
  const theme = readYamlScalar(yaml, "theme");
  if (title != null) next.title = title;
  if (subtitle != null) next.subtitle = subtitle;
  if (description != null) next.description = description;
  if (author != null) next.author = author;
  if (language != null) next.language = language;
  if (timezone != null) next.timezone = timezone;
  if (url != null) next.url = url;
  if (root != null) next.root = root;
  if (permalink != null) next.permalink = permalink;
  if (isThemeId(theme)) next.theme = theme;
  return next;
}

function AddonInstaller({
  kind,
  source,
  busy,
  error,
  step,
  onSource,
  onInstall,
}: {
  kind: AddonKind;
  source: string;
  busy: boolean;
  error: string;
  step: InstallStep | null;
  onSource: (value: string) => void;
  onInstall: () => void;
}) {
  const noun = kind === "theme" ? "主题" : "插件";
  const percent = useSmoothedPercent(step?.percent ?? 0, busy);

  return (
    <div className="addon-installer" data-testid={`addon-installer-${kind}`}>
      <div className="addon-installer-row">
        <label>
          安装{noun}
          <input
            value={source}
            disabled={busy}
            data-testid={`addon-source-${kind}`}
            placeholder={kind === "theme" ? "hexo-theme-name 或 owner/repo" : "hexo-plugin-name 或 owner/repo"}
            onChange={(event) => onSource(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") onInstall();
            }}
          />
        </label>
        <button
          type="button"
          className="primary icon-label"
          disabled={busy || !source.trim()}
          data-testid={`addon-install-${kind}`}
          onClick={onInstall}
        >
          <PlusIcon className="ui-icon" aria-hidden="true" />
          {busy ? "安装中…" : "安装"}
        </button>
      </div>
      <p className="hint addon-installer-hint">
        支持 npm 包名或公开 GitHub 仓库，安装的{noun}只在本账号生效。
      </p>
      {busy || percent > 0 ? (
        <div
          className="addon-progress"
          data-testid={`addon-progress-${kind}`}
          role="progressbar"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`安装${noun}进度`}
        >
          <div className="addon-progress-track">
            <i style={{ width: `${Math.max(percent, 4)}%` }} />
          </div>
          <div className="addon-progress-text">
            <span>{step?.label || "正在准备"}</span>
            <em>{percent}%</em>
          </div>
        </div>
      ) : null}
      {error ? <p className="hint error-text">{error}</p> : null}
    </div>
  );
}

/**
 * npm only reports progress when it hits the network, so a warm cache would park
 * the bar on one number. Creep forward between server updates, never backwards
 * and never far ahead of what the server last confirmed.
 */
function useSmoothedPercent(target: number, busy: boolean): number {
  const [shown, setShown] = useState(target);

  useEffect(() => {
    setShown((current) => (target < current ? target : current));
  }, [target]);

  useEffect(() => {
    if (!busy) {
      setShown(target);
      return;
    }
    const timer = window.setInterval(() => {
      setShown((current) => Math.min(Math.max(current, target) + 0.4, target + 14, 96));
    }, 220);
    return () => window.clearInterval(timer);
  }, [busy, target]);

  return Math.round(Math.max(shown, target));
}

function tintFromId(id: string): { ink: string; paper: string } {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  const hue = hash % 360;
  return { ink: `hsl(${hue} 62% 40%)`, paper: `hsl(${hue} 55% 92%)` };
}

function Field({
  label,
  value,
  onChange,
  testId,
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  testId: string;
  hint?: string;
}) {
  return (
    <label>
      {label}
      {hint ? <em className="hint">{hint}</em> : null}
      <input data-testid={testId} value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function PermalinkField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <div className="studio-field" data-testid="cfg-permalink-field">
      <span>文章链接</span>
      <em className="hint">发布后每篇文章的 URL 形态</em>
      <div className="studio-chips" role="radiogroup" aria-label="文章链接">
        {PERMALINK_PRESETS.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={value === option.value}
            className={value === option.value ? "studio-chip on" : "studio-chip"}
            data-testid={`cfg-permalink-${option.value}`}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
      <input data-testid="cfg-permalink" value={value} spellCheck={false} onChange={(event) => onChange(event.target.value)} />
    </div>
  );
}

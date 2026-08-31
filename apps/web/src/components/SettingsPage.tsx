import { ArrowLeftIcon, ArrowPathIcon, CheckIcon, GlobeAltIcon, SwatchIcon } from "@heroicons/react/24/outline";
import {
  applySiteConfigToYaml,
  THEME_META,
  THEMES,
  resolvedColorScheme,
  themeSettingFields,
  type SiteConfig,
  type ThemeId,
  type ThemeSettings,
} from "@open-pages/shared";
import { useEffect, useMemo, useRef, useState } from "react";
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
  rawYaml: string;
  themeDrafts: Partial<Record<ThemeId, ThemeSettings>>;
};

interface SettingsPageProps {
  tab: SettingsTab;
  config: SiteConfig;
  themeSettings: ThemeSettings;
  rawYaml: string;
  previewUrl: string | null;
  loading: boolean;
  error: string | null;
  saving: boolean;
  onTab: (tab: SettingsTab) => void;
  onDirtyChange?: (dirty: boolean) => void;
  onLoadTheme: (theme: ThemeId) => Promise<ThemeSettings>;
  onPreview: (draft: SettingsDraft) => void;
  onSave: (draft: SettingsDraft) => Promise<SettingsDraft>;
  onRetry: () => void;
  onClose: () => void;
}

export type SettingsTab = "site" | "theme";

export function SettingsPage({
  tab,
  config,
  themeSettings,
  rawYaml,
  previewUrl,
  loading,
  error,
  saving,
  onTab,
  onDirtyChange,
  onLoadTheme,
  onPreview,
  onSave,
  onRetry,
  onClose,
}: SettingsPageProps) {
  const [draftConfig, setDraftConfig] = useState(config);
  const [draftTheme, setDraftTheme] = useState(themeSettings);
  const [draftYaml, setDraftYaml] = useState(rawYaml);
  const [themeDrafts, setThemeDrafts] = useState<Partial<Record<ThemeId, ThemeSettings>>>(() => ({
    [config.theme]: themeSettings,
  }));
  const [leaveOpen, setLeaveOpen] = useState(false);
  const previewTimer = useRef<number | undefined>(undefined);
  const themeDraftsRef = useRef(themeDrafts);
  themeDraftsRef.current = themeDrafts;

  const draft: SettingsDraft = useMemo(
    () => ({
      config: draftConfig,
      themeSettings: draftTheme,
      rawYaml: draftYaml,
      themeDrafts: { ...themeDrafts, [draftConfig.theme]: draftTheme },
    }),
    [draftConfig, draftTheme, draftYaml, themeDrafts],
  );

  const dirty =
    JSON.stringify(draftConfig) !== JSON.stringify(config) ||
    JSON.stringify(draftTheme) !== JSON.stringify(themeSettings) ||
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
      const values = cached ?? (await onLoadTheme(theme));
      setDraftTheme(values);
      setThemeDrafts((current) => ({ ...current, [previous]: draftTheme, [theme]: values }));
      schedulePreview({
        config: nextConfig,
        rawYaml: nextYaml,
        themeSettings: values,
        themeDrafts: { ...themeDraftsRef.current, [previous]: draftTheme, [theme]: values },
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
      setDraftYaml(saved.rawYaml);
      setThemeDrafts(saved.themeDrafts);
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

  const meta = THEME_META[draftConfig.theme];
  const tint = THEME_TINT[draftConfig.theme];
  const zones = useMemo(() => timezoneOptions(), []);

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
          </div>

          {tab === "site" ? (
            <div className="settings-pane-scroll">
              <p className="hint">改完后点保存，站点信息和主题会一起写入。右侧可以先预览未保存的改动。</p>
              <div className="grid">
                <Field testId="cfg-title" label="标题" value={draftConfig.title} onChange={(value) => setSite("title", value)} />
                <Field testId="cfg-subtitle" label="副标题" value={draftConfig.subtitle} onChange={(value) => setSite("subtitle", value)} />
                <Field testId="cfg-author" label="作者" value={draftConfig.author} hint="显示在文章页和页脚" onChange={(value) => setSite("author", value)} />
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
          ) : (
            <div className="settings-pane-scroll">
              <p className="hint">点选主题和外观后记得保存。右侧会先用当前草稿跑一次 Hexo。</p>
              <div className="theme-pick" data-testid="theme-settings">
                {THEMES.map((id) => {
                  const item = THEME_META[id];
                  const swatch = THEME_TINT[id];
                  const on = draftConfig.theme === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      className={on ? "theme-pick-card on" : "theme-pick-card"}
                      data-testid={`theme-${id}`}
                      onClick={() => pickTheme(id)}
                    >
                      <i style={{ background: `linear-gradient(135deg, ${swatch.ink}, ${swatch.paper})` }} />
                      <strong>{item.label}</strong>
                      <span>{item.description}</span>
                      {on ? <em>使用中</em> : null}
                    </button>
                  );
                })}
              </div>
              <div className="settings-theme-current" style={{ borderColor: tint.ink }}>
                <p className="studio-settings-kicker">当前主题</p>
                <h4>{meta.label}</h4>
                <p className="hint">{meta.description}</p>
              </div>
              <ThemeSettingsForm
                fields={themeSettingFields(draftConfig.theme)}
                settings={draftTheme}
                onChange={setThemeValues}
              />
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
              sandbox="allow-scripts allow-popups allow-forms"
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
  if (theme && THEMES.includes(theme as ThemeId)) next.theme = theme as ThemeId;
  return next;
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

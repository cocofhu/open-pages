import type { SiteConfig } from "@open-pages/shared";

interface SettingsPanelProps {
  open: boolean;
  config: SiteConfig;
  onChange: (config: SiteConfig) => void;
  rawYaml: string;
  onRawYaml: (value: string) => void;
  onClose: () => void;
}

export function SettingsPanel({ open, config, onChange, rawYaml, onRawYaml, onClose }: SettingsPanelProps) {
  const set = <K extends keyof SiteConfig>(key: K, value: SiteConfig[K]) => {
    onChange({ ...config, [key]: value });
  };

  return (
    <div className={open ? "drawer-backdrop open" : "drawer-backdrop"} onClick={onClose} role="presentation">
      <aside
        className={open ? "drawer open" : "drawer"}
        hidden={!open}
        data-testid="settings-panel"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="drawer-head">
          <div>
            <h2>站点设置</h2>
            <p className="hint">写入 `_config.yml`。主题仅限白名单，不会执行自定义脚本。</p>
          </div>
          <button type="button" className="ghost" data-testid="settings-close" onClick={onClose}>
            关闭
          </button>
        </header>
        <div className="grid">
          <Field testId="cfg-title" label="标题" value={config.title} onChange={(value) => set("title", value)} />
          <Field testId="cfg-subtitle" label="副标题" value={config.subtitle} onChange={(value) => set("subtitle", value)} />
          <Field testId="cfg-author" label="作者" value={config.author} onChange={(value) => set("author", value)} />
          <Field testId="cfg-language" label="语言" value={config.language} onChange={(value) => set("language", value)} />
          <Field testId="cfg-timezone" label="时区" value={config.timezone} onChange={(value) => set("timezone", value)} />
          <Field testId="cfg-permalink" label="permalink" value={config.permalink} onChange={(value) => set("permalink", value)} />
          <Field testId="cfg-url" label="url" value={config.url} onChange={(value) => set("url", value)} />
          <Field testId="cfg-root" label="root" value={config.root} onChange={(value) => set("root", value)} />
        </div>
        <label className="block">
          描述
          <textarea
            data-testid="cfg-description"
            value={config.description}
            onChange={(event) => set("description", event.target.value)}
          />
        </label>
        <p className="hint">主题在「发布」第一步的预览页里选择，可以看到真实 Hexo 效果。</p>
        <h3>高级 YAML</h3>
        <textarea
          className="yaml"
          data-testid="cfg-yaml"
          value={rawYaml}
          onChange={(event) => onRawYaml(event.target.value)}
          spellCheck={false}
        />
      </aside>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  testId,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  testId: string;
}) {
  return (
    <label>
      {label}
      <input data-testid={testId} value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

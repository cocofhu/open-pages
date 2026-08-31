import { THEME_META, THEMES, type ThemeId } from "@open-pages/shared";
import { StudioBar } from "./StudioBar";

interface ThemeStudioProps {
  theme: ThemeId;
  previewUrl: string | null;
  loading: boolean;
  error: string | null;
  onTheme: (theme: ThemeId) => void;
  onBack: () => void;
  onNext: () => void;
}

export function ThemeStudio({
  theme,
  previewUrl,
  loading,
  error,
  onTheme,
  onBack,
  onNext,
}: ThemeStudioProps) {
  return (
    <div className="studio" data-testid="theme-studio">
      <StudioBar
        step={1}
        actions={
          <>
            <button type="button" className="ghost" data-testid="theme-back" onClick={onBack}>
              返回编辑
            </button>
            <button type="button" className="primary" data-testid="btn-publish-next" onClick={onNext}>
              下一步
            </button>
          </>
        }
      />
      <div className="studio-body">
        <aside className="studio-themes">
          {THEMES.map((id) => (
            <button
              key={id}
              type="button"
              className={theme === id ? "theme-card on" : "theme-card"}
              data-testid={`theme-${id}`}
              onClick={() => onTheme(id)}
            >
              <strong>{THEME_META[id].label}</strong>
              <span>{THEME_META[id].description}</span>
            </button>
          ))}
        </aside>
        <section className="studio-preview">
          {loading && (
            <div className="studio-cover" data-testid="theme-preview-loading">
              正在用 Hexo 渲染 {THEME_META[theme].label}…
            </div>
          )}
          {error && !loading && (
            <div className="studio-cover error" data-testid="theme-preview-error">
              {error}
            </div>
          )}
          {previewUrl && (
            <iframe
              title={`${THEME_META[theme].label} 预览`}
              data-testid="theme-preview-frame"
              src={previewUrl}
              sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
            />
          )}
        </section>
      </div>
    </div>
  );
}

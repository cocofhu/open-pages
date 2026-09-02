import { useEffect } from "react";
import { ArrowPathIcon, XMarkIcon } from "@heroicons/react/24/outline";

interface PreviewOverlayProps {
  open: boolean;
  title: string;
  hint: string;
  url: string | null;
  loading: boolean;
  error: string | null;
  onReload: () => void;
  onClose: () => void;
}

export function PreviewOverlay({
  open,
  title,
  hint,
  url,
  loading,
  error,
  onReload,
  onClose,
}: PreviewOverlayProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="preview-overlay" data-testid="preview-overlay" role="dialog" aria-modal="true" aria-label={title}>
      <header className="preview-overlay-bar">
        <div className="preview-overlay-title">
          <strong>{title}</strong>
          <span>{hint}</span>
        </div>
        <div className="preview-overlay-actions">
          <button
            type="button"
            className="ghost icon-label"
            data-testid="preview-reload"
            disabled={loading}
            onClick={onReload}
          >
            <ArrowPathIcon className="ui-icon" aria-hidden="true" />
            {loading ? "生成中…" : "重新生成"}
          </button>
          <button
            type="button"
            className="ghost icon-btn-plain"
            data-testid="preview-close"
            title="关闭预览"
            onClick={onClose}
          >
            <XMarkIcon className="ui-icon" aria-hidden="true" />
            <span className="sr-only">关闭预览</span>
          </button>
        </div>
      </header>
      <section className="preview-overlay-body">
        {loading && (
          <div className="studio-cover" data-testid="preview-loading" role="status" aria-live="polite" aria-busy="true">
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
              <h3>正在生成站点</h3>
              <p className="studio-loading-copy">{hint}</p>
              <div className="studio-loading-bar" aria-hidden="true">
                <i />
              </div>
            </div>
          </div>
        )}
        {error && !loading && (
          <div className="studio-cover error" data-testid="preview-error">
            <div className="studio-error">
              <p className="studio-loading-kicker">预览失败</p>
              <h3>这一版没有生成出来</h3>
              <p className="studio-loading-copy">{error}</p>
              <button type="button" className="primary icon-label" onClick={onReload}>
                <ArrowPathIcon className="ui-icon" aria-hidden="true" />
                重新生成
              </button>
            </div>
          </div>
        )}
        {url && (
          <iframe
            title={title}
            data-testid="preview-frame"
            src={url}
            // Same reasoning as the settings preview: the capability URL is its
            // own origin holding no session cookie, so allow-same-origin hands
            // the frame that foreign origin only, never the editor's.
            sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
          />
        )}
      </section>
    </div>
  );
}

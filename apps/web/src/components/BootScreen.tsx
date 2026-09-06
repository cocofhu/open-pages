export function BootScreen({
  kicker = "Open Pages",
  title,
  copy,
  percent,
  error,
  onRetry,
  onCancel,
}: {
  kicker?: string;
  title: string;
  copy?: string;
  percent?: number;
  error?: string | null;
  onRetry?: () => void;
  onCancel?: () => void;
}) {
  const width = Math.max(0, Math.min(100, Math.round(percent ?? 12)));
  return (
    <div className="boot-screen" data-testid="boot">
      <div className="studio-loading" role="status" aria-live="polite" aria-busy={!error}>
        <div className="studio-loading-mark" aria-hidden="true">
          <span className="studio-loading-sheet" />
          <span className="studio-loading-sheet" />
          <span className="studio-loading-sheet">
            <i />
            <i />
            <i />
          </span>
        </div>
        <p className="studio-loading-kicker">{error ? "同步失败" : kicker}</p>
        <h3>{error ? "没法打开这个仓库" : title}</h3>
        <p className="studio-loading-copy">{error ?? copy ?? "正在加载站点资源…"}</p>
        {!error ? (
          <div className="studio-loading-bar" aria-hidden="true">
            <i style={{ width: `${width}%` }} />
          </div>
        ) : null}
        <div className="boot-actions">
          {error && onRetry ? (
            <button type="button" className="primary" onClick={onRetry}>
              重试
            </button>
          ) : null}
          {onCancel ? (
            <button type="button" className="ghost" onClick={onCancel}>
              换一个仓库
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

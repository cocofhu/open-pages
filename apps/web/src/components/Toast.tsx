export interface ToastState {
  kind: "info" | "ok" | "error";
  text: string;
  href?: string;
}

export function Toast({ toast, onDismiss }: { toast: ToastState | null; onDismiss: () => void }) {
  if (!toast) return null;
  return (
    <div className={`toast ${toast.kind}`} data-testid="toast" role="status">
      <span>{toast.text}</span>
      {toast.href && (
        <a href={toast.href} target="_blank" rel="noreferrer" data-testid="toast-link">
          打开预览
        </a>
      )}
      <button type="button" className="ghost" onClick={onDismiss} aria-label="关闭">
        ×
      </button>
    </div>
  );
}

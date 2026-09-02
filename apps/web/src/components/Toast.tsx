import { ArrowTopRightOnSquareIcon, XMarkIcon } from "@heroicons/react/24/outline";

export interface ToastState {
  kind: "info" | "ok" | "error";
  text: string;
  href?: string;
  linkText?: string;
  sticky?: boolean;
}

export function Toast({ toast, onDismiss }: { toast: ToastState | null; onDismiss: () => void }) {
  if (!toast) return null;
  return (
    <div className={`toast ${toast.kind}`} data-testid="toast" role="status">
      <span>{toast.text}</span>
      {toast.href && (
        <a href={toast.href} target="_blank" rel="noreferrer" data-testid="toast-link" className="icon-label">
          <ArrowTopRightOnSquareIcon className="ui-icon" aria-hidden="true" />
          {toast.linkText ?? "打开预览"}
        </a>
      )}
      <button type="button" className="ghost toast-close" onClick={onDismiss} aria-label="关闭">
        <XMarkIcon className="ui-icon" aria-hidden="true" />
      </button>
    </div>
  );
}

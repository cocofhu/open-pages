interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  onClose: () => void;
  onConfirm: () => void;
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "删除",
  onClose,
  onConfirm,
}: ConfirmDialogProps) {
  if (!open) return null;
  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        className="modal"
        data-testid="dialog-confirm"
        role="dialog"
        onClick={(event) => event.stopPropagation()}
      >
        <h2>{title}</h2>
        <p className="hint">{message}</p>
        <div className="modal-actions">
          <button type="button" onClick={onClose}>
            取消
          </button>
          <button type="button" className="danger" data-testid="confirm-ok" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

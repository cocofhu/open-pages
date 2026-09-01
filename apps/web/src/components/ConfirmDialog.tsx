import { TrashIcon, XMarkIcon } from "@heroicons/react/24/outline";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "删除",
  danger = true,
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
          <button type="button" className="icon-label" onClick={onClose}>
            <XMarkIcon className="ui-icon" aria-hidden="true" />
            取消
          </button>
          <button
            type="button"
            className={danger ? "danger icon-label" : "primary icon-label"}
            data-testid="confirm-ok"
            onClick={onConfirm}
          >
            {danger ? <TrashIcon className="ui-icon" aria-hidden="true" /> : <XMarkIcon className="ui-icon" aria-hidden="true" />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

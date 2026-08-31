import { useEffect, useState } from "react";

export type DocKind = "post" | "draft" | "page";

interface NewDocDialogProps {
  open: boolean;
  kind: DocKind;
  onKind: (kind: DocKind) => void;
  onClose: () => void;
  onCreate: (kind: DocKind, title: string) => void;
}

export function NewDocDialog({ open, kind, onKind, onClose, onCreate }: NewDocDialogProps) {
  const [title, setTitle] = useState("Untitled");

  useEffect(() => {
    if (open) setTitle("Untitled");
  }, [open, kind]);

  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <form
        className="modal"
        data-testid="dialog-new-doc"
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          const next = title.trim();
          if (!next) return;
          onCreate(kind, next);
        }}
      >
        <h2>新建{kindLabel(kind)}</h2>
        <div className="seg kind-seg" role="radiogroup" aria-label="类型">
          {(["post", "draft", "page"] as const).map((item) => (
            <button
              key={item}
              type="button"
              role="radio"
              aria-checked={kind === item}
              className={kind === item ? "on" : ""}
              data-testid={`kind-${item}`}
              onClick={() => onKind(item)}
            >
              {kindLabel(item)}
            </button>
          ))}
        </div>
        <label>
          标题
          <input
            data-testid="new-doc-title"
            value={title}
            autoFocus
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <div className="modal-actions">
          <button type="button" onClick={onClose}>
            取消
          </button>
          <button type="submit" className="primary" data-testid="new-doc-submit">
            创建
          </button>
        </div>
      </form>
    </div>
  );
}

function kindLabel(kind: DocKind): string {
  if (kind === "draft") return "草稿";
  if (kind === "page") return "页面";
  return "文章";
}

import { XMarkIcon } from "@heroicons/react/24/outline";
import type { FrontMatter } from "@open-pages/shared";

interface DocMetaPanelProps {
  open: boolean;
  matter: FrontMatter;
  onChange: (matter: FrontMatter) => void;
  onClose: () => void;
}

export function DocMetaPanel({ open, matter, onChange, onClose }: DocMetaPanelProps) {
  return (
    <div className={open ? "drawer-backdrop open" : "drawer-backdrop"} onClick={onClose} role="presentation">
      <aside
        className={open ? "drawer open" : "drawer"}
        hidden={!open}
        data-testid="doc-meta-panel"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="drawer-head">
          <div>
            <h2>文章属性</h2>
          </div>
          <button type="button" className="ghost drawer-close" data-testid="doc-meta-close" aria-label="关闭" onClick={onClose}>
            <XMarkIcon className="ui-icon" aria-hidden="true" />
          </button>
        </header>

        <div className="doc-meta-fields">
          <label>
            日期
            <input
              type="text"
              data-testid="matter-date"
              value={matter.date}
              placeholder="YYYY-MM-DD HH:mm:ss"
              onChange={(event) => onChange({ ...matter, date: event.target.value })}
            />
          </label>
          <label>
            标签
            <input
              type="text"
              data-testid="matter-tags"
              value={matter.tags.join(", ")}
              placeholder="用逗号分隔，例如 open-pages, notes"
              onChange={(event) =>
                onChange({
                  ...matter,
                  tags: event.target.value
                    .split(",")
                    .map((item) => item.trim())
                    .filter(Boolean),
                })
              }
            />
          </label>
          <label>
            分类
            <input
              type="text"
              data-testid="matter-categories"
              value={matter.categories.join(", ")}
              placeholder="用逗号分隔"
              onChange={(event) =>
                onChange({
                  ...matter,
                  categories: event.target.value
                    .split(",")
                    .map((item) => item.trim())
                    .filter(Boolean),
                })
              }
            />
          </label>
        </div>
      </aside>
    </div>
  );
}

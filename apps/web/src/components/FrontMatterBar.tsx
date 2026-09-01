import { AdjustmentsHorizontalIcon } from "@heroicons/react/24/outline";
import type { FrontMatter } from "@open-pages/shared";

interface FrontMatterBarProps {
  matter: FrontMatter;
  onChange: (matter: FrontMatter) => void;
  onOpenMeta: () => void;
}

export function FrontMatterBar({ matter, onChange, onOpenMeta }: FrontMatterBarProps) {
  const tags = matter.tags.length ? matter.tags.join(" · ") : null;
  const categories = matter.categories.length ? matter.categories.join(" · ") : null;
  const summary = [matter.date || null, tags, categories].filter(Boolean).join("  ·  ");

  return (
    <div className="front-matter">
      <input
        className="title-input"
        data-testid="title-input"
        value={matter.title}
        placeholder="标题"
        aria-label="标题"
        onChange={(event) => onChange({ ...matter, title: event.target.value })}
      />
      <button type="button" className="meta-summary" data-testid="btn-doc-meta" aria-label="文章属性" onClick={onOpenMeta}>
        <span>{summary || "设置日期、标签、分类"}</span>
        <AdjustmentsHorizontalIcon className="ui-icon meta-summary-action" aria-hidden="true" />
      </button>
    </div>
  );
}

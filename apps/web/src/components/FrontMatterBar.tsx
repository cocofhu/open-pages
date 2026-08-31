import type { FrontMatter } from "@open-pages/shared";

interface FrontMatterBarProps {
  matter: FrontMatter;
  onChange: (matter: FrontMatter) => void;
}

export function FrontMatterBar({ matter, onChange }: FrontMatterBarProps) {
  return (
    <div className="front-matter">
      <input
        className="title-input"
        data-testid="title-input"
        value={matter.title}
        placeholder="标题"
        onChange={(event) => onChange({ ...matter, title: event.target.value })}
      />
      <div className="meta-row">
        <label>
          日期
          <input
            type="text"
            data-testid="matter-date"
            value={matter.date}
            onChange={(event) => onChange({ ...matter, date: event.target.value })}
          />
        </label>
        <label>
          标签
          <input
            type="text"
            data-testid="matter-tags"
            value={matter.tags.join(", ")}
            placeholder="comma, separated"
            onChange={(event) =>
              onChange({
                ...matter,
                tags: event.target.value.split(",").map((item) => item.trim()).filter(Boolean),
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
    </div>
  );
}

import { fileKind } from "@open-pages/shared";
import { fileName } from "../lib/vfs";
import type { DocKind } from "./NewDocDialog";

export interface TreeFile {
  path: string;
  title: string;
}

interface FileTreeProps {
  files: TreeFile[];
  activePath: string | null;
  open: boolean;
  siteTitle: string;
  onOpen: (path: string) => void;
  onCreate: (kind: DocKind) => void;
  onDelete: (path: string) => void;
  onSettings: () => void;
  onHide: () => void;
}

export function FileTree({
  files,
  activePath,
  open,
  siteTitle,
  onOpen,
  onCreate,
  onDelete,
  onSettings,
  onHide,
}: FileTreeProps) {
  const posts = files.filter((file) => fileKind(file.path) === "post");
  const drafts = files.filter((file) => fileKind(file.path) === "draft");
  const pages = files.filter((file) => fileKind(file.path) === "page");

  return (
    <aside className={open ? "sidebar" : "sidebar hidden"} data-testid="sidebar">
      <div className="brand">
        <strong>Open Pages</strong>
        <span data-testid="sidebar-site-title">{siteTitle === "Open Pages" ? "本地站点" : siteTitle}</span>
      </div>
      <Section
        title="文章"
        kind="post"
        actionLabel="新建"
        onAction={() => onCreate("post")}
        items={posts}
        activePath={activePath}
        onOpen={onOpen}
        onDelete={onDelete}
      />
      <Section
        title="草稿"
        kind="draft"
        actionLabel="新建"
        onAction={() => onCreate("draft")}
        items={drafts}
        activePath={activePath}
        onOpen={onOpen}
        onDelete={onDelete}
      />
      <Section
        title="页面"
        kind="page"
        actionLabel="新建"
        onAction={() => onCreate("page")}
        items={pages}
        activePath={activePath}
        onOpen={onOpen}
        onDelete={onDelete}
      />
      <footer className="sidebar-foot">
        <button type="button" className="ghost" data-testid="btn-settings" onClick={onSettings}>
          设置
        </button>
        <button type="button" className="ghost" data-testid="btn-sidebar" onClick={onHide}>
          收起
        </button>
      </footer>
    </aside>
  );
}

function Section({
  title,
  kind,
  actionLabel,
  onAction,
  items,
  activePath,
  onOpen,
  onDelete,
}: {
  title: string;
  kind: string;
  actionLabel?: string;
  onAction?: () => void;
  items: TreeFile[];
  activePath: string | null;
  onOpen: (path: string) => void;
  onDelete: (path: string) => void;
}) {
  return (
    <section className="tree-section" data-testid={`tree-${kind}`}>
      <header>
        <span>{title}</span>
        {onAction && (
          <button type="button" className="text-btn" data-testid={`new-${kind}`} onClick={onAction}>
            {actionLabel}
          </button>
        )}
      </header>
      <ul>
        {items.length === 0 && <li className="empty">暂无</li>}
        {items.map((item) => (
          <li key={item.path} className={item.path === activePath ? "active" : ""}>
            <button
              type="button"
              className="file-btn"
              data-testid={`file-${slugFromPath(item.path)}`}
              onClick={() => onOpen(item.path)}
            >
              {item.title || prettyName(item.path)}
            </button>
            <button
              type="button"
              className="icon-btn"
              data-testid={`delete-${slugFromPath(item.path)}`}
              title="删除"
              onClick={() => onDelete(item.path)}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function prettyName(path: string): string {
  const name = fileName(path).replace(/\.md$/i, "");
  if (name.toLowerCase() === "index") {
    const parts = path.replaceAll("\\", "/").split("/").filter(Boolean);
    return parts.at(-2) ?? name;
  }
  return name;
}

export function slugFromPath(path: string): string {
  return prettyName(path).replace(/[^\w\u4e00-\u9fff-]+/g, "-").toLowerCase();
}

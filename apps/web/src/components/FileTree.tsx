import { useEffect, useMemo, useState } from "react";
import { ChevronDoubleLeftIcon, Cog6ToothIcon, PlusIcon, TrashIcon } from "@heroicons/react/24/outline";
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

type SectionId = "post" | "draft" | "page";

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
  const posts = useMemo(() => files.filter((file) => fileKind(file.path) === "post"), [files]);
  const drafts = useMemo(() => files.filter((file) => fileKind(file.path) === "draft"), [files]);
  const pages = useMemo(() => files.filter((file) => fileKind(file.path) === "page"), [files]);

  const [query, setQuery] = useState("");
  const [collapsedOverride, setCollapsedOverride] = useState<Partial<Record<SectionId, boolean>>>({});

  const defaultCollapsed: Record<SectionId, boolean> = {
    post: false,
    draft: drafts.length === 0,
    page: pages.length === 0,
  };

  const collapsed: Record<SectionId, boolean> = {
    post: collapsedOverride.post ?? defaultCollapsed.post,
    draft: collapsedOverride.draft ?? defaultCollapsed.draft,
    page: collapsedOverride.page ?? defaultCollapsed.page,
  };

  useEffect(() => {
    if (!activePath) return;
    const kind = fileKind(activePath);
    if (kind !== "post" && kind !== "draft" && kind !== "page") return;
    setCollapsedOverride((prev) => (prev[kind] === false ? prev : { ...prev, [kind]: false }));
  }, [activePath]);

  const normalized = query.trim().toLowerCase();
  const match = (item: TreeFile) =>
    !normalized ||
    item.title.toLowerCase().includes(normalized) ||
    prettyName(item.path).toLowerCase().includes(normalized);

  const filteredPosts = posts.filter(match);
  const filteredDrafts = drafts.filter(match);
  const filteredPages = pages.filter(match);
  const showSearch = files.length >= 6 || normalized.length > 0;

  const toggle = (id: SectionId) => {
    setCollapsedOverride((prev) => ({
      ...prev,
      [id]: !(prev[id] ?? defaultCollapsed[id]),
    }));
  };

  return (
    <aside className={open ? "sidebar" : "sidebar hidden"} data-testid="sidebar">
      <div className="brand">
        <strong>Open Pages</strong>
        <span data-testid="sidebar-site-title">{siteTitle === "Open Pages" ? "本地站点" : siteTitle}</span>
      </div>

      <div className="tree-scroll">
        {showSearch && (
          <label className="tree-search">
            <span className="sr-only">搜索文档</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索文章…"
              data-testid="tree-search"
            />
          </label>
        )}

        <Section
          title="文章"
          kind="post"
          count={posts.length}
          collapsed={collapsed.post}
          onToggle={() => toggle("post")}
          onAction={() => onCreate("post")}
          items={filteredPosts}
          activePath={activePath}
          onOpen={onOpen}
          onDelete={onDelete}
          emptyHint={normalized ? "无匹配" : "还没有文章"}
        />
        <Section
          title="草稿"
          kind="draft"
          count={drafts.length}
          collapsed={collapsed.draft}
          onToggle={() => toggle("draft")}
          onAction={() => onCreate("draft")}
          items={filteredDrafts}
          activePath={activePath}
          onOpen={onOpen}
          onDelete={onDelete}
          emptyHint={normalized ? "无匹配" : "暂无草稿"}
        />
        <Section
          title="页面"
          kind="page"
          count={pages.length}
          collapsed={collapsed.page}
          onToggle={() => toggle("page")}
          onAction={() => onCreate("page")}
          items={filteredPages}
          activePath={activePath}
          onOpen={onOpen}
          onDelete={onDelete}
          emptyHint={normalized ? "无匹配" : "暂无页面"}
        />
      </div>

      <footer className="sidebar-foot">
        <button type="button" className="ghost icon-label" data-testid="btn-settings" onClick={onSettings}>
          <Cog6ToothIcon className="ui-icon" aria-hidden="true" />
          设置
        </button>
        <button type="button" className="ghost icon-label" data-testid="btn-sidebar" onClick={onHide}>
          <ChevronDoubleLeftIcon className="ui-icon" aria-hidden="true" />
          收起
        </button>
      </footer>
    </aside>
  );
}

function Section({
  title,
  kind,
  count,
  collapsed,
  onToggle,
  onAction,
  items,
  activePath,
  onOpen,
  onDelete,
  emptyHint,
}: {
  title: string;
  kind: string;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
  onAction: () => void;
  items: TreeFile[];
  activePath: string | null;
  onOpen: (path: string) => void;
  onDelete: (path: string) => void;
  emptyHint: string;
}) {
  return (
    <section className={`tree-section${collapsed ? " is-collapsed" : ""}`} data-testid={`tree-${kind}`}>
      <header>
        <button type="button" className="section-toggle" onClick={onToggle} aria-expanded={!collapsed}>
          <span className="chevron" aria-hidden="true" />
          <span className="section-title">{title}</span>
          <span className="section-count">{count}</span>
        </button>
        <button
          type="button"
          className="text-btn icon-label"
          data-testid={`new-${kind}`}
          title={`新建${title}`}
          onClick={onAction}
        >
          <PlusIcon className="ui-icon" aria-hidden="true" />
          新建
        </button>
      </header>
      {!collapsed && (
        <ul>
          {items.length === 0 && <li className="empty">{emptyHint}</li>}
          {items.map((item) => (
            <li key={item.path} className={item.path === activePath ? "active" : ""}>
              <button
                type="button"
                className="file-btn"
                data-testid={`file-${slugFromPath(item.path)}`}
                title={item.title || prettyName(item.path)}
                onClick={() => onOpen(item.path)}
              >
                {item.title || prettyName(item.path)}
              </button>
              <button
                type="button"
                className="icon-btn"
                data-testid={`delete-${slugFromPath(item.path)}`}
                title="删除"
                aria-label={`删除 ${item.title || prettyName(item.path)}`}
                onClick={() => onDelete(item.path)}
              >
                <TrashIcon className="ui-icon" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
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

function slugFromPath(path: string): string {
  return prettyName(path).replace(/[^\w\u4e00-\u9fff-]+/g, "-").toLowerCase();
}

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeftIcon, MagnifyingGlassIcon, PlusIcon, TrashIcon } from "@heroicons/react/24/outline";
import { fileKind } from "@open-pages/shared";
import { fileName } from "../lib/vfs";
import type { DocKind } from "./NewDocDialog";
import { StudioBar } from "./StudioBar";

export interface FileEntry {
  path: string;
  title: string;
  updatedAt: number;
  words: number;
}

interface FilesPageProps {
  files: FileEntry[];
  activePath: string | null;
  onOpen: (path: string) => void;
  onCreate: (kind: DocKind) => void;
  onDelete: (path: string) => void;
  onBack: () => void;
}

type Tab = "all" | DocKind;

const KINDS: Array<{ kind: DocKind; label: string; hint: string }> = [
  { kind: "post", label: "文章", hint: "会发布到站点" },
  { kind: "draft", label: "草稿", hint: "只留在本机" },
  { kind: "page", label: "页面", hint: "关于、友链这类独立页" },
];

export function FilesPage({ files, activePath, onOpen, onCreate, onDelete, onBack }: FilesPageProps) {
  const [tab, setTab] = useState<Tab>("all");
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const normalized = query.trim().toLowerCase();

  const sections = useMemo(() => {
    const matches = (entry: FileEntry) =>
      !normalized ||
      entry.title.toLowerCase().includes(normalized) ||
      entry.path.toLowerCase().includes(normalized);
    return KINDS.filter((kind) => tab === "all" || tab === kind.kind).map((kind) => ({
      ...kind,
      items: files
        .filter((entry) => fileKind(entry.path) === kind.kind && matches(entry))
        .sort((a, b) => b.updatedAt - a.updatedAt),
    }));
  }, [files, normalized, tab]);

  const counts = useMemo(() => {
    const byKind = (kind: DocKind) => files.filter((entry) => fileKind(entry.path) === kind).length;
    return { all: files.length, post: byKind("post"), draft: byKind("draft"), page: byKind("page") };
  }, [files]);

  const createKind: DocKind = tab === "all" ? "post" : tab;
  const createLabel = KINDS.find((kind) => kind.kind === createKind)!.label;
  const visible = sections.reduce((total, section) => total + section.items.length, 0);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const typing = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement;
      if (event.key === "Escape" && !typing) onBack();
      if (event.key === "/" && !typing) {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onBack]);

  return (
    <div className="studio studio-files" data-testid="files-page">
      <StudioBar
        title="文件管理"
        actions={
          <button type="button" className="ghost icon-label" data-testid="files-back" onClick={onBack}>
            <ArrowLeftIcon className="ui-icon" aria-hidden="true" />
            返回编辑
          </button>
        }
      />
      <div className="files-body">
        <div className="files-toolbar">
          <div className="files-tabs" role="tablist" aria-label="文件类型">
            <TabButton id="all" label="全部" count={counts.all} tab={tab} onSelect={setTab} />
            {KINDS.map((kind) => (
              <TabButton
                key={kind.kind}
                id={kind.kind}
                label={kind.label}
                count={counts[kind.kind]}
                tab={tab}
                onSelect={setTab}
              />
            ))}
          </div>
          <div className="files-tools">
            <label className="files-search">
              <MagnifyingGlassIcon className="ui-icon" aria-hidden="true" />
              <span className="sr-only">搜索文档</span>
              <input
                ref={searchRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索标题或路径"
                data-testid="files-search"
                onKeyDown={(event) => {
                  const first = sections.flatMap((section) => section.items)[0];
                  if (event.key === "Enter" && first) onOpen(first.path);
                  if (event.key === "Escape") setQuery("");
                }}
              />
            </label>
            <button
              type="button"
              className="primary icon-label"
              data-testid={`new-${createKind}`}
              onClick={() => onCreate(createKind)}
            >
              <PlusIcon className="ui-icon" aria-hidden="true" />
              新建{createLabel}
            </button>
          </div>
        </div>

        {visible === 0 ? (
          <div className="files-blank" data-testid="files-blank">
            <p>{normalized ? `没有匹配“${query.trim()}”的文档` : `还没有${tab === "all" ? "任何文档" : createLabel}`}</p>
            {normalized ? (
              <button type="button" className="ghost" onClick={() => setQuery("")}>
                清空搜索
              </button>
            ) : (
              <button type="button" className="primary icon-label" onClick={() => onCreate(createKind)}>
                <PlusIcon className="ui-icon" aria-hidden="true" />
                新建{createLabel}
              </button>
            )}
          </div>
        ) : (
          sections
            .filter((section) => section.items.length > 0)
            .map((section) => (
              <section className="files-group" key={section.kind} data-testid={`files-group-${section.kind}`}>
                {tab === "all" && (
                  <header>
                    <h2>{section.label}</h2>
                    <span className="section-count">{section.items.length}</span>
                    <p className="hint">{section.hint}</p>
                  </header>
                )}
                <ul>
                  {section.items.map((item) => (
                    <li key={item.path} className={item.path === activePath ? "active" : ""}>
                      <button
                        type="button"
                        className="file-card"
                        data-testid={`file-${slugFromPath(item.path)}`}
                        onClick={() => onOpen(item.path)}
                      >
                        <span className="file-card-text">
                          <strong>
                            {item.title || prettyName(item.path)}
                            {item.path === activePath && <i className="file-card-tag">编辑中</i>}
                          </strong>
                          <em>{item.path}</em>
                        </span>
                        <span className="file-card-meta">
                          {formatUpdated(item.updatedAt)}
                          {item.words > 0 && <i>{item.words} 字</i>}
                        </span>
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
              </section>
            ))
        )}
      </div>
    </div>
  );
}

function TabButton({
  id,
  label,
  count,
  tab,
  onSelect,
}: {
  id: Tab;
  label: string;
  count: number;
  tab: Tab;
  onSelect: (tab: Tab) => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={tab === id}
      className={tab === id ? "files-tab on" : "files-tab"}
      data-testid={`files-tab-${id}`}
      onClick={() => onSelect(id)}
    >
      {label}
      <span className="section-count">{count}</span>
    </button>
  );
}

function formatUpdated(updatedAt: number): string {
  const diff = Date.now() - updatedAt;
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`;
  const date = new Date(updatedAt);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
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

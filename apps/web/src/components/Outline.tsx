import { useEffect, useMemo, useState } from "react";
import { Cog6ToothIcon, FolderIcon } from "@heroicons/react/24/outline";
import { collectHeadings, type OutlineHeading } from "../lib/outline";

interface OutlineProps {
  open: boolean;
  width: number;
  siteTitle: string;
  markdown: string;
  onJump: (heading: OutlineHeading) => void;
  onFiles: () => void;
  onSettings: () => void;
  onResize: (width: number) => void;
  onHide: () => void;
}

const MIN_WIDTH = 200;
const MAX_WIDTH = 480;
const HIDE_THRESHOLD = 120;

/** Past the threshold the drag previews the hidden state instead of squeezing
 *  the panel: a border-box aside cannot render narrower than its padding, so
 *  every width in between leaves a strip sitting on top of the editor. */
function widthFor(clientX: number): number {
  return clientX <= HIDE_THRESHOLD ? 0 : Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, clientX));
}

export function Outline({
  open,
  width,
  siteTitle,
  markdown,
  onJump,
  onFiles,
  onSettings,
  onResize,
  onHide,
}: OutlineProps) {
  const headings = useMemo(() => collectHeadings(markdown), [markdown]);
  const active = useActiveHeading(headings.length);
  const base = headings.reduce((min, heading) => Math.min(min, heading.level), 6);

  const startResize = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const startingWidth = width;
    const { pointerId } = event;
    // The gesture ends at the window's left edge, and a cursor that slips past
    // it stops delivering events to an uncaptured pointer, stranding the panel
    // mid-collapse. Body holds the capture because the handle itself goes away
    // once the drag previews the hidden state.
    const capture = document.body;
    capture.setPointerCapture(pointerId);
    capture.classList.add("resizing-sidebar");

    function move(next: PointerEvent) {
      onResize(widthFor(next.clientX));
    }
    function finish(next: PointerEvent) {
      stop();
      if (next.clientX <= HIDE_THRESHOLD) {
        onResize(startingWidth);
        onHide();
      } else {
        onResize(widthFor(next.clientX));
      }
    }
    function cancel() {
      stop();
      onResize(startingWidth);
    }
    function stop() {
      capture.removeEventListener("pointermove", move);
      capture.removeEventListener("pointerup", finish);
      capture.removeEventListener("pointercancel", cancel);
      capture.removeEventListener("lostpointercapture", cancel);
      capture.classList.remove("resizing-sidebar");
      if (capture.hasPointerCapture(pointerId)) capture.releasePointerCapture(pointerId);
    }

    capture.addEventListener("pointermove", move);
    capture.addEventListener("pointerup", finish);
    capture.addEventListener("pointercancel", cancel);
    capture.addEventListener("lostpointercapture", cancel);
  };

  return (
    <aside className={open ? "sidebar" : "sidebar hidden"} data-testid="sidebar">
      <div className="brand">
        <strong>Open Pages</strong>
        <span data-testid="sidebar-site-title">{siteTitle === "Open Pages" ? "本地站点" : siteTitle}</span>
      </div>

      <div className="outline-head">
        <span className="outline-kicker">大纲</span>
        {headings.length > 0 && <span className="section-count">{headings.length}</span>}
      </div>

      <nav className="sidebar-scroll" data-testid="outline" aria-label="文档大纲">
        {headings.length > 0 && (
          <ul className="outline-list">
            {headings.map((heading) => (
              <li key={`${heading.index}-${heading.line}`}>
                <button
                  type="button"
                  className={`outline-item level-${heading.level}${heading.index === active ? " active" : ""}`}
                  style={{ "--depth": heading.level - base } as React.CSSProperties}
                  data-testid={`outline-item-${heading.index}`}
                  title={heading.text}
                  onClick={() => onJump(heading)}
                >
                  {heading.text}
                </button>
              </li>
            ))}
          </ul>
        )}
      </nav>

      <footer className="sidebar-foot">
        <button type="button" className="ghost icon-label" data-testid="btn-files" onClick={onFiles}>
          <FolderIcon className="ui-icon" aria-hidden="true" />
          文件
        </button>
        <button type="button" className="ghost icon-label" data-testid="btn-settings" onClick={onSettings}>
          <Cog6ToothIcon className="ui-icon" aria-hidden="true" />
          设置
        </button>
      </footer>
      <div
        className="sidebar-resize-handle"
        data-testid="sidebar-resize-handle"
        role="separator"
        tabIndex={0}
        aria-label="调整侧栏宽度；拖到最左侧可隐藏"
        aria-orientation="vertical"
        aria-valuemin={MIN_WIDTH}
        aria-valuemax={MAX_WIDTH}
        aria-valuenow={Math.round(width)}
        onPointerDown={startResize}
        onKeyDown={(event) => {
          if (event.key === "Home") {
            event.preventDefault();
            onHide();
          } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
            event.preventDefault();
            const delta = event.key === "ArrowLeft" ? -16 : 16;
            onResize(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, width + delta)));
          }
        }}
      />
    </aside>
  );
}

/** Tracks which heading the editor is currently scrolled past. */
function useActiveHeading(count: number): number {
  const [active, setActive] = useState(0);

  useEffect(() => {
    const pane = document.querySelector<HTMLElement>('[data-testid="editor-pane"]');
    if (!pane || count === 0) {
      setActive(0);
      return;
    }
    let frame = 0;
    const sync = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const nodes = pane.querySelectorAll<HTMLElement>(
          ".crepe-host h1, .crepe-host h2, .crepe-host h3, .crepe-host h4, .crepe-host h5, .crepe-host h6",
        );
        const line = pane.getBoundingClientRect().top + 48;
        let current = 0;
        nodes.forEach((node, index) => {
          if (node.getBoundingClientRect().top <= line) current = index;
        });
        setActive(current);
      });
    };
    sync();
    pane.addEventListener("scroll", sync, { passive: true });
    return () => {
      pane.removeEventListener("scroll", sync);
      cancelAnimationFrame(frame);
    };
  }, [count]);

  return active;
}

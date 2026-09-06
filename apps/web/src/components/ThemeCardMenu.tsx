import { EllipsisHorizontalIcon, ArrowPathIcon, TrashIcon } from "@heroicons/react/24/outline";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const MENU_MIN_WIDTH = 108;

interface ThemeCardMenuProps {
  themeId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  busy: boolean;
  inUse: boolean;
  onUpdate: () => void;
  onRemove: () => void;
}

/** Overflow menu for installed theme cards: sibling of the pick button so clicks
 *  never nest inside button.theme-pick-card or accidentally call pickTheme. */
export function ThemeCardMenu({
  themeId,
  open,
  onOpenChange,
  busy,
  inUse,
  onUpdate,
  onRemove,
}: ThemeCardMenuProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const firstItemRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  useEffect(() => {
    if (!open) return;

    const place = () => {
      const box = triggerRef.current?.getBoundingClientRect();
      if (!box) return;
      const width = MENU_MIN_WIDTH;
      const left = Math.min(Math.max(8, box.right - width), window.innerWidth - width - 8);
      setPos({ top: box.bottom + 6, left });
    };

    place();
    const frame = window.requestAnimationFrame(() => firstItemRef.current?.focus());
    const onPointer = (event: MouseEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || popRef.current?.contains(target)) return;
      onOpenChange(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onOpenChange(false);
      triggerRef.current?.focus();
    };
    window.addEventListener("mousedown", onPointer);
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", place);
    // Capture scroll so settings-pane-scroll reanchors (or we stay aligned).
    window.addEventListener("scroll", place, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("mousedown", onPointer);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, onOpenChange]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="theme-pick-more"
        data-testid={`theme-menu-${themeId}`}
        aria-label="主题操作"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={busy}
        onClick={() => onOpenChange(!open)}
      >
        <EllipsisHorizontalIcon className="ui-icon" aria-hidden="true" />
      </button>
      {open
        ? createPortal(
            <div
              ref={popRef}
              className="theme-pick-menu"
              role="menu"
              aria-label="主题操作"
              style={{ top: pos.top, left: pos.left, minWidth: MENU_MIN_WIDTH }}
            >
              <button
                ref={firstItemRef}
                type="button"
                role="menuitem"
                className="theme-pick-menu-item"
                disabled={busy}
                data-testid={`theme-update-${themeId}`}
                onClick={() => {
                  onOpenChange(false);
                  onUpdate();
                }}
              >
                <ArrowPathIcon className="ui-icon" aria-hidden="true" />
                更新
              </button>
              <button
                type="button"
                role="menuitem"
                className="theme-pick-menu-item danger"
                title={inUse ? "正在使用的主题不能卸载" : "卸载主题"}
                disabled={inUse || busy}
                data-testid={`theme-remove-${themeId}`}
                onClick={() => {
                  onOpenChange(false);
                  onRemove();
                }}
              >
                <TrashIcon className="ui-icon" aria-hidden="true" />
                卸载
              </button>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

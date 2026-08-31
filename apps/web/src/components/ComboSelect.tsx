import { ChevronDownIcon, MagnifyingGlassIcon } from "@heroicons/react/24/outline";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import type { SiteOption } from "../lib/site-options";

interface ComboSelectProps {
  label: string;
  value: string;
  options: SiteOption[];
  testId: string;
  searchPlaceholder?: string;
  onChange: (value: string) => void;
}

export function ComboSelect({
  label,
  value,
  options,
  testId,
  searchPlaceholder = "搜索…",
  onChange,
}: ComboSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0, maxHeight: 280 });

  const selected = options.find((option) => option.value === value);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return options;
    return options.filter((option) =>
      [option.label, option.value, option.hint].some((part) => part?.toLowerCase().includes(needle)),
    );
  }, [options, query]);

  const place = () => {
    const box = triggerRef.current?.getBoundingClientRect();
    if (!box) return;
    const maxHeight = 280;
    const gap = 6;
    const spaceBelow = window.innerHeight - box.bottom - 12;
    const openUp = spaceBelow < 180 && box.top > spaceBelow;
    const height = Math.min(maxHeight, openUp ? box.top - 12 : spaceBelow);
    setPos({
      top: openUp ? Math.max(8, box.top - height - gap) : box.bottom + gap,
      left: box.left,
      width: box.width,
      maxHeight: height,
    });
  };

  useEffect(() => {
    if (!open) return;
    place();
    setQuery("");
    setActive(Math.max(0, filtered.findIndex((option) => option.value === value)));
    const frame = window.requestAnimationFrame(() => searchRef.current?.focus());
    const onPointer = (event: MouseEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || popRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onScroll = () => place();
    window.addEventListener("mousedown", onPointer);
    window.addEventListener("resize", onScroll);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("mousedown", onPointer);
      window.removeEventListener("resize", onScroll);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  const pick = (next: string) => {
    onChange(next);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const onSearchKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((index) => Math.min(filtered.length - 1, index + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => Math.max(0, index - 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const option = filtered[active];
      if (option) pick(option.value);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    }
  };

  return (
    <div className="combo">
      <span>{label}</span>
      <button
        ref={triggerRef}
        type="button"
        className={open ? "combo-trigger on" : "combo-trigger"}
        data-testid={testId}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((current) => !current)}
      >
        <strong>{(selected?.label ?? value) || "选择…"}</strong>
        {selected?.hint ? <em>{selected.hint}</em> : null}
        <ChevronDownIcon className="ui-icon" aria-hidden="true" />
      </button>
      {open &&
        createPortal(
          <div
            ref={popRef}
            className="combo-pop"
            style={{ top: pos.top, left: pos.left, width: pos.width, maxHeight: pos.maxHeight }}
          >
            <label className="combo-search">
              <MagnifyingGlassIcon className="ui-icon" aria-hidden="true" />
              <input
                ref={searchRef}
                value={query}
                placeholder={searchPlaceholder}
                data-testid={`${testId}-search`}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setActive(0);
                }}
                onKeyDown={onSearchKey}
              />
            </label>
            <ul id={listId} role="listbox" aria-label={label}>
              {filtered.length === 0 && <li className="combo-empty">没有匹配项</li>}
              {filtered.map((option, index) => (
                <li key={option.value}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={option.value === value}
                    className={option.value === value || index === active ? "combo-option on" : "combo-option"}
                    data-testid={`${testId}-${option.value}`}
                    onMouseEnter={() => setActive(index)}
                    onClick={() => pick(option.value)}
                  >
                    <strong>{option.label}</strong>
                    <em>{option.hint ?? option.value}</em>
                  </button>
                </li>
              ))}
            </ul>
          </div>,
          document.body,
        )}
    </div>
  );
}

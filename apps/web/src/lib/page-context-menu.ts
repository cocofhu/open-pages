/** Surfaces where the system cut/copy/paste context menu should still appear. */
const EDITABLE_SURFACE =
  "input, textarea, select, [contenteditable], .cm-editor, .crepe-host";

type Closestable = {
  closest: (selectors: string) => unknown;
  parentElement?: Closestable | null;
};

function asClosestable(target: EventTarget | null): Closestable | null {
  if (!target || typeof target !== "object") return null;
  const node = target as unknown as Closestable & { nodeType?: number };
  if (typeof node.closest === "function") return node;
  // Text nodes from a click target: walk to the parent element.
  if (node.parentElement && typeof node.parentElement.closest === "function") {
    return node.parentElement;
  }
  return null;
}

/**
 * Returns true when the native (browser/WebView) context menu should be allowed.
 * Default policy is hide; only editable surfaces are allowlisted.
 */
export function shouldAllowNativeContextMenu(target: EventTarget | null): boolean {
  const element = asClosestable(target);
  if (!element) return false;
  return Boolean(element.closest(EDITABLE_SURFACE));
}

/** Hide the native page menu unless the event landed on an editable surface. */
export function guardNativeContextMenu(event: {
  target: EventTarget | null;
  preventDefault(): void;
}): void {
  if (!shouldAllowNativeContextMenu(event.target)) {
    event.preventDefault();
  }
}

/**
 * Shared first-screen visibility measurement.
 *
 * Hexo generate succeeding says nothing about whether a theme actually shows
 * anything: a loader its JS never removes, or content parked at opacity 0, both
 * leave a blank frame while every build check passes. Both the standalone theme
 * sweep and the browser e2e suite judge a preview with this one implementation
 * so they cannot drift apart.
 */

export interface Measured {
  visibleChars: number;
  lowContrastChars: number;
  transparentChars: number;
  totalChars: number;
  overlays: string[];
  topAtCenter: string;
  blockers: string[];
}

/**
 * Nothing readable at all is the failure this is built to catch. A short first
 * screen is legitimate: several themes open on a deliberate full-height cover,
 * and in a narrow preview pane responsive themes fold their sidebar into a
 * hamburger, which parks that text at opacity 0 by design.
 *
 * Both numbers are set from a measured sweep of the built-in themes rather than
 * guessed. In the editor's preview pane the thinnest legitimate first screen is
 * Inside at 25 visible characters, and the largest legitimate hidden share is
 * also Inside at 0.66 once its sidebar collapses. Loosen these only against a
 * fresh sweep.
 */
const MIN_VISIBLE_CHARS = 12;
const MAX_HIDDEN_SHARE = 0.85;

export function previewVerdict(report: Measured): string | null {
  if (report.overlays.length) return `overlay ${report.overlays.join(",")}`;
  if (report.totalChars === 0) return "no text on the first screen";
  if (report.visibleChars < MIN_VISIBLE_CHARS) {
    return `only ${report.visibleChars} readable chars on the first screen`;
  }
  const hidden = report.transparentChars + report.lowContrastChars;
  if (hidden > report.totalChars * MAX_HIDDEN_SHARE) {
    return `${hidden}/${report.totalChars} first-screen chars never revealed`;
  }
  return null;
}

export function describeMeasured(report: Measured): string {
  return (
    `visible=${report.visibleChars}/${report.totalChars}` +
    ` transparent=${report.transparentChars}` +
    ` low-contrast=${report.lowContrastChars} top=${report.topAtCenter}`
  );
}

/**
 * Runs inside the page: counts first-screen text that is hit-testable, so text
 * sitting under a loader overlay does not count as visible. Kept as a string
 * because the TypeScript loader rewrites function names, and that rewrite does
 * not survive serialization into the browser.
 */
export const MEASURE_VISIBLE_TEXT = `(() => {
  const blockers = new Set();
  const describe = (el) => {
    if (!el) return "none";
    const id = el.id ? "#" + el.id : "";
    const raw = typeof el.className === "string" ? el.className.trim() : "";
    const cls = raw ? "." + raw.split(/\\s+/).slice(0, 2).join(".") : "";
    return el.tagName.toLowerCase() + id + cls;
  };

  const parseColor = (value) => {
    const match = /rgba?\\(([^)]+)\\)/.exec(value || "");
    if (!match) return null;
    const parts = match[1].split(",").map((piece) => parseFloat(piece.trim()));
    return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
  };
  const luminance = (color) => {
    const channel = (raw) => {
      const v = raw / 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
  };
  const contrast = (a, b) => {
    const high = Math.max(luminance(a), luminance(b));
    const low = Math.min(luminance(a), luminance(b));
    return (high + 0.05) / (low + 0.05);
  };
  // A hero banner whose background image never loads leaves light text on a
  // light fallback, which is invisible even though it passes a hit test.
  const backdropOf = (el) => {
    let node = el;
    while (node) {
      const style = getComputedStyle(node);
      if (style.backgroundImage && style.backgroundImage !== "none") return null;
      const color = parseColor(style.backgroundColor);
      if (color && color.a > 0.1) return color;
      node = node.parentElement;
    }
    return { r: 255, g: 255, b: 255, a: 1 };
  };

  // Themes routinely ship the whole page at opacity 0 and fade it in from JS.
  // elementFromPoint still reports those nodes, so opacity has to be folded in
  // by hand or a fully transparent page looks perfectly visible.
  const effectiveOpacity = (el) => {
    let value = 1;
    let node = el;
    while (node && node !== document.documentElement) {
      const style = getComputedStyle(node);
      if (style.visibility === "hidden" || style.display === "none") return 0;
      const own = parseFloat(style.opacity);
      if (!Number.isNaN(own)) value *= own;
      if (value < 0.05) return value;
      node = node.parentElement;
    }
    return value;
  };

  let visibleChars = 0;
  let lowContrastChars = 0;
  let transparentChars = 0;
  let totalChars = 0;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const counted = new Set();

  while (walker.nextNode()) {
    const node = walker.currentNode;
    const text = (node.textContent || "").trim();
    if (!text) continue;
    const el = node.parentElement;
    if (!el || counted.has(el)) continue;
    counted.add(el);

    // Only the first screen is judged. Scroll-reveal themes deliberately park
    // everything below the fold at opacity 0 until it scrolls into view, so
    // counting the whole document would flag correct behaviour as blank.
    const rect = el.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) continue;
    if (rect.bottom <= 0 || rect.top >= window.innerHeight) continue;
    if (rect.right <= 0 || rect.left >= window.innerWidth) continue;
    totalChars += text.length;

    if (effectiveOpacity(el) < 0.05) {
      transparentChars += text.length;
      blockers.add("transparent:" + describe(el));
      continue;
    }

    const x = Math.min(Math.max(rect.left + rect.width / 2, 1), window.innerWidth - 1);
    const y = Math.min(Math.max(rect.top + rect.height / 2, 1), window.innerHeight - 1);
    const hit = document.elementFromPoint(x, y);
    if (!hit || !(hit === el || el.contains(hit) || hit.contains(el))) {
      if (hit) blockers.add(describe(hit));
      continue;
    }

    const style = getComputedStyle(el);
    const ink = parseColor(style.color);
    const backdrop = backdropOf(el);
    if (ink && ink.a <= 0.1) {
      lowContrastChars += text.length;
      continue;
    }
    if (ink && backdrop && contrast(ink, backdrop) < 1.5) {
      lowContrastChars += text.length;
      blockers.add("low-contrast:" + describe(el));
      continue;
    }
    visibleChars += text.length;
  }

  const center = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2);

  // A theme whose landing page is a full-screen cover is fine; a theme stuck
  // behind a loader its JS never removes is not. Both leave little text on the
  // first screen, so the distinguishing trait is a fixed, opaque element that
  // sits on top of the page while carrying almost none of its text.
  const pageTextLength = (document.body.innerText || "").trim().length;
  const overlays = [];
  for (const el of document.querySelectorAll("body *")) {
    const style = getComputedStyle(el);
    if (style.position !== "fixed") continue;
    if (style.display === "none" || style.visibility === "hidden") continue;
    if (parseFloat(style.opacity) < 0.05) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width * rect.height < window.innerWidth * window.innerHeight * 0.5) continue;
    const backdrop = parseColor(style.backgroundColor);
    if (!backdrop || backdrop.a < 0.5) continue;
    if (!center || !(el === center || el.contains(center))) continue;
    const ownText = (el.innerText || "").trim().length;
    if (pageTextLength > 0 && ownText > pageTextLength * 0.2) continue;
    overlays.push(describe(el) + "@z" + style.zIndex);
  }

  return {
    visibleChars,
    lowContrastChars,
    transparentChars,
    totalChars,
    overlays: overlays.slice(0, 3),
    topAtCenter: describe(center),
    blockers: Array.from(blockers).slice(0, 4),
  };
})()`;

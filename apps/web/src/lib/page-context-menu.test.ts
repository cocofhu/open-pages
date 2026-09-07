import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { guardNativeContextMenu, shouldAllowNativeContextMenu } from "./page-context-menu";

/** Minimal Element stub that walks parents with a CSS-ish closest for our allowlist. */
function el(
  tag: string,
  opts: { className?: string; attrs?: Record<string, string>; parent?: Element | null } = {},
): Element {
  const node = {
    tagName: tag.toUpperCase(),
    classList: {
      contains: (name: string) => (opts.className ?? "").split(/\s+/).includes(name),
    },
    getAttribute: (name: string) => opts.attrs?.[name] ?? null,
    hasAttribute: (name: string) => Boolean(opts.attrs && name in opts.attrs),
    parentElement: opts.parent ?? null,
    closest(this: Element, selector: string): Element | null {
      let cur: Element | null = this;
      while (cur) {
        if (matchesAllowlist(cur, selector)) return cur;
        cur = (cur as { parentElement: Element | null }).parentElement;
      }
      return null;
    },
  };
  return node as unknown as Element;
}

function matchesAllowlist(node: Element, selector: string): boolean {
  const parts = selector.split(",").map((part) => part.trim());
  return parts.some((part) => {
    if (part.startsWith(".")) {
      return (node as unknown as { classList: { contains(n: string): boolean } }).classList.contains(
        part.slice(1),
      );
    }
    if (part.startsWith("[")) {
      const name = part.slice(1, -1);
      return (node as unknown as { hasAttribute(n: string): boolean }).hasAttribute(name);
    }
    return (node as unknown as { tagName: string }).tagName === part.toUpperCase();
  });
}

describe("shouldAllowNativeContextMenu", () => {
  it("denies null targets", () => {
    assert.equal(shouldAllowNativeContextMenu(null), false);
  });

  it("denies shell chrome outside editable surfaces", () => {
    const shell = el("div");
    const button = el("button", { parent: shell });
    assert.equal(shouldAllowNativeContextMenu(button), false);
  });

  it("allows input, textarea, select, and contenteditable", () => {
    assert.equal(shouldAllowNativeContextMenu(el("input")), true);
    assert.equal(shouldAllowNativeContextMenu(el("textarea")), true);
    assert.equal(shouldAllowNativeContextMenu(el("select")), true);
    assert.equal(
      shouldAllowNativeContextMenu(el("div", { attrs: { contenteditable: "true" } })),
      true,
    );
  });

  it("allows descendants of .crepe-host and .cm-editor", () => {
    const crepe = el("div", { className: "crepe-host" });
    const paragraph = el("p", { parent: crepe });
    assert.equal(shouldAllowNativeContextMenu(paragraph), true);

    const cm = el("div", { className: "cm-editor" });
    const content = el("div", { className: "cm-content", parent: cm });
    assert.equal(shouldAllowNativeContextMenu(content), true);
  });
});

describe("guardNativeContextMenu", () => {
  it("prevents default outside editable surfaces", () => {
    let prevented = false;
    guardNativeContextMenu({
      target: el("button"),
      preventDefault: () => {
        prevented = true;
      },
    });
    assert.equal(prevented, true);
  });

  it("does not prevent default on editable surfaces", () => {
    let prevented = false;
    guardNativeContextMenu({
      target: el("input"),
      preventDefault: () => {
        prevented = true;
      },
    });
    assert.equal(prevented, false);
  });
});

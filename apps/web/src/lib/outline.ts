export interface OutlineHeading {
  index: number;
  level: number;
  text: string;
  line: number;
  offset: number;
}

const ATX = /^(#{1,6})[ \t]+(.*?)[ \t]*#*[ \t]*$/;
const FENCE = /^\s{0,3}(`{3,}|~{3,})/;

export function collectHeadings(markdown: string): OutlineHeading[] {
  const headings: OutlineHeading[] = [];
  let fence: string | null = null;
  let offset = 0;

  for (const [line, raw] of markdown.split("\n").entries()) {
    const fenced = FENCE.exec(raw);
    if (fenced) {
      const marker = fenced[1][0];
      fence = fence === null ? marker : fence === marker ? null : fence;
    } else if (fence === null) {
      const match = ATX.exec(raw);
      const text = match ? plainText(match[2]) : "";
      if (match && text) {
        headings.push({ index: headings.length, level: match[1].length, text, line, offset });
      }
    }
    offset += raw.length + 1;
  }

  return headings;
}

/** Same headings as `collectHeadings(body)`, but positioned against the raw file including front matter. */
export function collectSourceHeadings(source: string): OutlineHeading[] {
  const matter = source.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/)?.[0] ?? "";
  const lines = matter ? matter.split("\n").length - 1 : 0;
  return collectHeadings(source.slice(matter.length)).map((heading) => ({
    ...heading,
    line: heading.line + lines,
    offset: heading.offset + matter.length,
  }));
}

function plainText(raw: string): string {
  return raw
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/([*_~]{1,3})(\S[\s\S]*?\S|\S)\1/g, "$2")
    .replace(/<[^>]+>/g, "")
    .trim();
}

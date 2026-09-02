import MarkdownIt from "markdown-it";
import texmath from "markdown-it-texmath";
import katex from "katex";
import "katex/dist/katex.min.css";

const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
});
md.use(texmath, {
  engine: katex,
  delimiters: "dollars",
  katexOptions: { throwOnError: false, strict: false },
});

export function renderMarkdownPreview(body: string): string {
  return md.render(body.trim() ? body : "\n");
}

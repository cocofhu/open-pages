import MarkdownIt from "markdown-it";

const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
});

export function renderMarkdownPreview(body: string): string {
  return md.render(body.trim() ? body : "\n");
}

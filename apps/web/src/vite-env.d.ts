/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

declare module "markdown-it-texmath" {
  import type MarkdownIt from "markdown-it";
  import type katex from "katex";

  interface TexmathOptions {
    engine: typeof katex;
    delimiters?: "dollars" | "brackets" | "gitlab" | "julia" | "kramdown";
    katexOptions?: Record<string, unknown>;
  }

  const texmath: MarkdownIt.PluginWithOptions<TexmathOptions>;
  export default texmath;
}

import mermaid from "mermaid";

let initialized = false;
let diagramId = 0;
function ensureInitialized(): void {
  if (initialized) return;
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: "neutral",
  });
  initialized = true;
}

export async function renderMermaidElement(element: HTMLElement): Promise<void> {
  ensureInitialized();
  element.classList.add("mermaid");
  await mermaid.run({ nodes: [element] });
}

export async function renderMermaidDiagram(source: string): Promise<HTMLElement> {
  ensureInitialized();
  const { svg } = await mermaid.render(`open-pages-mermaid-${++diagramId}`, source);
  const diagram = document.createElement("div");
  diagram.className = "mermaid-diagram";
  diagram.setAttribute("role", "img");
  diagram.setAttribute("aria-label", "Mermaid diagram");
  diagram.innerHTML = svg;
  return diagram;
}

export async function renderMermaidBlocks(root: HTMLElement): Promise<void> {
  const blocks = [...root.querySelectorAll<HTMLElement>("pre > code.language-mermaid")];
  await Promise.all(
    blocks.map(async (code) => {
      const pre = code.parentElement;
      if (!pre) return;
      const diagram = document.createElement("div");
      diagram.className = "mermaid-diagram";
      diagram.setAttribute("role", "img");
      diagram.setAttribute("aria-label", "Mermaid diagram");
      diagram.textContent = code.textContent ?? "";
      pre.replaceWith(diagram);
      try {
        await renderMermaidElement(diagram);
      } catch (error) {
        // Keep the source visible when a diagram is incomplete or invalid.
        diagram.classList.add("mermaid-error");
        diagram.title = error instanceof Error ? error.message : "Mermaid render failed";
        console.warn("Mermaid render failed", error);
      }
    }),
  );
}

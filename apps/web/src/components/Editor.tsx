import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { syntaxHighlighting, defaultHighlightStyle } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { EditorState } from "@codemirror/state";
import {
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import { useEffect, useImperativeHandle, useMemo, useRef, useState, forwardRef } from "react";
import { Crepe } from "@milkdown/crepe";
import "@milkdown/crepe/theme/common/style.css";
import "@milkdown/crepe/theme/frame.css";
import { parseFrontMatter } from "@open-pages/shared";
import { ViewColumnsIcon, DocumentTextIcon } from "@heroicons/react/24/outline";
import { collectSourceHeadings, type OutlineHeading } from "../lib/outline";
import { renderMarkdownPreview } from "../lib/markdown-preview";
import { renderMermaidBlocks, renderMermaidDiagram } from "../lib/mermaid";

interface EditorProps {
  value: string;
  onChange: (markdown: string) => void;
  onUploadImage: (file: File) => Promise<string>;
  resolveImageUrl: (url: string) => Promise<string> | string;
}

export function MarkdownEditor({ value, onChange, onUploadImage, resolveImageUrl }: EditorProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const onChangeRef = useRef(onChange);
  const onUploadImageRef = useRef(onUploadImage);
  const resolveImageUrlRef = useRef(resolveImageUrl);
  onChangeRef.current = onChange;
  onUploadImageRef.current = onUploadImage;
  resolveImageUrlRef.current = resolveImageUrl;

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let cancelled = false;
    const crepe = new Crepe({
      root,
      defaultValue: value || "",
      featureConfigs: {
        [Crepe.Feature.Placeholder]: {
          text: "开始写作…",
          mode: "block",
        },
        [Crepe.Feature.ImageBlock]: {
          onUpload: (file) => onUploadImageRef.current(file),
          proxyDomURL: (url) => resolveImageUrlRef.current(url),
          inlineUploadButton: "上传",
          blockUploadButton: "上传",
          inlineUploadPlaceholderText: "或粘贴链接",
          blockUploadPlaceholderText: "或粘贴链接",
          blockCaptionPlaceholderText: "图片说明",
        },
        [Crepe.Feature.CodeMirror]: {
          renderPreview: (language, content, applyPreview) => {
            if (language.toLowerCase() !== "mermaid") return null;
            void renderMermaidDiagram(content)
              .then(applyPreview)
              .catch(() => {
                const error = document.createElement("div");
                error.className = "mermaid-error";
                error.textContent = "Mermaid 图表语法有误";
                applyPreview(error);
              });
            return undefined;
          },
          previewOnlyByDefault: true,
        },
      },
    });

    crepe.on((listener) => {
      listener.markdownUpdated((_ctx, markdown) => {
        if (!cancelled) onChangeRef.current(markdown);
      });
    });

    void crepe.create();
    return () => {
      cancelled = true;
      void crepe.destroy();
      root.innerHTML = "";
    };
    // Remount when parent changes `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={rootRef} className="crepe-host" data-testid="wysiwyg-editor" />;
}

const SOURCE_SPLIT_KEY = "open-pages-source-split";

const sourceEditorTheme = EditorView.theme(
  {
    "&": {
      height: "100%",
      backgroundColor: "#fffdf8",
    },
    ".cm-scroller": {
      fontFamily: 'var(--mono, "IBM Plex Mono", ui-monospace, monospace)',
    },
    ".cm-content": {
      padding: "18px 0 32px",
      caretColor: "#1c1915",
    },
    ".cm-line": {
      padding: "0 18px 0 22px",
    },
    ".cm-gutters": {
      backgroundColor: "#f5f0e8",
      borderRight: "1px solid #d8cebf",
      color: "#6d6558",
    },
    ".cm-activeLineGutter": {
      backgroundColor: "#efe8dc",
    },
    ".cm-activeLine": {
      backgroundColor: "rgb(28 25 21 / 4%)",
    },
    "&.cm-focused .cm-cursor": {
      borderLeftColor: "#c45c26",
    },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
      backgroundColor: "rgb(196 92 38 / 18%) !important",
    },
  },
  { dark: false },
);

export interface SourceEditorHandle {
  jumpToHeading: (heading: OutlineHeading) => void;
}

export const SourceEditor = forwardRef<
  SourceEditorHandle,
  {
    value: string;
    onChange: (markdown: string) => void;
  }
>(function SourceEditor({ value, onChange }, ref) {
  const hostRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const valueRef = useRef(value);
  onChangeRef.current = onChange;
  valueRef.current = value;

  const [split, setSplit] = useState(() => {
    try {
      return localStorage.getItem(SOURCE_SPLIT_KEY) !== "false";
    } catch {
      return true;
    }
  });

  useImperativeHandle(ref, () => ({
    jumpToHeading(heading: OutlineHeading) {
      const view = viewRef.current;
      if (!view) return;
      const target = collectSourceHeadings(view.state.doc.toString())[heading.index];
      if (!target) return;
      view.dispatch({
        selection: { anchor: target.offset },
        effects: EditorView.scrollIntoView(target.offset, { y: "start", yMargin: 28 }),
      });
      view.focus();
    },
  }));

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        onChangeRef.current(update.state.doc.toString());
      }
    });

    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: valueRef.current,
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightActiveLine(),
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          markdown({ base: markdownLanguage, codeLanguages: languages }),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          EditorView.lineWrapping,
          sourceEditorTheme,
          updateListener,
        ],
      }),
    });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (value !== current) {
      view.dispatch({
        changes: { from: 0, to: current.length, insert: value },
      });
    }
  }, [value]);

  const previewHtml = useMemo(() => {
    const { body } = parseFrontMatter(value);
    return renderMarkdownPreview(body);
  }, [value]);

  useEffect(() => {
    const preview = previewRef.current;
    if (!split || !preview) return;
    // CodeMirror can emit several updates for one paste. Wait until React has
    // committed the last HTML snapshot so Mermaid never renders into a node a
    // newer commit has already detached.
    const timer = window.setTimeout(() => {
      void renderMermaidBlocks(preview);
    }, 120);
    return () => window.clearTimeout(timer);
  }, [previewHtml, split]);

  const setSplitMode = (next: boolean) => {
    setSplit(next);
    try {
      localStorage.setItem(SOURCE_SPLIT_KEY, String(next));
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="source-shell" data-testid="source-editor">
      <div className="source-toolbar">
        <span className="source-toolbar-label">Markdown 源码</span>
        <div className="source-toolbar-actions" role="group" aria-label="源码布局">
          <button
            type="button"
            className={split ? "ghost icon-label" : "on icon-label"}
            data-testid="source-layout-single"
            aria-pressed={!split}
            onClick={() => setSplitMode(false)}
          >
            <DocumentTextIcon className="ui-icon" aria-hidden="true" />
            单栏
          </button>
          <button
            type="button"
            className={split ? "on icon-label" : "ghost icon-label"}
            data-testid="source-layout-split"
            aria-pressed={split}
            onClick={() => setSplitMode(true)}
          >
            <ViewColumnsIcon className="ui-icon" aria-hidden="true" />
            分栏
          </button>
        </div>
      </div>
      <div className={`source-layout ${split ? "split" : "single"}`}>
        <div className="source-pane">
          <div ref={hostRef} className="source-cm-host" data-testid="source-cm-host" />
        </div>
        {split ? (
          <div className="source-preview-wrap" data-testid="source-preview">
            <p className="source-preview-kicker">实时预览</p>
            <div
              ref={previewRef}
              className="source-preview"
              dangerouslySetInnerHTML={{ __html: previewHtml }}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
});

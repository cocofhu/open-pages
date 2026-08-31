import { useEffect, useRef } from "react";
import { Crepe } from "@milkdown/crepe";
import "@milkdown/crepe/theme/common/style.css";
import "@milkdown/crepe/theme/frame.css";

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

export function SourceEditor({
  value,
  onChange,
}: {
  value: string;
  onChange: (markdown: string) => void;
}) {
  return (
    <textarea
      className="source-editor"
      data-testid="source-editor"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      spellCheck={false}
    />
  );
}

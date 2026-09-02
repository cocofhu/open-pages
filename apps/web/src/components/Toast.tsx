import { useEffect, useState } from "react";
import {
  ArrowTopRightOnSquareIcon,
  CheckIcon,
  ClipboardDocumentIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";

export interface ToastState {
  kind: "info" | "ok" | "error";
  text: string;
  copyText?: string;
  suffix?: string;
  href?: string;
  linkText?: string;
  sticky?: boolean;
}

export function Toast({ toast, onDismiss }: { toast: ToastState | null; onDismiss: () => void }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setCopied(false);
  }, [toast?.copyText]);

  if (!toast) return null;

  const copy = async () => {
    if (!toast.copyText) return;
    const ok = await writeClipboard(toast.copyText);
    if (!ok) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className={`toast ${toast.kind}`} data-testid="toast" role="status">
      <span className="toast-message">
        {toast.text}
        {toast.copyText ? (
          <>
            {" "}
            <code className="toast-code" data-testid="toast-code">
              {toast.copyText}
            </code>
            <button
              type="button"
              className="ghost toast-copy"
              data-testid="toast-copy"
              aria-label={copied ? "已复制" : "复制验证码"}
              title={copied ? "已复制" : "复制验证码"}
              onClick={() => void copy()}
            >
              {copied ? (
                <CheckIcon className="ui-icon" aria-hidden="true" />
              ) : (
                <ClipboardDocumentIcon className="ui-icon" aria-hidden="true" />
              )}
            </button>
          </>
        ) : null}
        {toast.suffix ? ` ${toast.suffix}` : null}
      </span>
      {toast.href && (
        <a href={toast.href} target="_blank" rel="noreferrer" data-testid="toast-link" className="icon-label">
          <ArrowTopRightOnSquareIcon className="ui-icon" aria-hidden="true" />
          {toast.linkText ?? "打开预览"}
        </a>
      )}
      <button type="button" className="ghost toast-close" onClick={onDismiss} aria-label="关闭">
        <XMarkIcon className="ui-icon" aria-hidden="true" />
      </button>
    </div>
  );
}

async function writeClipboard(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    const area = document.createElement("textarea");
    area.value = value;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.left = "-9999px";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  }
}

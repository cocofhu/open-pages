import {
  Bars3CenterLeftIcon,
  CodeBracketIcon,
  EyeIcon,
  FolderIcon,
  PencilSquareIcon,
  RocketLaunchIcon,
} from "@heroicons/react/24/outline";
import type { AuthUser } from "../lib/api";
import { isTauri } from "../lib/platform";
import { AccountMenu } from "./AccountMenu";
import { GitHubMark } from "./GitHubMark";

export type EditorMode = "wysiwyg" | "source";

interface TopBarProps {
  mode: EditorMode;
  previewing: boolean;
  online: boolean;
  user: AuthUser | null;
  sidebarOpen: boolean;
  onMode: (mode: EditorMode) => void;
  onPreview: () => void;
  onToggleSidebar: () => void;
  onFiles: () => void;
  onPublish: () => void;
  onLogin: () => void;
  onLogout: () => void;
}

export function TopBar({
  mode,
  previewing,
  online,
  user,
  sidebarOpen,
  onMode,
  onPreview,
  onToggleSidebar,
  onFiles,
  onPublish,
  onLogin,
  onLogout,
}: TopBarProps) {
  return (
    <header className="topbar">
      <div className="top-left">
        {!sidebarOpen && (
          <button type="button" className="ghost icon-label" data-testid="btn-sidebar" onClick={onToggleSidebar}>
            <Bars3CenterLeftIcon className="ui-icon" aria-hidden="true" />
            大纲
          </button>
        )}
        <button type="button" className="ghost icon-label" data-testid="btn-files-top" onClick={onFiles}>
          <FolderIcon className="ui-icon" aria-hidden="true" />
          文件
        </button>
        <div className="seg" role="tablist" aria-label="编辑模式">
          <button
            type="button"
            role="tab"
            data-testid="btn-write"
            aria-selected={mode === "wysiwyg"}
            className={mode === "wysiwyg" ? "on icon-label" : "icon-label"}
            onClick={() => onMode("wysiwyg")}
          >
            <PencilSquareIcon className="ui-icon" aria-hidden="true" />
            写作
          </button>
          <button
            type="button"
            role="tab"
            data-testid="btn-source"
            aria-selected={mode === "source"}
            className={mode === "source" ? "on icon-label" : "icon-label"}
            onClick={() => onMode("source")}
          >
            <CodeBracketIcon className="ui-icon" aria-hidden="true" />
            源码
          </button>
        </div>
      </div>
      <div className="top-actions">
        <button
          type="button"
          className="ghost icon-label"
          data-testid="btn-preview"
          disabled={previewing || (!online && !isTauri())}
          title={online || isTauri() ? "用 Hexo 渲染并在应用内打开" : "预览需要联网"}
          onClick={onPreview}
        >
          <EyeIcon className="ui-icon" aria-hidden="true" />
          {previewing ? "生成中…" : "预览"}
        </button>
        {user?.login ? (
          <AccountMenu user={{ ...user, login: user.login }} onLogout={onLogout} />
        ) : (
          <button
            type="button"
            className="ghost icon-label"
            data-testid="btn-login"
            onClick={onLogin}
            disabled={user !== null && !user.githubEnabled}
            title={user && !user.githubEnabled ? "在 apps/api/.env 配置 GitHub OAuth" : "使用 GitHub 登录"}
          >
            <GitHubMark className="ui-icon" />
            GitHub
          </button>
        )}
        <button type="button" className="primary icon-label" data-testid="btn-publish" onClick={onPublish}>
          <RocketLaunchIcon className="ui-icon" aria-hidden="true" />
          发布
        </button>
      </div>
    </header>
  );
}

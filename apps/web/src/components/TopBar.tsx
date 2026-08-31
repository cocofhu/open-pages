import type { AuthUser } from "../lib/api";

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
  onPublish,
  onLogin,
  onLogout,
}: TopBarProps) {
  return (
    <header className="topbar">
      <div className="top-left">
        {!sidebarOpen && (
          <button type="button" className="ghost" data-testid="btn-sidebar" onClick={onToggleSidebar}>
            目录
          </button>
        )}
        <div className="seg" role="tablist" aria-label="编辑模式">
          <button
            type="button"
            role="tab"
            data-testid="btn-write"
            aria-selected={mode === "wysiwyg"}
            className={mode === "wysiwyg" ? "on" : ""}
            onClick={() => onMode("wysiwyg")}
          >
            写作
          </button>
          <button
            type="button"
            role="tab"
            data-testid="btn-source"
            aria-selected={mode === "source"}
            className={mode === "source" ? "on" : ""}
            onClick={() => onMode("source")}
          >
            源码
          </button>
        </div>
      </div>
      <div className="top-actions">
        <button
          type="button"
          className="ghost"
          data-testid="btn-preview"
          disabled={previewing || !online}
          title={online ? "用 Hexo 渲染并在新标签打开" : "预览需要联网"}
          onClick={onPreview}
        >
          {previewing ? "生成中…" : "预览"}
        </button>
        {user?.login ? (
          <button type="button" className="ghost account" data-testid="btn-logout" onClick={onLogout} title={user.login}>
            {user.avatarUrl && <img className="avatar" src={user.avatarUrl} alt="" />}
            <span className="login" data-testid="user-login">
              {user.login}
            </span>
          </button>
        ) : (
          <button
            type="button"
            className="ghost"
            data-testid="btn-login"
            onClick={onLogin}
            disabled={user !== null && !user.githubEnabled}
            title={user && !user.githubEnabled ? "在 apps/api/.env 配置 GitHub OAuth" : "使用 GitHub 登录"}
          >
            GitHub
          </button>
        )}
        <button type="button" className="primary" data-testid="btn-publish" onClick={onPublish}>
          发布
        </button>
      </div>
    </header>
  );
}

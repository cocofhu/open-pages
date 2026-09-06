import {
  ArrowLeftIcon,
  ArrowPathIcon,
  ArrowTopRightOnSquareIcon,
  CheckCircleIcon,
  EyeIcon,
  GlobeAltIcon,
  RocketLaunchIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import { useEffect, useState } from "react";
import {
  publishUrlAndRoot,
  THEME_META,
  type PublishRepoCheck,
  type ThemeId,
} from "@open-pages/shared";
import { type AuthUser } from "../lib/api";
import { isTauri, platform } from "../lib/platform";
import { GitHubMark } from "./GitHubMark";
import { StudioBar } from "./StudioBar";

interface PublishPageProps {
  user: AuthUser | null;
  siteId: string;
  theme: ThemeId;
  /** Bound GitHub owner from local GithubBinding (read-only target). */
  boundOwner?: string;
  /** Bound GitHub repo from local GithubBinding (read-only target). */
  boundRepo?: string;
  /** Optional custom domain hostname from settings (display only). */
  customDomain?: string;
  busy: boolean;
  previewing: boolean;
  online: boolean;
  status: string;
  resultUrl: string | null;
  onBack: () => void;
  onClose: () => void;
  onLogin: () => void;
  onSessionStale: () => void;
  onPreview: () => void;
  onPublish: () => void;
}

export function PublishPage({
  user,
  siteId,
  theme,
  boundOwner,
  boundRepo,
  customDomain,
  busy,
  previewing,
  online,
  status,
  resultUrl,
  onBack,
  onClose,
  onLogin,
  onSessionStale,
  onPreview,
  onPublish,
}: PublishPageProps) {
  const [error, setError] = useState<string | null>(null);
  const [repoCheck, setRepoCheck] = useState<PublishRepoCheck | null>(null);
  const [repoChecking, setRepoChecking] = useState(false);

  const owner = boundOwner?.trim() ?? "";
  const repo = boundRepo?.trim() ?? "";
  const bound = Boolean(user?.login && owner && repo);
  const fullName = bound ? `${owner}/${repo}` : "";

  useEffect(() => {
    if (!user?.login || !bound) {
      setRepoCheck(null);
      setRepoChecking(false);
      setError(null);
      return;
    }

    setError(null);
    setRepoChecking(true);
    setRepoCheck(null);
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          setRepoCheck(await platform.checkRepoForPublish(owner, repo, siteId));
        } catch (err) {
          setRepoCheck({
            eligible: false,
            reason: "foreign",
            message: err instanceof Error ? err.message : "检查失败",
          });
          // Header may still look logged-in while the session underneath is stale.
          onSessionStale();
        } finally {
          setRepoChecking(false);
        }
      })();
    }, 250);

    return () => window.clearTimeout(timer);
  }, [bound, owner, repo, siteId, user?.login, onSessionStale]);

  const site = bound
    ? `${publishUrlAndRoot(owner, repo, customDomain).url.replace(/\/$/, "")}/`
    : "";
  const themeLabel = THEME_META[theme]?.label ?? theme;
  const canPublish = bound && !repoChecking && Boolean(repoCheck?.eligible);
  const showPublishFeedback = busy || Boolean(status) || Boolean(resultUrl);

  return (
    <div className="studio studio-github" data-testid="publish-page">
      <StudioBar
        title="发布到 GitHub Pages"
        actions={
          <>
            <button type="button" className="ghost icon-label" data-testid="publish-back" onClick={onBack}>
              <ArrowLeftIcon className="ui-icon" aria-hidden="true" />
              返回编辑
            </button>
            <button type="button" className="ghost icon-label" onClick={onClose}>
              <XMarkIcon className="ui-icon" aria-hidden="true" />
              取消
            </button>
          </>
        }
      />
      <div className="publish-body">
        <div className="publish-card" data-testid="dialog-publish">
          <header className="publish-hero">
            <p className="publish-kicker">GitHub Pages</p>
            <h2>发布站点</h2>
            <p className="hint">
              将用主题 <span className="publish-theme-pill">{themeLabel}</span>{" "}
              生成静态网站并推送到已绑定的 GitHub 仓库。主题可在站点设置里更换。
            </p>
          </header>

          {!user?.login ? (
            <section className="publish-login">
              <div className="publish-login-mark" aria-hidden="true">
                <GitHubMark className="publish-login-icon" />
              </div>
              <h3>连接 GitHub</h3>
              <p className="hint">登录后即可发布到当前站点已绑定的仓库。</p>
              <button type="button" className="primary icon-label" data-testid="publish-login" onClick={onLogin}>
                <GitHubMark className="ui-icon" />
                登录 GitHub
              </button>
            </section>
          ) : (
            <>
              <div className="publish-account">
                {user.avatarUrl ? (
                  <img className="publish-account-avatar" src={user.avatarUrl} alt="" />
                ) : (
                  <span className="publish-account-avatar publish-account-avatar-fallback" aria-hidden="true">
                    <GitHubMark className="ui-icon" />
                  </span>
                )}
                <div className="publish-account-text">
                  <strong>@{user.login}</strong>
                  <span className="hint">
                    {bound ? "已连接，发布到绑定仓库" : "已连接，但当前站点尚未绑定仓库"}
                  </span>
                </div>
              </div>

              <section className="studio-set-group publish-repo-group">
                <h3>目标仓库</h3>

                {bound ? (
                  <>
                    <p className="publish-bound-repo" data-testid="publish-bound-repo">
                      @{fullName}
                    </p>
                    <p className="hint">
                      发布只会推到这个已绑定的仓库。要换仓库请到设置里操作。
                    </p>

                    <div
                      className={
                        repoChecking
                          ? "publish-repo-check checking"
                          : repoCheck?.eligible
                            ? "publish-repo-check ok"
                            : repoCheck
                              ? "publish-repo-check error"
                              : "publish-repo-check"
                      }
                      data-testid="publish-repo-check"
                      aria-live="polite"
                      aria-busy={repoChecking}
                    >
                      {repoChecking ? (
                        <>
                          <div className="publish-repo-check-head">
                            <ArrowPathIcon className="ui-icon publish-repo-spinner" aria-hidden="true" />
                            <strong>正在检查仓库…</strong>
                          </div>
                          <div className="addon-progress" aria-hidden="true">
                            <div className="addon-progress-track">
                              <i />
                            </div>
                          </div>
                          <p className="hint">确认这个仓库可以安全发布，避免覆盖其他项目…</p>
                        </>
                      ) : repoCheck ? (
                        <>
                          <strong>{repoCheck.eligible ? "可以发布" : "无法发布"}</strong>
                          <p className="hint">{repoCheck.message}</p>
                        </>
                      ) : null}
                    </div>
                  </>
                ) : (
                  <div className="publish-unbound" data-testid="publish-unbound">
                    <p className="hint">
                      当前站点还没有绑定 GitHub 仓库。请先在引导页或设置里完成绑定，再回来发布。发布页不能选择或新建仓库。
                    </p>
                  </div>
                )}
              </section>

              {showPublishFeedback && site ? (
                <div className={resultUrl ? "publish-url published" : "publish-url"}>
                  {resultUrl ? (
                    <CheckCircleIcon className="ui-icon" aria-hidden="true" />
                  ) : (
                    <GlobeAltIcon className="ui-icon" aria-hidden="true" />
                  )}
                  <div className="publish-url-text">
                    <span className="publish-url-label">{resultUrl ? "发布成功" : "发布后访问"}</span>
                    <a href={resultUrl ?? site} target="_blank" rel="noreferrer">
                      {resultUrl ?? site}
                      <ArrowTopRightOnSquareIcon className="ui-icon" aria-hidden="true" />
                    </a>
                  </div>
                </div>
              ) : null}

              {error ? <p className="publish-message error">{error}</p> : null}
              {showPublishFeedback && status && (busy || !resultUrl) ? (
                <div className="publish-status" aria-live="polite">
                  {busy ? (
                    <div className="addon-progress">
                      <div className="addon-progress-track">
                        <i />
                      </div>
                    </div>
                  ) : null}
                  <p className="hint">{status}</p>
                </div>
              ) : null}
              <footer className="publish-foot">
                <button
                  type="button"
                  className="ghost icon-label"
                  data-testid="publish-preview"
                  disabled={busy || previewing || !canPublish || (!online && !isTauri())}
                  title={
                    online || isTauri()
                      ? "按 GitHub Pages 路径预览，在应用内打开"
                      : "预览需要联网"
                  }
                  onClick={onPreview}
                >
                  <EyeIcon className="ui-icon" aria-hidden="true" />
                  {previewing ? "生成中…" : "预览"}
                </button>
                <button
                  type="button"
                  className="primary icon-label"
                  disabled={busy || previewing || !canPublish}
                  data-testid="publish-submit"
                  onClick={onPublish}
                >
                  <RocketLaunchIcon className="ui-icon" aria-hidden="true" />
                  {busy ? "发布中…" : "Hexo 发布"}
                </button>
              </footer>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

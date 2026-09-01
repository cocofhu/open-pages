import {
  ArrowLeftIcon,
  ArrowPathIcon,
  ArrowTopRightOnSquareIcon,
  EyeIcon,
  GlobeAltIcon,
  RocketLaunchIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import { useEffect, useMemo, useState } from "react";
import {
  pagesUrl,
  publishRepoCheckMessage,
  THEME_META,
  type PublishRepoCheck,
  type ThemeId,
} from "@open-pages/shared";
import { type AuthUser, type GithubRepo } from "../lib/api";
import { isTauri, platform } from "../lib/platform";
import { ComboSelect } from "./ComboSelect";
import { GitHubMark } from "./GitHubMark";
import { StudioBar } from "./StudioBar";

interface PublishPageProps {
  user: AuthUser | null;
  siteId: string;
  theme: ThemeId;
  defaultRepo?: string;
  busy: boolean;
  previewing: boolean;
  online: boolean;
  status: string;
  resultUrl: string | null;
  onBack: () => void;
  onClose: () => void;
  onLogin: () => void;
  onPreview: (opts: { repo: string; owner?: string }) => void;
  onPublish: (opts: { owner?: string; repo: string; createRepo?: boolean }) => void;
}

const NEW_REPO_CHECK: PublishRepoCheck = {
  eligible: true,
  reason: "new",
  message: publishRepoCheckMessage("new"),
};

function assessNewRepoName(name: string, repos: GithubRepo[]): PublishRepoCheck {
  const trimmed = name.trim();
  if (
    !/^[A-Za-z0-9._-]{1,100}$/.test(trimmed) ||
    trimmed.includes("..") ||
    trimmed.startsWith(".") ||
    trimmed.endsWith(".")
  ) {
    return {
      eligible: false,
      reason: "foreign",
      message: "仓库名只能包含字母、数字、点、下划线和短横线，且不能以点开头或结尾。",
    };
  }
  const existing = repos.find((item) => item.name.toLowerCase() === trimmed.toLowerCase());
  if (existing) {
    return {
      eligible: false,
      reason: "foreign",
      message: `仓库「${existing.fullName}」已存在。请关闭「创建新仓库」后选择它，或换一个名字。`,
    };
  }
  return NEW_REPO_CHECK;
}

export function PublishPage({
  user,
  siteId,
  theme,
  defaultRepo,
  busy,
  previewing,
  online,
  status,
  resultUrl,
  onBack,
  onClose,
  onLogin,
  onPreview,
  onPublish,
}: PublishPageProps) {
  const [repos, setRepos] = useState<GithubRepo[]>([]);
  const [repo, setRepo] = useState(defaultRepo ?? "");
  const [createNew, setCreateNew] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [repoCheck, setRepoCheck] = useState<PublishRepoCheck | null>(null);
  const [repoChecking, setRepoChecking] = useState(false);

  useEffect(() => {
    if (!user?.login) return;
    setError(null);
    void platform
      .repos()
      .then((data) => {
        setRepos(data.repos);
        setRepo((current) => current || data.repos[0]?.name || "");
      })
      .catch((err: Error) => setError(err.message));
  }, [user?.login]);

  useEffect(() => {
    if (!user?.login || !repo.trim()) {
      setRepoCheck(null);
      setRepoChecking(false);
      return;
    }

    setRepoChecking(true);
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          if (createNew) {
            setRepoCheck(assessNewRepoName(repo, repos));
            return;
          }
          setRepoCheck(await platform.checkRepoForPublish(user.login!, repo, siteId));
        } catch (err) {
          setRepoCheck({
            eligible: false,
            reason: "foreign",
            message: err instanceof Error ? err.message : "检查失败",
          });
        } finally {
          setRepoChecking(false);
        }
      })();
    }, 250);

    return () => window.clearTimeout(timer);
  }, [createNew, repo, repos, siteId, user?.login]);

  const owner = user?.login ?? "";
  const site = repo && owner ? pagesUrl(owner, repo) : "";
  const themeLabel = THEME_META[theme]?.label ?? theme;
  const canPublish = Boolean(repo.trim()) && !repoChecking && Boolean(repoCheck?.eligible);
  const showPublishFeedback = busy || Boolean(status) || Boolean(resultUrl);
  const repoOptions = useMemo(
    () =>
      repos.map((item) => ({
        value: item.name,
        label: item.fullName,
        hint: item.private ? "私有" : "公开",
      })),
    [repos],
  );

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
              生成静态网站并推送到 GitHub。主题可在站点设置里更换。
            </p>
          </header>

          {!user?.login ? (
            <section className="publish-login">
              <div className="publish-login-mark" aria-hidden="true">
                <GitHubMark className="publish-login-icon" />
              </div>
              <h3>连接 GitHub</h3>
              <p className="hint">登录后选择目标仓库，一键构建并推送到 GitHub Pages。</p>
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
                  <span className="hint">已连接，可以发布到你的仓库</span>
                </div>
              </div>

              <section className="studio-set-group publish-repo-group">
                <h3>目标仓库</h3>

                <div className="studio-toggle-row">
                  <div>
                    <strong>创建新仓库</strong>
                    <span>在 GitHub 上新建并发布到这个仓库</span>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={createNew}
                    className={createNew ? "studio-switch on" : "studio-switch"}
                    data-testid="publish-create-toggle"
                    onClick={() => setCreateNew((current) => !current)}
                  >
                    <i />
                  </button>
                </div>

                {createNew ? (
                  <label className="studio-field publish-repo-name">
                    <span>仓库名</span>
                    <input
                      value={repo}
                      data-testid="publish-repo-input"
                      spellCheck={false}
                      autoComplete="off"
                      autoCorrect="off"
                      autoCapitalize="off"
                      onChange={(event) => setRepo(event.target.value)}
                      placeholder={`${owner}.github.io`}
                    />
                    <em className="hint">建议使用 {owner}.github.io 作为个人站点首页</em>
                  </label>
                ) : (
                  <ComboSelect
                    label="选择仓库"
                    value={repo}
                    options={repoOptions}
                    testId="publish-repo-select"
                    searchPlaceholder="搜索仓库…"
                    onChange={setRepo}
                  />
                )}

                {repo ? (
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
                        <p className="hint">
                          {createNew
                            ? "确认仓库名可用，并避免与已有项目冲突…"
                            : "确认这个仓库可以安全发布，避免覆盖其他项目…"}
                        </p>
                      </>
                    ) : (
                      <>
                        <strong>{repoCheck?.eligible ? "可以发布" : "无法发布"}</strong>
                        <p className="hint">{repoCheck?.message ?? "请选择仓库"}</p>
                      </>
                    )}
                  </div>
                ) : null}
              </section>

              {showPublishFeedback && site ? (
                <div className="publish-url">
                  <GlobeAltIcon className="ui-icon" aria-hidden="true" />
                  <div className="publish-url-text">
                    <span className="publish-url-label">{resultUrl ? "站点地址" : "发布后访问"}</span>
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
              {showPublishFeedback && resultUrl ? (
                <div className="publish-success">
                  <strong>发布成功</strong>
                  <a href={resultUrl} target="_blank" rel="noreferrer">
                    {resultUrl}
                    <ArrowTopRightOnSquareIcon className="ui-icon" aria-hidden="true" />
                  </a>
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
                      ? "按 GitHub Pages 路径预览，将在新标签打开"
                      : "预览需要联网"
                  }
                  onClick={() => onPreview({ repo, owner })}
                >
                  <EyeIcon className="ui-icon" aria-hidden="true" />
                  {previewing ? "生成中…" : "预览"}
                </button>
                <button
                  type="button"
                  className="primary icon-label"
                  disabled={busy || previewing || !canPublish}
                  data-testid="publish-submit"
                  onClick={() => onPublish({ repo, createRepo: createNew })}
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

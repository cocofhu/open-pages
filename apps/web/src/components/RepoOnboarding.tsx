import { ArrowPathIcon } from "@heroicons/react/24/outline";
import { useEffect, useMemo, useState } from "react";
import type { PublishRepoCheck } from "@open-pages/shared";
import { GitHubMark } from "./GitHubMark";
import { ComboSelect } from "./ComboSelect";
import { type AuthUser, type GithubRepo } from "../lib/api";
import { platform } from "../lib/platform";
import { assessNewRepoName } from "../lib/repo-name";
import { siteId } from "../lib/vfs";

function bindableRepos(repos: GithubRepo[]): GithubRepo[] {
  return repos.filter((item) => item.eligible !== false);
}

interface RepoOnboardingProps {
  user: AuthUser | null;
  device?: { userCode: string; verificationUri: string } | null;
  onLogin: () => void;
  onSessionStale: () => void;
  onPick: (opts: { repo: string; createRepo?: boolean }) => void;
  /** True while bindRepo is running from this card (plan g1). */
  busy?: boolean;
  progressLabel?: string;
  progressPercent?: number;
  bindError?: string | null;
  onCancel?: () => void;
  onRetry?: () => void;
}

export function RepoOnboarding({
  user,
  device,
  onLogin,
  onSessionStale,
  onPick,
  busy = false,
  progressLabel = "",
  progressPercent = 0,
  bindError = null,
  onCancel,
  onRetry,
}: RepoOnboardingProps) {
  const [repos, setRepos] = useState<GithubRepo[]>([]);
  const [repo, setRepo] = useState("");
  const [createNew, setCreateNew] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [repoCheck, setRepoCheck] = useState<PublishRepoCheck | null>(null);
  const [repoChecking, setRepoChecking] = useState(false);

  useEffect(() => {
    if (!user?.login) return;
    setLoading(true);
    void platform
      .repos(siteId())
      .then((data) => {
        const usable = bindableRepos(data.repos);
        setRepos(usable);
        setCreateNew(usable.length === 0);
        setRepo((current) => current || usable[0]?.name || "");
      })
      .catch((err: Error) => {
        setError(err.message);
        onSessionStale();
      })
      .finally(() => setLoading(false));
  }, [user?.login, onSessionStale]);

  useEffect(() => {
    if (!user?.login || !createNew) {
      setRepoCheck(null);
      setRepoChecking(false);
      return;
    }
    if (!repo.trim()) {
      setRepoCheck(null);
      setRepoChecking(false);
      return;
    }
    setRepoChecking(true);
    const timer = window.setTimeout(() => {
      setRepoCheck(assessNewRepoName(repo, repos, { forOnboarding: true }));
      setRepoChecking(false);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [createNew, repo, repos, user?.login]);

  const owner = user?.login ?? "";
  const suggested = owner ? `${owner}.github.io` : "username.github.io";
  const options = useMemo(
    () =>
      repos.map((item) => ({
        value: item.name,
        label: item.fullName,
        hint: item.private ? "私有" : "公开",
      })),
    [repos],
  );

  const canSyncCreate = Boolean(repo.trim()) && !repoChecking && Boolean(repoCheck?.eligible);
  const canSyncExisting = Boolean(repo.trim()) && !loading && options.length > 0;
  const eligible = createNew ? canSyncCreate : canSyncExisting;
  const formLocked = busy;
  const barWidth = Math.max(0, Math.min(100, Math.round(progressPercent || 8)));
  const showProgress = busy && !bindError;
  const displayError = bindError || error;

  return (
    <div className="boot-screen" data-testid="repo-onboarding">
      <div className="publish-card onboarding-card">
        <header className="publish-hero">
          <p className="publish-kicker">Open Pages</p>
          <h2>选择一个仓库</h2>
          <p className="hint">
            登录后选定仓库，会同步配置、文章，并恢复主题和插件。原始文件会备份到 source/origin。
            列表只显示空仓库和你用 Open Pages 发布过的仓库。
          </p>
        </header>
        {!user?.login ? (
          <section className="publish-login">
            <div className="publish-login-mark" aria-hidden="true">
              <GitHubMark className="publish-login-icon" />
            </div>
            {device ? (
              <div data-testid="device-login">
                <h3>在 GitHub 输入验证码</h3>
                <p className="device-user-code" data-testid="device-user-code">
                  {device.userCode}
                </p>
                <p className="hint">打开 GitHub 设备页，输入上面的代码完成登录。正在等待授权…</p>
                <button
                  type="button"
                  className="primary icon-label"
                  onClick={() => window.open(device.verificationUri, "_blank", "noopener,noreferrer")}
                >
                  <GitHubMark className="ui-icon" />
                  打开 GitHub
                </button>
              </div>
            ) : (
              <>
                <h3>连接 GitHub</h3>
                <p className="hint">先登录，才能读取你的仓库并同步到本机。</p>
                <button type="button" className="primary icon-label" onClick={onLogin}>
                  <GitHubMark className="ui-icon" />
                  登录 GitHub
                </button>
              </>
            )}
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
                <span className="hint">已连接</span>
              </div>
            </div>
            <section className="studio-set-group publish-repo-group">
              <div className="onboard-mode" role="tablist" aria-label="仓库方式">
                <button
                  type="button"
                  role="tab"
                  aria-selected={createNew}
                  className={createNew ? "on" : ""}
                  data-testid="onboard-create-new"
                  disabled={formLocked}
                  onClick={() => {
                    setCreateNew(true);
                    setRepo("");
                    setError(null);
                  }}
                >
                  创建新仓库
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={!createNew}
                  className={createNew ? "" : "on"}
                  data-testid="onboard-pick-existing"
                  disabled={formLocked}
                  onClick={() => {
                    setCreateNew(false);
                    setRepo((current) => current || repos[0]?.name || "");
                    setError(null);
                  }}
                >
                  选择已有仓库
                </button>
              </div>
              <p className="hint">
                {createNew
                  ? "输入一个还没有的仓库名。点同步后会在 GitHub 上新建，并从空白站点开始。"
                  : "只列出空仓库和你用 Open Pages 发布过的仓库。"}
              </p>
              {createNew ? (
                <div className="onboard-create-field">
                  <label className="onboard-repo-label" htmlFor="onboard-repo-name">
                    仓库名
                  </label>
                  <div className="onboard-repo-combo">
                    <span className="onboard-repo-owner" aria-hidden="true">
                      {owner} /
                    </span>
                    <input
                      id="onboard-repo-name"
                      value={repo}
                      spellCheck={false}
                      data-testid="onboard-repo-name"
                      autoComplete="off"
                      disabled={formLocked}
                      placeholder={suggested}
                      onChange={(event) => setRepo(event.target.value)}
                    />
                  </div>
                  <button
                    type="button"
                    className="onboard-suggest"
                    data-testid="onboard-repo-suggest"
                    disabled={formLocked || !owner}
                    onClick={() => setRepo(suggested)}
                  >
                    建议使用 {suggested}
                  </button>
                  {repo.trim() ? (
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
                      data-testid="onboard-repo-check"
                      aria-live="polite"
                      aria-busy={repoChecking}
                    >
                      {repoChecking ? (
                        <>
                          <div className="publish-repo-check-head">
                            <ArrowPathIcon className="ui-icon publish-repo-spinner" aria-hidden="true" />
                            <strong>正在检查仓库名…</strong>
                          </div>
                          <p className="hint">确认格式可用，并避免与已列出的仓库重名…</p>
                        </>
                      ) : (
                        <>
                          <strong>{repoCheck?.eligible ? "可以创建" : "无法创建"}</strong>
                          <p className="hint">{repoCheck?.message ?? "请输入仓库名"}</p>
                        </>
                      )}
                    </div>
                  ) : null}
                </div>
              ) : loading ? (
                <div className="onboard-list-loading" data-testid="onboard-repo-loading" role="status" aria-live="polite">
                  <ArrowPathIcon className="ui-icon publish-repo-spinner" aria-hidden="true" />
                  <p className="hint">正在筛选可用仓库…</p>
                </div>
              ) : options.length ? (
                <ComboSelect
                  label="选择仓库"
                  value={repo}
                  options={options}
                  testId="onboard-repo-select"
                  searchPlaceholder="搜索仓库…"
                  onChange={setRepo}
                  disabled={formLocked}
                />
              ) : (
                <p className="hint" data-testid="onboard-repo-empty">
                  没有可用仓库。打开「创建新仓库」，或先在 GitHub 建一个空仓库。
                </p>
              )}
              {displayError ? (
                <p className="hint publish-error" data-testid="onboard-bind-error" role="alert">
                  {displayError}
                </p>
              ) : null}
            </section>
            <footer className="onboard-foot">
              <button
                type="button"
                className="primary icon-label onboard-sync"
                data-testid="onboard-sync"
                disabled={busy || !eligible}
                aria-busy={busy}
                onClick={() => {
                  if (busy || !eligible) return;
                  setError(null);
                  onPick({ repo: repo.trim(), createRepo: createNew });
                }}
              >
                <ArrowPathIcon
                  className={busy ? "ui-icon publish-repo-spinner" : "ui-icon"}
                  aria-hidden="true"
                />
                {busy ? "正在同步…" : "同步并打开"}
              </button>
              {showProgress ? (
                <div className="onboard-progress" data-testid="onboard-progress" role="status" aria-live="polite">
                  <div className="onboard-progress-bar" aria-hidden="true">
                    <i style={{ width: `${barWidth}%` }} />
                  </div>
                  <p>{progressLabel || "正在同步仓库…"}</p>
                </div>
              ) : null}
              {busy && onCancel ? (
                <button type="button" className="ghost onboard-cancel" data-testid="onboard-cancel" onClick={onCancel}>
                  取消
                </button>
              ) : null}
              {bindError && onRetry ? (
                <button type="button" className="ghost onboard-retry" data-testid="onboard-retry" onClick={onRetry}>
                  重试
                </button>
              ) : null}
            </footer>
          </>
        )}
      </div>
    </div>
  );
}

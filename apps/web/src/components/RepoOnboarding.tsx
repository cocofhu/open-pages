import { useEffect, useMemo, useState } from "react";
import { GitHubMark } from "./GitHubMark";
import { ComboSelect } from "./ComboSelect";
import { ConfirmDialog } from "./ConfirmDialog";
import { type AuthUser, type GithubRepo } from "../lib/api";
import { platform } from "../lib/platform";
import { switchRepoConfirmCopy } from "../lib/repo-onboarding-copy";
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
  /** When set, user is already bound: show return + confirm before sync. */
  onReturn?: () => void;
}

export function RepoOnboarding({
  user,
  device,
  onLogin,
  onSessionStale,
  onPick,
  onReturn,
}: RepoOnboardingProps) {
  const [repos, setRepos] = useState<GithubRepo[]>([]);
  const [repo, setRepo] = useState("");
  const [createNew, setCreateNew] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

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

  const owner = user?.login ?? "";
  const options = useMemo(
    () =>
      repos.map((item) => ({
        value: item.name,
        label: item.fullName,
        hint: item.private ? "私有" : "公开",
      })),
    [repos],
  );

  const confirmCopy = switchRepoConfirmCopy({
    owner: owner || "user",
    repo: repo.trim() || "repo",
    createRepo: createNew,
  });

  const requestSync = () => {
    const name = repo.trim();
    if (!name) return;
    if (onReturn) {
      setConfirmOpen(true);
      return;
    }
    onPick({ repo: name, createRepo: createNew });
  };

  return (
    <div className="boot-screen" data-testid="repo-onboarding">
      <div className="publish-card onboarding-card">
        <header className="publish-hero">
          <p className="publish-kicker">Open Pages</p>
          <h2>选择一个仓库</h2>
          <p className="hint">
            {onReturn
              ? "切换后本地会全部按新仓库来。还没发布的改动会丢掉。"
              : "登录后选定仓库，会同步配置、文章，并恢复主题和插件。原始文件会备份到 source/origin。列表只显示空仓库和你用 Open Pages 发布过的仓库。"}
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
                  onClick={() => {
                    setCreateNew(true);
                    setRepo("");
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
                  onClick={() => {
                    setCreateNew(false);
                    setRepo((current) => current || repos[0]?.name || "");
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
                <label className="block publish-repo-name">
                  仓库名
                  <input
                    value={repo}
                    spellCheck={false}
                    data-testid="onboard-repo-name"
                    autoComplete="off"
                    placeholder={`${owner}.github.io`}
                    onChange={(event) => setRepo(event.target.value)}
                  />
                </label>
              ) : options.length ? (
                <ComboSelect
                  label="选择仓库"
                  value={repo}
                  options={options}
                  testId="onboard-repo-select"
                  searchPlaceholder="搜索仓库…"
                  onChange={setRepo}
                />
              ) : (
                <p className="hint" data-testid="onboard-repo-empty">
                  {loading
                    ? "正在筛选可用仓库…"
                    : "没有可用仓库。打开「创建新仓库」，或先在 GitHub 建一个空仓库。"}
                </p>
              )}
              {error ? <p className="hint publish-error">{error}</p> : null}
            </section>
            <footer className={onReturn ? "publish-foot publish-foot-split" : "publish-foot"}>
              {onReturn ? (
                <button
                  type="button"
                  className="ghost"
                  data-testid="onboard-return"
                  onClick={onReturn}
                >
                  返回当前站点
                </button>
              ) : null}
              <button
                type="button"
                className="primary"
                data-testid="onboard-sync"
                disabled={!repo.trim() || loading}
                onClick={requestSync}
              >
                同步并打开
              </button>
            </footer>
          </>
        )}
      </div>
      <ConfirmDialog
        open={confirmOpen}
        title={confirmCopy.title}
        message={confirmCopy.message}
        confirmLabel={confirmCopy.confirmLabel}
        danger
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => {
          setConfirmOpen(false);
          onPick({ repo: repo.trim(), createRepo: createNew });
        }}
      />
    </div>
  );
}

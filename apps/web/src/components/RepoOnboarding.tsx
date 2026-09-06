import { useEffect, useMemo, useState } from "react";
import { GitHubMark } from "./GitHubMark";
import { ComboSelect } from "./ComboSelect";
import { type AuthUser, type GithubRepo } from "../lib/api";
import { platform } from "../lib/platform";

interface RepoOnboardingProps {
  user: AuthUser | null;
  onLogin: () => void;
  onSessionStale: () => void;
  onPick: (opts: { repo: string; createRepo?: boolean }) => void;
}

export function RepoOnboarding({ user, onLogin, onSessionStale, onPick }: RepoOnboardingProps) {
  const [repos, setRepos] = useState<GithubRepo[]>([]);
  const [repo, setRepo] = useState("");
  const [createNew, setCreateNew] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!user?.login) return;
    setLoading(true);
    void platform
      .repos()
      .then((data) => {
        setRepos(data.repos);
        setRepo((current) => current || data.repos[0]?.name || "");
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

  return (
    <div className="boot-screen" data-testid="repo-onboarding">
      <div className="publish-card onboarding-card">
        <header className="publish-hero">
          <p className="publish-kicker">Open Pages</p>
          <h2>选择一个仓库</h2>
          <p className="hint">登录后选定仓库，会同步配置、文章，并恢复主题和插件。原始文件会备份到 source/origin。</p>
        </header>
        {!user?.login ? (
          <section className="publish-login">
            <div className="publish-login-mark" aria-hidden="true">
              <GitHubMark className="publish-login-icon" />
            </div>
            <h3>连接 GitHub</h3>
            <p className="hint">先登录，才能读取你的仓库并同步到本机。</p>
            <button type="button" className="primary icon-label" onClick={onLogin}>
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
                <span className="hint">已连接</span>
              </div>
            </div>
            <section className="studio-set-group publish-repo-group">
              <div className="studio-toggle-row">
                <div>
                  <strong>创建新仓库</strong>
                  <span>从空白站点开始，稍后再发布</span>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={createNew}
                  className={createNew ? "toggle on" : "toggle"}
                  onClick={() => setCreateNew((value) => !value)}
                />
              </div>
              {createNew ? (
                <label className="block">
                  仓库名
                  <input
                    value={repo}
                    spellCheck={false}
                    onChange={(event) => setRepo(event.target.value)}
                    placeholder={`${owner}.github.io`}
                  />
                </label>
              ) : (
                <ComboSelect
                  label="选择仓库"
                  value={repo}
                  options={options}
                  testId="onboard-repo-select"
                  searchPlaceholder="搜索仓库…"
                  onChange={setRepo}
                />
              )}
              {error ? <p className="hint publish-error">{error}</p> : null}
            </section>
            <footer className="publish-foot">
              <button
                type="button"
                className="primary"
                disabled={!repo.trim() || loading}
                onClick={() => onPick({ repo: repo.trim(), createRepo: createNew })}
              >
                同步并打开
              </button>
            </footer>
          </>
        )}
      </div>
    </div>
  );
}

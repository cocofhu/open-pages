import { ArrowLeftIcon, RocketLaunchIcon, XMarkIcon } from "@heroicons/react/24/outline";
import { useEffect, useState } from "react";
import { pagesUrl, THEME_META, type ThemeId } from "@open-pages/shared";
import { api, type AuthUser, type GithubRepo } from "../lib/api";
import { GitHubMark } from "./GitHubMark";
import { StudioBar } from "./StudioBar";

interface PublishPageProps {
  user: AuthUser | null;
  theme: ThemeId;
  defaultRepo?: string;
  busy: boolean;
  status: string;
  resultUrl: string | null;
  onBack: () => void;
  onClose: () => void;
  onLogin: () => void;
  onPublish: (opts: { owner?: string; repo: string; createRepo?: boolean }) => void;
}

export function PublishPage({
  user,
  theme,
  defaultRepo,
  busy,
  status,
  resultUrl,
  onBack,
  onClose,
  onLogin,
  onPublish,
}: PublishPageProps) {
  const [repos, setRepos] = useState<GithubRepo[]>([]);
  const [repo, setRepo] = useState(defaultRepo ?? "");
  const [createNew, setCreateNew] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user?.login) return;
    setError(null);
    void api
      .repos()
      .then((data) => {
        setRepos(data.repos);
        setRepo((current) => current || data.repos[0]?.name || "");
      })
      .catch((err: Error) => setError(err.message));
  }, [user?.login]);

  const owner = user?.login ?? "";
  const site = repo && owner ? pagesUrl(owner, repo) : "";

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
      <div className="publish-form" data-testid="dialog-publish">
        <p className="hint">
          当前主题 <strong>{THEME_META[theme]?.label ?? theme}</strong>
          ，可在站点设置里更换。源码提交到 main，Hexo 产物提交到 gh-pages。
        </p>
        {!user?.login ? (
          <>
            <p>先登录 GitHub，再选择仓库。</p>
            <button type="button" className="primary icon-label" data-testid="publish-login" onClick={onLogin}>
              <GitHubMark className="ui-icon" />
              登录 GitHub
            </button>
          </>
        ) : (
          <>
            <label className="check">
              <input
                type="checkbox"
                checked={createNew}
                onChange={(event) => setCreateNew(event.target.checked)}
              />
              创建新仓库
            </label>
            {createNew ? (
              <label>
                仓库名
                <input
                  value={repo}
                  onChange={(event) => setRepo(event.target.value)}
                  placeholder={`${owner}.github.io`}
                />
              </label>
            ) : (
              <label>
                选择仓库
                <select value={repo} onChange={(event) => setRepo(event.target.value)}>
                  <option value="">选择…</option>
                  {repos.map((item) => (
                    <option key={item.id} value={item.name}>
                      {item.fullName}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {site && <p className="hint">发布后访问：{site}</p>}
            {error && <p className="error">{error}</p>}
            {status && <p className="hint">{status}</p>}
            {resultUrl && (
              <p>
                已发布：{" "}
                <a href={resultUrl} target="_blank" rel="noreferrer">
                  {resultUrl}
                </a>
              </p>
            )}
            <button
              type="button"
              className="primary icon-label"
              disabled={busy || !repo}
              onClick={() => onPublish({ repo, createRepo: createNew })}
            >
              <RocketLaunchIcon className="ui-icon" aria-hidden="true" />
              {busy ? "发布中…" : "Hexo 发布"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

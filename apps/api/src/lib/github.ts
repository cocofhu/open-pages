import { Octokit } from "@octokit/rest";
import { pagesRoot, pagesUrl, parseRepoName, type SiteFile } from "@open-pages/shared";
import { env } from "../env.js";

export function octokit(token: string): Octokit {
  return new Octokit({ auth: token, userAgent: "open-pages" });
}

export function authorizeUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: env.githubClientId,
    redirect_uri: `${env.appOrigin}/auth/github/callback`,
    scope: "repo read:user",
    state,
  });
  return `https://github.com/login/oauth/authorize?${params.toString()}`;
}

export async function exchangeCode(code: string): Promise<string> {
  const response = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: env.githubClientId,
      client_secret: env.githubClientSecret,
      code,
      redirect_uri: `${env.appOrigin}/auth/github/callback`,
    }),
  });
  const data = (await response.json()) as { access_token?: string; error?: string };
  if (!data.access_token) {
    throw new Error(data.error ?? "GitHub OAuth exchange failed");
  }
  return data.access_token;
}

export async function listRepos(token: string) {
  const gh = octokit(token);
  const repos = await gh.paginate(gh.repos.listForAuthenticatedUser, {
    per_page: 100,
    sort: "updated",
    affiliation: "owner",
  });
  return repos.map((repo) => ({
    id: repo.id,
    name: repo.name,
    fullName: repo.full_name,
    private: repo.private,
    defaultBranch: repo.default_branch,
    htmlUrl: repo.html_url,
    pagesUrl: pagesUrl(repo.owner.login, repo.name),
  }));
}

export async function createRepo(token: string, name: string, isPrivate = false) {
  const gh = octokit(token);
  name = parseRepoName(name);
  const { data } = await gh.repos.createForAuthenticatedUser({
    name,
    private: isPrivate,
    auto_init: true,
    description: "Published with Open Pages + Hexo",
  });
  return {
    owner: data.owner.login,
    repo: data.name,
    defaultBranch: data.default_branch,
    htmlUrl: data.html_url,
    pagesUrl: pagesUrl(data.owner.login, data.name),
    root: pagesRoot(data.owner.login, data.name),
  };
}

export async function commitFiles(options: {
  token: string;
  owner: string;
  repo: string;
  branch: string;
  message: string;
  files: SiteFile[];
  /** Replace the branch snapshot instead of merging onto the existing tree. */
  replace?: boolean;
}): Promise<string> {
  const gh = octokit(options.token);
  const { owner, repo, branch, message, files, replace } = options;
  if (!files.length) {
    throw new Error("Cannot commit an empty tree");
  }
  let parentSha: string | undefined;
  let baseTree: string | undefined;
  try {
    const ref = await gh.git.getRef({ owner, repo, ref: `heads/${branch}` });
    parentSha = ref.data.object.sha;
    const commit = await gh.git.getCommit({ owner, repo, commit_sha: parentSha });
    baseTree = commit.data.tree.sha;
  } catch {
    parentSha = undefined;
    baseTree = undefined;
  }

  const treeItems = await Promise.all(
    files.map(async (file) => {
      const encoding = file.encoding === "base64" ? "base64" : "utf-8";
      const blob = await gh.git.createBlob({
        owner,
        repo,
        content: file.content,
        encoding,
      });
      return {
        path: file.path,
        mode: "100644" as const,
        type: "blob" as const,
        sha: blob.data.sha,
      };
    }),
  );

  const tree = await gh.git.createTree({
    owner,
    repo,
    ...(replace ? {} : { base_tree: baseTree }),
    tree: treeItems,
  });

  const commit = await gh.git.createCommit({
    owner,
    repo,
    message,
    tree: tree.data.sha,
    parents: parentSha ? [parentSha] : [],
  });

  if (parentSha) {
    await gh.git.updateRef({
      owner,
      repo,
      ref: `heads/${branch}`,
      sha: commit.data.sha,
    });
  } else {
    await gh.git.createRef({
      owner,
      repo,
      ref: `refs/heads/${branch}`,
      sha: commit.data.sha,
    });
  }
  return commit.data.sha;
}

export async function enablePages(token: string, owner: string, repo: string): Promise<string> {
  const gh = octokit(token);
  try {
    await gh.repos.createPagesSite({
      owner,
      repo,
      build_type: "legacy",
      source: { branch: "gh-pages", path: "/" },
    });
  } catch {
    try {
      await gh.repos.updateInformationAboutPagesSite({
        owner,
        repo,
        source: { branch: "gh-pages", path: "/" },
      });
    } catch {
      // Pages may already be configured
    }
  }
  try {
    const { data } = await gh.repos.getPages({ owner, repo });
    return data.html_url ?? pagesUrl(owner, repo);
  } catch {
    return pagesUrl(owner, repo);
  }
}

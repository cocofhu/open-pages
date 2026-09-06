import { Octokit } from "@octokit/rest";
import {
  assessRepoRootForPublish,
  pagesRoot,
  pagesUrl,
  parseRepoName,
  type PublishRepoCheck,
  type SiteFile,
  OPEN_PAGES_MANIFEST_PATH,
  OPEN_PAGES_README_PATH,
  OPEN_PAGES_REPO_DESCRIPTION,
} from "@open-pages/shared";

export interface GithubRepo {
  id: number;
  name: string;
  fullName: string;
  private: boolean;
  defaultBranch: string;
  htmlUrl: string;
  pagesUrl: string;
}

export interface CreatedRepo {
  owner: string;
  repo: string;
  defaultBranch: string;
  htmlUrl: string;
  pagesUrl: string;
  root: string;
}

export function octokit(token: string): Octokit {
  return new Octokit({ auth: token, userAgent: "open-pages" });
}

export async function listRepos(token: string): Promise<GithubRepo[]> {
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

export async function createRepo(token: string, name: string, isPrivate = false): Promise<CreatedRepo> {
  const gh = octokit(token);
  name = parseRepoName(name);
  const { data } = await gh.repos.createForAuthenticatedUser({
    name,
    private: isPrivate,
    auto_init: true,
    description: OPEN_PAGES_REPO_DESCRIPTION,
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

function githubStatus(error: unknown): number | undefined {
  if (typeof error !== "object" || !error) return undefined;
  if ("status" in error && typeof (error as { status?: unknown }).status === "number") {
    return (error as { status: number }).status;
  }
  const response = (error as { response?: { status?: unknown } }).response;
  if (response && typeof response.status === "number") return response.status;
  return undefined;
}

async function getRepoTextViaRaw(
  owner: string,
  repo: string,
  path: string,
  ref: string,
): Promise<string | null> {
  const encodedPath = path
    .split("/")
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join("/");
  const url = `https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${encodeURIComponent(ref)}/${encodedPath}`;
  try {
    const response = await fetch(url, {
      headers: { "user-agent": "open-pages" },
      redirect: "follow",
    });
    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  }
}

function decodeGithubFileContent(data: unknown): string | null {
  if (typeof data === "string") return data;
  if (!data || typeof data !== "object") return null;
  const file = data as { type?: unknown; encoding?: unknown; content?: unknown };
  if (file.type !== "file" || typeof file.content !== "string") return null;
  if (file.encoding === "base64") {
    return Buffer.from(file.content.replace(/\n/g, ""), "base64").toString("utf8");
  }
  return file.content;
}

export async function getRepoTextFile(
  token: string,
  owner: string,
  repo: string,
  path: string,
  ref?: string,
): Promise<string | null> {
  const gh = octokit(token);
  const branch = ref || "main";
  try {
    const { data } = await gh.repos.getContent({
      owner,
      repo,
      path,
      ...(ref ? { ref } : {}),
      mediaType: { format: "raw" },
    });
    const text = decodeGithubFileContent(data);
    if (text != null) return text;
  } catch (error: unknown) {
    const status = githubStatus(error);
    if (status !== undefined && status !== 404) {
      const viaRaw = await getRepoTextViaRaw(owner, repo, path, branch);
      if (viaRaw != null) return viaRaw;
      throw error;
    }
  }
  return getRepoTextViaRaw(owner, repo, path, branch);
}

export async function listRepoRootEntries(
  token: string,
  owner: string,
  repo: string,
  ref?: string,
): Promise<string[]> {
  const gh = octokit(token);
  try {
    const { data } = await gh.repos.getContent({ owner, repo, path: "", ...(ref ? { ref } : {}) });
    if (!Array.isArray(data)) return [];
    return data.map((entry) => entry.name);
  } catch (error: unknown) {
    if (typeof error === "object" && error && "status" in error && error.status === 404) return [];
    throw error;
  }
}

async function resolveRepoBranch(
  token: string,
  owner: string,
  repo: string,
  hinted?: string,
): Promise<string> {
  if (hinted) return hinted;
  try {
    const { data } = await octokit(token).repos.get({ owner, repo });
    return data.default_branch || "main";
  } catch {
    return "main";
  }
}

export async function assessRepoForPublish(
  token: string,
  owner: string,
  repo: string,
  siteId: string,
  defaultBranch?: string,
): Promise<PublishRepoCheck> {
  const branch = await resolveRepoBranch(token, owner, repo, defaultBranch);
  const [manifestRaw, rootEntries, configYaml, readme] = await Promise.all([
    getRepoTextFile(token, owner, repo, OPEN_PAGES_MANIFEST_PATH, branch),
    listRepoRootEntries(token, owner, repo, branch),
    getRepoTextFile(token, owner, repo, "_config.yml", branch),
    getRepoTextFile(token, owner, repo, OPEN_PAGES_README_PATH, branch),
  ]);
  return assessRepoRootForPublish({ siteId, manifestRaw, rootEntries, configYaml, readme });
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

import { Octokit } from "@octokit/rest";
import {
  assessRepoRootForPublish,
  normalizeCustomDomainInput,
  pagesRoot,
  pagesUrl,
  parseCustomDomain,
  parseRepoName,
  publishRepoCheckMessage,
  type PublishRepoCheck,
  type PublishRepoReason,
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
  eligible?: boolean;
  reason?: PublishRepoReason;
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

export async function listRepos(token: string, siteId = "default"): Promise<GithubRepo[]> {
  const gh = octokit(token);
  const repos = await gh.paginate(gh.repos.listForAuthenticatedUser, {
    per_page: 100,
    sort: "updated",
    affiliation: "owner",
  });
  const mapped = repos.map((repo) => ({
    id: repo.id,
    name: repo.name,
    fullName: repo.full_name,
    private: repo.private,
    defaultBranch: repo.default_branch,
    htmlUrl: repo.html_url,
    pagesUrl: pagesUrl(repo.owner.login, repo.name),
  }));
  const checks = await mapPool(mapped, 6, async (repo, index) => {
    if ((repos[index]?.size ?? 0) === 0) {
      return {
        eligible: true,
        reason: "adoptable" as const,
        message: publishRepoCheckMessage("adoptable"),
      };
    }
    try {
      const owner = repo.fullName.split("/")[0] ?? "";
      return await assessRepoForPublish(token, owner, repo.name, siteId, repo.defaultBranch);
    } catch {
      return {
        eligible: false,
        reason: "invalid-manifest" as const,
        message: "无法确认这个仓库是否属于 Open Pages。",
      };
    }
  });
  return mapped.map((repo, index) => ({
    ...repo,
    eligible: checks[index]?.eligible ?? false,
    reason: checks[index]?.reason,
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
  const rootEntries = await listRepoRootEntries(token, owner, repo, branch);
  const names = new Set(rootEntries.map((entry) => entry.replace(/\/$/, "")));
  const manifestRaw = names.has(OPEN_PAGES_MANIFEST_PATH)
    ? await getRepoTextFile(token, owner, repo, OPEN_PAGES_MANIFEST_PATH, branch)
    : null;
  if (manifestRaw != null) {
    return assessRepoRootForPublish({ siteId, manifestRaw, rootEntries });
  }
  const [configYaml, readme] = await Promise.all([
    names.has("_config.yml")
      ? getRepoTextFile(token, owner, repo, "_config.yml", branch)
      : Promise.resolve(null),
    names.has(OPEN_PAGES_README_PATH)
      ? getRepoTextFile(token, owner, repo, OPEN_PAGES_README_PATH, branch)
      : Promise.resolve(null),
  ]);
  return assessRepoRootForPublish({ siteId, manifestRaw: null, rootEntries, configYaml, readme });
}

const SNAPSHOT_SKIP = /^(node_modules|themes|public|\.builds|source\/origin)(\/|$)/;
const SNAPSHOT_BINARY = /\.(png|jpe?g|gif|webp|svg|ico|mp4|webm|woff2?|ttf|otf|eot|pdf|zip|gz|mp3|wav)$/i;
const SNAPSHOT_MAX_FILE = 2 * 1024 * 1024;
const SNAPSHOT_MAX_FILES = 400;

export interface SnapshotProgress {
  label: string;
  percent: number;
  done: number;
  total: number;
}

function looksBinary(bytes: Buffer, path: string): boolean {
  if (SNAPSHOT_BINARY.test(path)) return true;
  return bytes.includes(0);
}

async function mapPool<T, R>(items: T[], limit: number, worker: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (;;) {
        const index = next;
        next += 1;
        if (index >= items.length) return;
        results[index] = await worker(items[index], index);
      }
    }),
  );
  return results;
}

export async function downloadRepoSnapshot(
  token: string,
  owner: string,
  repo: string,
  defaultBranch?: string,
  onProgress?: (progress: SnapshotProgress) => void,
): Promise<{ files: SiteFile[]; defaultBranch: string }> {
  const gh = octokit(token);
  const branch = await resolveRepoBranch(token, owner, repo, defaultBranch);
  const ref = await gh.git.getRef({ owner, repo, ref: `heads/${branch}` });
  const tree = await gh.git.getTree({
    owner,
    repo,
    tree_sha: ref.data.object.sha,
    recursive: "true",
  });
  const blobs = tree.data.tree.filter(
    (entry) =>
      entry.type === "blob" &&
      typeof entry.path === "string" &&
      typeof entry.sha === "string" &&
      !SNAPSHOT_SKIP.test(entry.path) &&
      (entry.size ?? 0) <= SNAPSHOT_MAX_FILE,
  );
  if (blobs.length > SNAPSHOT_MAX_FILES) {
    throw new Error(`仓库文件太多（最多 ${SNAPSHOT_MAX_FILES} 个），请换一个 Open Pages 站点仓库。`);
  }
  onProgress?.({ label: "正在读取仓库文件列表", percent: 12, done: 0, total: blobs.length });
  let done = 0;
  const files = await mapPool(blobs, 6, async (entry) => {
    const blob = await gh.git.getBlob({ owner, repo, file_sha: entry.sha! });
    const raw = Buffer.from(String(blob.data.content).replace(/\n/g, ""), "base64");
    const binary = looksBinary(raw, entry.path!);
    done += 1;
    onProgress?.({
      label: `正在下载 ${entry.path}`,
      percent: 12 + (58 * done) / Math.max(blobs.length, 1),
      done,
      total: blobs.length,
    });
    return {
      path: entry.path!,
      content: binary ? raw.toString("base64") : raw.toString("utf8"),
      encoding: binary ? ("base64" as const) : ("utf8" as const),
    };
  });
  return { files, defaultBranch: branch };
}

/** Read existing custom domain from Pages API cname, falling back to gh-pages CNAME file. */
export async function readPagesCustomDomain(
  token: string,
  owner: string,
  repo: string,
): Promise<string | null> {
  const gh = octokit(token);
  try {
    const { data } = await gh.repos.getPages({ owner, repo });
    if (typeof data.cname === "string" && data.cname.trim()) {
      const parsed = parseCustomDomain(data.cname);
      if (parsed.ok && parsed.hostname) return parsed.hostname;
      return normalizeCustomDomainInput(data.cname) || null;
    }
  } catch {
    // Pages may be disabled
  }
  try {
    const text = await getRepoTextFile(token, owner, repo, "CNAME", "gh-pages");
    if (!text) return null;
    const line = text.trim().split(/\r?\n/)[0]?.trim() ?? "";
    if (!line) return null;
    const parsed = parseCustomDomain(line);
    if (parsed.ok && parsed.hostname) return parsed.hostname;
    return normalizeCustomDomainInput(line) || null;
  } catch {
    return null;
  }
}

/**
 * Ensure gh-pages source is enabled and optionally sync Pages `cname`.
 * Pass `cname: null` or `""` to clear; omit / `undefined` to leave cname unchanged.
 */
export async function enablePages(
  token: string,
  owner: string,
  repo: string,
  cname?: string | null,
): Promise<string> {
  const gh = octokit(token);
  const touchCname = cname !== undefined;
  let resolvedHostname: string | null | undefined;
  if (touchCname) {
    if (cname == null || !String(cname).trim()) {
      resolvedHostname = null;
    } else {
      const parsed = parseCustomDomain(String(cname));
      resolvedHostname = parsed.ok ? parsed.hostname || null : normalizeCustomDomainInput(String(cname)) || null;
    }
  }

  try {
    await gh.repos.createPagesSite({
      owner,
      repo,
      build_type: "legacy",
      source: { branch: "gh-pages", path: "/" },
      ...(resolvedHostname ? { cname: resolvedHostname } : {}),
    });
  } catch {
    try {
      await gh.repos.updateInformationAboutPagesSite({
        owner,
        repo,
        source: { branch: "gh-pages", path: "/" },
        ...(touchCname ? { cname: resolvedHostname ?? null } : {}),
      });
    } catch {
      // Pages may already be configured
    }
  }

  if (touchCname) {
    try {
      await gh.repos.updateInformationAboutPagesSite({
        owner,
        repo,
        cname: resolvedHostname ?? null,
      });
    } catch {
      // Best-effort cname sync
    }
  }

  try {
    const { data } = await gh.repos.getPages({ owner, repo });
    if (resolvedHostname) return `https://${resolvedHostname}/`;
    return data.html_url ?? pagesUrl(owner, repo);
  } catch {
    if (resolvedHostname) return `https://${resolvedHostname}/`;
    return pagesUrl(owner, repo);
  }
}

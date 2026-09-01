export const OPEN_PAGES_MANIFEST_PATH = "manifest.json";
export const OPEN_PAGES_README_PATH = "README.md";
export const OPEN_PAGES_MANIFEST_SCHEMA = "open-pages.site/v1";
/** Public source of the Open Pages project — linked from published READMEs. */
export const OPEN_PAGES_SOURCE_URL = "https://github.com/cocofhu/open-pages";
export const OPEN_PAGES_REPO_DESCRIPTION = "Published with Open Pages — Typora-like Markdown → Hexo → GitHub Pages";

export interface OpenPagesSiteManifest {
  schema: typeof OPEN_PAGES_MANIFEST_SCHEMA;
  siteId: string;
  tool: "open-pages";
  updatedAt: string;
}

export type PublishRepoReason =
  | "new"
  | "bound"
  | "adoptable"
  | "foreign"
  | "bound-other"
  | "invalid-manifest";

export interface PublishRepoCheck {
  eligible: boolean;
  reason: PublishRepoReason;
  message: string;
}

const FOREIGN_ROOT_MARKERS = new Set([
  "_config.yml",
  "source",
  "scaffolds",
  "themes",
  "package.json",
  "db.json",
]);

export function createOpenPagesSiteManifest(siteId: string, updatedAt = new Date()): OpenPagesSiteManifest {
  return {
    schema: OPEN_PAGES_MANIFEST_SCHEMA,
    siteId,
    tool: "open-pages",
    updatedAt: updatedAt.toISOString(),
  };
}

export function serializeOpenPagesSiteManifest(manifest: OpenPagesSiteManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

export function parseOpenPagesSiteManifest(raw: string): OpenPagesSiteManifest | null {
  try {
    const data = JSON.parse(raw) as Partial<OpenPagesSiteManifest>;
    if (data.schema !== OPEN_PAGES_MANIFEST_SCHEMA) return null;
    if (data.tool !== "open-pages") return null;
    if (typeof data.siteId !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(data.siteId)) return null;
    if (typeof data.updatedAt !== "string" || Number.isNaN(Date.parse(data.updatedAt))) return null;
    return {
      schema: OPEN_PAGES_MANIFEST_SCHEMA,
      siteId: data.siteId,
      tool: "open-pages",
      updatedAt: data.updatedAt,
    };
  } catch {
    return null;
  }
}

export function manifestMatchesSite(manifest: OpenPagesSiteManifest, siteId: string): boolean {
  return manifest.siteId === siteId;
}

/** Root entries that indicate a non–Open Pages Hexo/site tree without our manifest. */
export function repoRootLooksForeign(entries: string[]): boolean {
  return entries.some((entry) => FOREIGN_ROOT_MARKERS.has(entry.replace(/\/$/, "")));
}

export function publishRepoCheckMessage(reason: PublishRepoReason, detail?: string): string {
  switch (reason) {
    case "new":
      return "将新建一个仓库，并标记为 Open Pages 站点。";
    case "bound":
      return "这是当前站点的仓库，可以安全发布。";
    case "adoptable":
      return "仓库可用，发布后会标记为 Open Pages 站点。";
    case "foreign":
      return detail ?? "这个仓库里已有其他项目内容，为避免覆盖，不能在这里发布。请新建仓库，或选择你之前用 Open Pages 发布过的仓库。";
    case "bound-other":
      return detail ?? "这个仓库已绑定其他 Open Pages 站点，请换一个仓库。";
    case "invalid-manifest":
      return detail ?? "无法确认这个仓库是否属于 Open Pages，请换一个仓库或新建。";
  }
}

export function openPagesManifestFile(siteId: string): { path: string; content: string } {
  return {
    path: OPEN_PAGES_MANIFEST_PATH,
    content: serializeOpenPagesSiteManifest(createOpenPagesSiteManifest(siteId)),
  };
}

export function buildOpenPagesReadme(options: {
  title: string;
  description?: string;
  pagesUrl: string;
  theme?: string;
  owner: string;
  repo: string;
}): string {
  const title = options.title.trim() || options.repo;
  const description = options.description?.trim();
  const theme = options.theme?.trim();
  const lines = [
    `# ${title}`,
    "",
    ...(description ? [description, ""] : []),
    `- **站点**：${options.pagesUrl}`,
    `- **仓库**：https://github.com/${options.owner}/${options.repo}`,
    `- **源码分支**：\`main\` · **站点分支**：\`gh-pages\``,
    ...(theme ? [`- **主题**：${theme}`] : []),
    "",
    "---",
    "",
    `本仓库由 [${OPEN_PAGES_SOURCE_URL}](${OPEN_PAGES_SOURCE_URL}) 发布。`,
    "",
  ];
  return lines.join("\n");
}

export function openPagesReadmeFile(options: {
  title: string;
  description?: string;
  pagesUrl: string;
  theme?: string;
  owner: string;
  repo: string;
}): { path: string; content: string } {
  return {
    path: OPEN_PAGES_README_PATH,
    content: buildOpenPagesReadme(options),
  };
}

export function assessRepoRootForPublish(options: {
  siteId: string;
  manifestRaw: string | null;
  rootEntries: string[];
}): PublishRepoCheck {
  if (options.manifestRaw != null) {
    const manifest = parseOpenPagesSiteManifest(options.manifestRaw);
    if (!manifest) {
      return {
        eligible: false,
        reason: "invalid-manifest",
        message: publishRepoCheckMessage("invalid-manifest"),
      };
    }
    if (!manifestMatchesSite(manifest, options.siteId)) {
      return {
        eligible: false,
        reason: "bound-other",
        message: publishRepoCheckMessage(
          "bound-other",
          `这个仓库已绑定站点「${manifest.siteId}」，与当前站点不一致。`,
        ),
      };
    }
    return {
      eligible: true,
      reason: "bound",
      message: publishRepoCheckMessage("bound"),
    };
  }

  if (repoRootLooksForeign(options.rootEntries)) {
    return {
      eligible: false,
      reason: "foreign",
      message: publishRepoCheckMessage("foreign"),
    };
  }

  return {
    eligible: true,
    reason: "adoptable",
    message: publishRepoCheckMessage("adoptable"),
  };
}

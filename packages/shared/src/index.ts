export {
  defaultThemeSettings,
  defaultSettingsForFields,
  isThemeConfigPath,
  parseThemeSettings,
  pluginConfigPath,
  resolvedColorScheme,
  serializeThemeSettings,
  themeConfigPath,
  themeSettingFields,
  type ThemeSettingField,
  type ThemeSettingValue,
  type ThemeSettings,
} from "./theme-settings.js";
export {
  OPEN_PAGES_MANIFEST_PATH,
  OPEN_PAGES_MANIFEST_SCHEMA,
  OPEN_PAGES_README_PATH,
  OPEN_PAGES_REPO_DESCRIPTION,
  OPEN_PAGES_SOURCE_URL,
  assessRepoRootForPublish,
  buildOpenPagesReadme,
  createOpenPagesSiteManifest,
  manifestMatchesSite,
  openPagesManifestFile,
  openPagesReadmeFile,
  parseOpenPagesSiteManifest,
  publishRepoCheckMessage,
  repoRootLooksForeign,
  serializeOpenPagesSiteManifest,
  type OpenPagesSiteManifest,
  type PublishRepoCheck,
  type PublishRepoReason,
} from "./site-manifest.js";
import {
  isThemeConfigPath,
  themeSettingFields,
  type ThemeSettingField,
} from "./theme-settings.js";

export const THEMES = [
  "landscape",
  "cactus",
  "next",
  "kaze",
  "stellar",
  "reimu",
  "particlex",
  "stun",
  "white",
  "tranquility",
  "async",
  "apollo",
  "inside",
] as const;
export type BuiltinThemeId = (typeof THEMES)[number];
export type ThemeId = string;

export const THEME_META: Record<
  string,
  { label: string; packageName: string; description: string }
> = {
  landscape: {
    label: "Landscape",
    packageName: "hexo-theme-landscape",
    description: "Hexo 默认主题，简洁杂志风",
  },
  cactus: {
    label: "Cactus",
    packageName: "hexo-theme-cactus",
    description: "深色极简，适合技术笔记",
  },
  next: {
    label: "NexT",
    packageName: "hexo-theme-next",
    description: "功能完整的博客主题",
  },
  kaze: {
    label: "Kaze",
    packageName: "hexo-theme-kaze",
    description: "轻盈清爽的日系风格",
  },
  stellar: {
    label: "Stellar",
    packageName: "hexo-theme-stellar",
    description: "优雅强大，适合知识笔记",
  },
  reimu: {
    label: "Reimu",
    packageName: "hexo-theme-reimu",
    description: "灵梦风格，活泼灵动",
  },
  particlex: {
    label: "ParticleX",
    packageName: "hexo-theme-particlex",
    description: "粒子背景，视觉感强",
  },
  stun: {
    label: "Stun",
    packageName: "hexo-theme-stun",
    description: "漂亮简洁的博客主题",
  },
  white: {
    label: "White",
    packageName: "hexo-theme-white",
    description: "极简白净，干净利落",
  },
  tranquility: {
    label: "Tranquility",
    packageName: "hexo-theme-tranquility",
    description: "致远，适合个人主页",
  },
  async: {
    label: "Async",
    packageName: "hexo-theme-async",
    description: "轻量现代，注重阅读",
  },
  apollo: {
    label: "Apollo",
    packageName: "hexo-theme-apollo",
    description: "受 vuejs.org 启发的极简风",
  },
  inside: {
    label: "Inside",
    packageName: "hexo-theme-inside",
    description: "扁平 SPA，干净利落",
  },
};

export type AddonKind = "theme" | "plugin";
export type AddonSource =
  | { type: "builtin"; packageName: string; version: string }
  | { type: "npm"; packageName: string; version: string }
  | { type: "github"; packageName: string; repo: string; ref?: string };

export interface AddonManifest {
  id: string;
  kind: AddonKind;
  packageName: string;
  label: string;
  description: string;
  source: AddonSource;
  settings: ThemeSettingField[];
  builtin: boolean;
  core?: boolean;
  enabled?: boolean;
  tint?: { ink: string; paper: string };
}

export const BUILTIN_ADDONS: AddonManifest[] = [
  ...THEMES.map((id) => ({
    id,
    kind: "theme" as const,
    packageName: THEME_META[id].packageName,
    label: THEME_META[id].label,
    description: THEME_META[id].description,
    source: { type: "builtin" as const, packageName: THEME_META[id].packageName, version: "" },
    settings: themeSettingFields(id),
    builtin: true,
  })),
  ...[
    ["hexo-renderer-marked", true, "Markdown 渲染"],
    ["hexo-renderer-ejs", true, "EJS 模板渲染"],
    ["hexo-renderer-pug", true, "Pug 模板渲染"],
    ["hexo-renderer-stylus", true, "Stylus 样式渲染"],
    ["hexo-generator-index", true, "首页生成"],
    ["hexo-generator-archive", true, "归档页生成"],
    ["hexo-generator-category", true, "分类页生成"],
    ["hexo-generator-tag", true, "标签页生成"],
    ["hexo-generator-feed", false, "RSS / Atom 订阅"],
    ["hexo-generator-search", false, "站内搜索索引"],
    ["hexo-wordcount", false, "文章字数与阅读时间"],
  ].map(([packageName, core, description]) => ({
    id: String(packageName),
    kind: "plugin" as const,
    packageName: String(packageName),
    label: String(packageName).replace(/^hexo-/, ""),
    description: String(description),
    source: { type: "builtin" as const, packageName: String(packageName), version: "" },
    settings: [],
    builtin: true,
    core: Boolean(core),
    enabled: true,
  })),
];

export interface FrontMatter {
  title: string;
  date: string;
  tags: string[];
  categories: string[];
  layout?: "post" | "page" | "draft";
}

export interface SiteConfig {
  title: string;
  subtitle: string;
  description: string;
  author: string;
  avatar: string;
  language: string;
  timezone: string;
  url: string;
  root: string;
  permalink: string;
  theme: ThemeId;
}

export type FileKind = "post" | "draft" | "page" | "image" | "config" | "other";

export interface SiteFile {
  path: string;
  content: string;
  encoding?: "utf8" | "base64";
}

export interface GithubBinding {
  owner: string;
  repo: string;
  defaultBranch: string;
  pagesUrl?: string;
}

export interface SiteSnapshot {
  id: string;
  name: string;
  config: SiteConfig;
  files: SiteFile[];
  github?: GithubBinding;
  updatedAt: number;
}

export const DEFAULT_SITE_CONFIG: SiteConfig = {
  title: "Open Pages",
  subtitle: "Write, preview, publish",
  description: "A Typora-like editor that publishes with Hexo to GitHub Pages.",
  author: "",
  avatar: "/images/avatar.svg",
  language: "zh-CN",
  timezone: "Asia/Shanghai",
  url: "http://localhost:8787",
  root: "/",
  permalink: ":year/:month/:day/:title/",
  theme: "landscape",
};

export const WELCOME_POST_PATH = "source/_posts/hello-open-pages.md";

export function defaultFrontMatter(title = "Untitled"): FrontMatter {
  return {
    title,
    date: formatHexoDate(new Date()),
    tags: [],
    categories: [],
  };
}

export function formatHexoDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function slugify(input: string): string {
  const slug = input
    .trim()
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || `post-${Date.now()}`;
}

export function fileKind(path: string): FileKind {
  const normalized = path.replaceAll("\\", "/");
  if (normalized === "_config.yml" || isThemeConfigPath(normalized)) return "config";
  if (/\.(png|jpe?g|gif|webp|svg)$/i.test(normalized)) return "image";
  if (normalized.startsWith("source/_posts/")) return "post";
  if (normalized.startsWith("source/_drafts/")) return "draft";
  if (normalized.startsWith("source/") && normalized.endsWith(".md")) return "page";
  return "other";
}

export function isUserEditablePath(path: string): boolean {
  const normalized = path.replaceAll("\\", "/");
  if (normalized.includes("..")) return false;
  if (normalized === "_config.yml" || isThemeConfigPath(normalized)) return true;
  return (
    normalized.startsWith("source/") &&
    !normalized.startsWith("source/_data/") &&
    !normalized.includes("/themes/")
  );
}

const WORKSPACE_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/;

export function isSafeSiteId(value: string): boolean {
  return WORKSPACE_ID.test(value);
}

export function isSafeWorkspaceId(value: string): boolean {
  return WORKSPACE_ID.test(value);
}

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === "string" && /^[a-z][a-z0-9-]{0,79}$/.test(value);
}

export function parseRepoName(name: unknown): string {
  if (typeof name !== "string") throw new Error("Invalid repository name");
  const trimmed = name.trim();
  if (
    !/^[A-Za-z0-9._-]{1,100}$/.test(trimmed) ||
    trimmed.includes("..") ||
    trimmed.startsWith(".") ||
    trimmed.endsWith(".")
  ) {
    throw new Error("Invalid repository name");
  }
  return trimmed;
}

export function parseSiteConfig(input: unknown): SiteConfig {
  if (!input || typeof input !== "object") {
    throw new Error("Invalid site config");
  }
  const raw = input as Record<string, unknown>;
  if (!isThemeId(raw.theme)) {
    throw new Error("Invalid theme");
  }
  const field = (key: keyof SiteConfig, fallback: string, max = 500): string => {
    const value = raw[key];
    const next = typeof value === "string" ? value : fallback;
    if (/[\r\n\0]/.test(next)) throw new Error(`Invalid ${key}`);
    if (next.length > max) throw new Error(`${key} too long`);
    return next;
  };
  return {
    title: field("title", DEFAULT_SITE_CONFIG.title),
    subtitle: field("subtitle", DEFAULT_SITE_CONFIG.subtitle),
    description: field("description", DEFAULT_SITE_CONFIG.description, 2000),
    author: field("author", DEFAULT_SITE_CONFIG.author),
    avatar: field("avatar", DEFAULT_SITE_CONFIG.avatar, 2000),
    language: field("language", DEFAULT_SITE_CONFIG.language, 32),
    timezone: field("timezone", DEFAULT_SITE_CONFIG.timezone, 64),
    url: field("url", DEFAULT_SITE_CONFIG.url, 300),
    root: field("root", DEFAULT_SITE_CONFIG.root, 200),
    permalink: field("permalink", DEFAULT_SITE_CONFIG.permalink, 200),
    theme: raw.theme,
  };
}

export function parseFrontMatter(raw: string): { matter: FrontMatter; body: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    return { matter: defaultFrontMatter(), body: raw };
  }
  const parsed = parseSimpleYaml(match[1] ?? "");
  const tags = asStringArray(parsed.tags);
  const categories = asStringArray(parsed.categories);
  const layout = parsed.layout === "page" || parsed.layout === "draft" ? parsed.layout : "post";
  return {
    matter: {
      title: String(parsed.title ?? "Untitled"),
      date: String(parsed.date ?? formatHexoDate(new Date())),
      tags,
      categories,
      layout,
    },
    body: match[2] ?? "",
  };
}

export function serializeFrontMatter(matter: FrontMatter, body: string): string {
  const lines = [
    "---",
    `title: ${yamlQuote(matter.title)}`,
    `date: ${matter.date}`,
  ];
  if (matter.layout && matter.layout !== "post") {
    lines.push(`layout: ${matter.layout}`);
  }
  lines.push(yamlList("tags", matter.tags));
  lines.push(yamlList("categories", matter.categories));
  lines.push("---", "");
  return `${lines.join("\n")}${body.replace(/^\n/, "")}`;
}

export function applySiteConfigToYaml(config: SiteConfig, existing = ""): string {
  const keep = existing.trim() ? existing : defaultHexoConfigYaml(config);
  const replacements: Array<[RegExp, string]> = [
    [/^title:.*$/m, `title: ${yamlQuote(config.title)}`],
    [/^subtitle:.*$/m, `subtitle: ${yamlQuote(config.subtitle)}`],
    [/^description:.*$/m, `description: ${yamlQuote(config.description)}`],
    [/^author:.*$/m, `author: ${yamlQuote(config.author)}`],
    [/^avatar:.*$/m, `avatar: ${yamlQuote(config.avatar)}`],
    [/^language:.*$/m, `language: ${yamlQuote(config.language)}`],
    [/^timezone:.*$/m, `timezone: ${yamlQuote(config.timezone)}`],
    [/^url:.*$/m, `url: ${yamlQuote(config.url)}`],
    [/^root:.*$/m, `root: ${yamlQuote(config.root)}`],
    [/^permalink:.*$/m, `permalink: ${yamlQuote(config.permalink)}`],
    [/^theme:.*$/m, `theme: ${config.theme}`],
  ];
  let next = keep;
  for (const [pattern, value] of replacements) {
    next = pattern.test(next) ? next.replace(pattern, value) : `${next.trimEnd()}\n${value}\n`;
  }
  return next.endsWith("\n") ? next : `${next}\n`;
}

export function defaultHexoConfigYaml(config: SiteConfig): string {
  return `# generated by Open Pages
title: ${yamlQuote(config.title)}
subtitle: ${yamlQuote(config.subtitle)}
description: ${yamlQuote(config.description)}
keywords:
author: ${yamlQuote(config.author)}
avatar: ${yamlQuote(config.avatar)}
language: ${yamlQuote(config.language)}
timezone: ${yamlQuote(config.timezone)}
url: ${yamlQuote(config.url)}
root: ${yamlQuote(config.root)}
permalink: ${yamlQuote(config.permalink)}
permalink_defaults:
pretty_urls:
  trailing_index: true
  trailing_html: true
source_dir: source
public_dir: public
tag_dir: tags
archive_dir: archives
category_dir: categories
code_dir: downloads/code
i18n_dir: :lang
skip_render:
new_post_name: :title.md
default_layout: post
titlecase: false
external_link:
  enable: true
  field: site
  exclude: ''
filename_case: 0
render_drafts: false
post_asset_folder: false
relative_link: false
future: true
syntax_highlighter: highlight.js
highlight:
  enable: true
  line_number: true
  auto_detect: false
  tab_replace: ''
  wrap: true
  hljs: false
  exclude_languages:
    - mermaid
prismjs:
  enable: false
  preprocess: true
  line_number: true
  tab_replace: ''
index_generator:
  path: ''
  per_page: 10
  order_by: -date
topindex_generator:
  per_page: 10
default_category: uncategorized
category_map:
tag_map:
meta_generator: true
date_format: YYYY-MM-DD
time_format: HH:mm:ss
updated_option: mtime
per_page: 10
pagination_dir: page
include:
exclude:
ignore:
theme: ${config.theme}
marked:
  dompurify: true
  sanitizeUrl: true
feed:
  enable: true
  type: atom
  path: atom.xml
  limit: 20
  content: false
search:
  path: search.xml
  field: post
  content: true
deploy:
`;
}

export function welcomeMarkdown(): string {
  return serializeFrontMatter(
    {
      title: "Hello Open Pages",
      date: formatHexoDate(new Date()),
      tags: ["open-pages"],
      categories: ["Welcome"],
    },
    [
      "",
      "在这里用 **Typora 式** 所见即所得写 Markdown。",
      "",
      "- 左侧管理文章、草稿和页面",
      "- 顶部可切换源码 / Hexo 预览",
      "- 登录 GitHub 后一键发布到 GitHub Pages",
      "",
      "## 写作",
      "",
      "支持标题、列表、引用、代码和图片。",
      "",
      "```ts",
      'console.log("publish with hexo");',
      "```",
      "",
      "> 预览来自真实的 `hexo generate`，不是前端 Markdown 渲染。",
      "",
    ].join("\n"),
  );
}

export function aboutPageMarkdown(): string {
  return serializeFrontMatter(
    {
      title: "About",
      date: formatHexoDate(new Date()),
      tags: [],
      categories: [],
      layout: "page",
    },
    "\n这是一个由 Open Pages 生成的 Hexo 站点。\n",
  );
}

function yamlQuote(value: string): string {
  if (value === "") return '""';
  if (
    /^(?:~|null|true|false|yes|no|on|off|auto|default|undefined)$/i.test(value) ||
    /[:#{}[\],&*?|<>=!%@`]/.test(value) ||
    value.includes("\n")
  ) {
    return JSON.stringify(value);
  }
  return value;
}

function yamlList(key: string, values: string[]): string {
  if (!values.length) return `${key}:`;
  return `${key}:\n${values.map((item) => `  - ${yamlQuote(item)}`).join("\n")}`;
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item)).filter(Boolean);
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return [];
}

function parseSimpleYaml(input: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  let currentList: string[] | null = null;
  let currentKey = "";
  for (const rawLine of input.split(/\r?\n/)) {
    if (/^\s*-\s+/.test(rawLine) && currentList) {
      currentList.push(rawLine.replace(/^\s*-\s+/, "").replace(/^["']|["']$/g, ""));
      continue;
    }
    const match = rawLine.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (!match) continue;
    currentKey = match[1] ?? "";
    const rest = (match[2] ?? "").trim();
    if (rest === "") {
      currentList = [];
      result[currentKey] = currentList;
    } else if (rest.startsWith("[") && rest.endsWith("]")) {
      currentList = null;
      result[currentKey] = rest
        .slice(1, -1)
        .split(",")
        .map((item) => item.trim().replace(/^["']|["']$/g, ""))
        .filter(Boolean);
    } else {
      currentList = null;
      result[currentKey] = rest.replace(/^["']|["']$/g, "");
    }
  }
  return result;
}

export function pagesUrl(owner: string, repo: string): string {
  if (repo.toLowerCase() === `${owner.toLowerCase()}.github.io`) {
    return `https://${owner}.github.io/`;
  }
  return `https://${owner}.github.io/${repo}/`;
}

export function pagesRoot(owner: string, repo: string): string {
  if (repo.toLowerCase() === `${owner.toLowerCase()}.github.io`) return "/";
  return `/${repo}/`;
}

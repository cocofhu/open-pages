/**
 * Smoke: preview with sourcePath returns the document permalink; without it returns root.
 * Evidence for plan g1.1 / g1.2 / g1.3.
 */
import {
  DEFAULT_SITE_CONFIG,
  WELCOME_POST_PATH,
  aboutPageMarkdown,
  welcomeMarkdown,
} from "./packages/shared/src/index.ts";
import { previewSite, resetSite } from "./apps/api/src/lib/workspace.ts";

const owner = `verify-preview-path-${Date.now()}`;
const siteId = "default";
const files = [
  { path: WELCOME_POST_PATH, content: welcomeMarkdown(), encoding: "utf8" as const },
  { path: "source/about/index.md", content: aboutPageMarkdown(), encoding: "utf8" as const },
  {
    path: "source/_drafts/smoke-draft.md",
    content: `---\ntitle: Smoke Draft\ndate: 2026-09-06 12:00:00\n---\n\nDraft body for preview.\n`,
    encoding: "utf8" as const,
  },
];

try {
  const home = await previewSite(owner, siteId, files, DEFAULT_SITE_CONFIG);
  const homePath = new URL(home.url).pathname;
  if (!/^\/preview\/[^/]+\/?$/.test(homePath)) {
    throw new Error(`home preview url should be site root, got ${home.url}`);
  }
  console.log("HOME_OK", home.url);

  const article = await previewSite(owner, siteId, files, DEFAULT_SITE_CONFIG, WELCOME_POST_PATH);
  const articlePath = new URL(article.url).pathname;
  if (!/hello-open-pages/.test(articlePath)) {
    throw new Error(`article preview missing permalink, got ${article.url}`);
  }
  if (/^\/preview\/[^/]+\/?$/.test(articlePath)) {
    throw new Error(`article preview stayed on root: ${article.url}`);
  }
  console.log("ARTICLE_OK", article.url);

  const about = await previewSite(owner, siteId, files, DEFAULT_SITE_CONFIG, "source/about/index.md");
  if (!/\/about\/?$/.test(new URL(about.url).pathname)) {
    throw new Error(`about preview missing /about/, got ${about.url}`);
  }
  console.log("ABOUT_OK", about.url);

  const draft = await previewSite(
    owner,
    siteId,
    files,
    DEFAULT_SITE_CONFIG,
    "source/_drafts/smoke-draft.md",
  );
  if (!/smoke-draft/.test(new URL(draft.url).pathname)) {
    throw new Error(`draft preview missing permalink, got ${draft.url}`);
  }
  console.log("DRAFT_OK", draft.url);

  let failed = false;
  try {
    await previewSite(owner, siteId, files, DEFAULT_SITE_CONFIG, "source/_posts/missing.md");
  } catch (error) {
    failed = error instanceof Error && /找不到当前文档的预览页/.test(error.message);
  }
  if (!failed) throw new Error("missing sourcePath should fail without falling back to home");
  console.log("MISS_OK");

  console.log("PREVIEW_PATH_OK");
} finally {
  await resetSite(owner, siteId).catch(() => undefined);
}

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assessRepoRootForPublish,
  buildOpenPagesReadme,
  createOpenPagesSiteManifest,
  OPEN_PAGES_SOURCE_URL,
  parseOpenPagesSiteManifest,
  repoRootLooksForeign,
  serializeOpenPagesSiteManifest,
} from "./site-manifest.js";

test("parseOpenPagesSiteManifest accepts valid manifest", () => {
  const raw = serializeOpenPagesSiteManifest(createOpenPagesSiteManifest("default"));
  const parsed = parseOpenPagesSiteManifest(raw);
  assert.equal(parsed?.siteId, "default");
  assert.equal(parsed?.schema, "open-pages.site/v1");
});

test("assessRepoRootForPublish blocks foreign repos without manifest", () => {
  const check = assessRepoRootForPublish({
    siteId: "default",
    manifestRaw: null,
    rootEntries: ["README.md", "_config.yml", "source"],
  });
  assert.equal(check.eligible, false);
  assert.equal(check.reason, "foreign");
});

test("assessRepoRootForPublish allows adoptable empty repo", () => {
  const check = assessRepoRootForPublish({
    siteId: "default",
    manifestRaw: null,
    rootEntries: ["README.md"],
  });
  assert.equal(check.eligible, true);
  assert.equal(check.reason, "adoptable");
});

test("assessRepoRootForPublish blocks mismatched manifest siteId", () => {
  const raw = serializeOpenPagesSiteManifest(createOpenPagesSiteManifest("other-site"));
  const check = assessRepoRootForPublish({
    siteId: "default",
    manifestRaw: raw,
    rootEntries: ["manifest.json", "_config.yml"],
  });
  assert.equal(check.eligible, false);
  assert.equal(check.reason, "bound-other");
});

test("repoRootLooksForeign detects hexo markers", () => {
  assert.equal(repoRootLooksForeign(["README.md"]), false);
  assert.equal(repoRootLooksForeign(["package.json"]), true);
});

test("buildOpenPagesReadme includes site info and project link", () => {
  const md = buildOpenPagesReadme({
    title: "Open Pages",
    description: "Write, preview, publish",
    pagesUrl: "https://cocofhu.github.io/just-test/",
    theme: "next",
    owner: "cocofhu",
    repo: "just-test",
  });
  assert.match(md, /^# Open Pages/m);
  assert.match(md, /Write, preview, publish/);
  assert.match(md, /https:\/\/cocofhu\.github\.io\/just-test\//);
  assert.match(md, /https:\/\/github\.com\/cocofhu\/just-test/);
  assert.match(md, /\*\*主题\*\*：next/);
  assert.match(md, new RegExp(OPEN_PAGES_SOURCE_URL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

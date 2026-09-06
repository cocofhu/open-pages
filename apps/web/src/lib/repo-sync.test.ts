import assert from "node:assert/strict";
import { test } from "node:test";
import { WELCOME_POST_PATH } from "@open-pages/shared";
import {
  blankSiteSeedFiles,
  isLiveImportPath,
  livePathsMissingFromSnapshot,
} from "./repo-sync.js";
import { switchRepoConfirmCopy } from "./repo-onboarding-copy.js";

test("livePathsMissingFromSnapshot drops posts absent from the new repo", () => {
  const existing = [
    "source/_posts/old-only.md",
    "source/_posts/shared.md",
    "source/about/index.md",
    "_config.yml",
    "source/origin/source/_posts/old-only.md",
    "README.md",
  ];
  const snapshot = ["source/_posts/shared.md", "_config.yml", "source/images/a.png"];
  assert.deepEqual(livePathsMissingFromSnapshot(existing, snapshot).sort(), [
    "source/_posts/old-only.md",
    "source/about/index.md",
  ]);
});

test("livePathsMissingFromSnapshot keeps only blank-site seeds when snapshot is empty", () => {
  const existing = [
    "source/_posts/old.md",
    "source/_drafts/wip.md",
    "source/about/index.md",
    "_config.yml",
    WELCOME_POST_PATH,
  ];
  const seeds = blankSiteSeedFiles().map((file) => file.path);
  const removed = livePathsMissingFromSnapshot(existing, seeds);
  assert.ok(removed.includes("source/_posts/old.md"));
  assert.ok(removed.includes("source/_drafts/wip.md"));
  assert.ok(!removed.includes(WELCOME_POST_PATH));
  assert.ok(!removed.includes("_config.yml"));
  assert.ok(!removed.includes("source/about/index.md"));
});

test("blankSiteSeedFiles matches product default site paths", () => {
  const paths = blankSiteSeedFiles().map((file) => file.path).sort();
  assert.deepEqual(paths, ["_config.yml", "source/about/index.md", WELCOME_POST_PATH].sort());
  for (const file of blankSiteSeedFiles()) {
    assert.equal(file.encoding, "utf8");
    assert.ok(file.content.length > 0);
  }
});

test("isLiveImportPath ignores origin and manifest", () => {
  assert.equal(isLiveImportPath("source/_posts/a.md"), true);
  assert.equal(isLiveImportPath("_config.yml"), true);
  assert.equal(isLiveImportPath("source/origin/_config.yml"), false);
  assert.equal(isLiveImportPath("README.md"), false);
  assert.equal(isLiveImportPath("manifest.json"), false);
});

test("switchRepoConfirmCopy names the target existing repo", () => {
  const copy = switchRepoConfirmCopy({ owner: "alice", repo: "new-blog", createRepo: false });
  assert.equal(copy.title, "切换到新仓库？");
  assert.equal(copy.confirmLabel, "覆盖并切换");
  assert.match(copy.message, /alice\/new-blog/);
  assert.match(copy.message, /还没发布的改动会丢掉/);
});

test("switchRepoConfirmCopy names the new repo and blank reset", () => {
  const copy = switchRepoConfirmCopy({ owner: "alice", repo: "fresh", createRepo: true });
  assert.equal(copy.title, "创建新仓库并重置本地？");
  assert.equal(copy.confirmLabel, "重置并创建");
  assert.match(copy.message, /alice\/fresh/);
  assert.match(copy.message, /空白站点/);
  assert.match(copy.message, /不会带到新仓库/);
});

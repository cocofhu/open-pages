import assert from "node:assert/strict";
import { test } from "node:test";
import { WELCOME_POST_PATH, originSnapshotPath } from "@open-pages/shared";
import {
  blankSiteSeedFiles,
  isLiveImportPath,
  livePathsMissingFromSnapshot,
  originSnapshotsFromLive,
  unpublishedRepoChangesFromFiles,
} from "./repo-sync.js";
import { logoutWipeConfirmCopy, switchRepoConfirmCopy } from "./repo-onboarding-copy.js";

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

test("originSnapshotsFromLive only backs up live import paths (plan g2.1)", () => {
  const snapshots = originSnapshotsFromLive([
    { path: "source/_posts/a.md", content: "post", encoding: "utf8" },
    { path: "_config.yml", content: "title: t", encoding: "utf8" },
    { path: "README.md", content: "# hi", encoding: "utf8" },
    { path: "manifest.json", content: "{}", encoding: "utf8" },
    { path: "source/origin/_config.yml", content: "stale", encoding: "utf8" },
  ]);
  assert.deepEqual(
    snapshots.map((f) => f.path).sort(),
    ["source/origin/_config.yml", "source/origin/source/_posts/a.md"].sort(),
  );
  assert.ok(!snapshots.some((f) => f.path.includes("README") || f.path.includes("manifest")));
});

test("unpublishedRepoChangesFromFiles: no origin + live => dirty (plan f5)", () => {
  assert.equal(
    unpublishedRepoChangesFromFiles([
      { path: "_config.yml", content: "x", encoding: "utf8" },
      { path: WELCOME_POST_PATH, content: "y", encoding: "utf8" },
    ]),
    true,
  );
});

test("unpublishedRepoChangesFromFiles: matching origin => clean after refresh (plan g2.2)", () => {
  const live = [
    { path: "_config.yml", content: "title: ok", encoding: "utf8" as const },
    { path: "source/_posts/a.md", content: "hi", encoding: "utf8" as const },
  ];
  const withOrigin = [...live, ...originSnapshotsFromLive(live)];
  assert.equal(unpublishedRepoChangesFromFiles(withOrigin), false);
});

test("unpublishedRepoChangesFromFiles: edited live => dirty", () => {
  const files = [
    { path: "_config.yml", content: "title: new", encoding: "utf8" },
    { path: "source/origin/_config.yml", content: "title: old", encoding: "utf8" },
  ];
  assert.equal(unpublishedRepoChangesFromFiles(files), true);
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

// --- Plan g1.4: origin baseline after publish / blank seed ---

test("originSnapshotsFromLive maps editable files under source/origin (g1.1)", () => {
  const live = [
    { path: "_config.yml", content: "title: A", encoding: "utf8" as const },
    { path: WELCOME_POST_PATH, content: "# hi", encoding: "utf8" as const },
    { path: "README.md", content: "ignore", encoding: "utf8" as const },
  ];
  const origins = originSnapshotsFromLive(live);
  assert.deepEqual(
    origins.map((file) => file.path).sort(),
    [originSnapshotPath("_config.yml"), originSnapshotPath(WELCOME_POST_PATH)].sort(),
  );
  assert.equal(origins.find((file) => file.path === originSnapshotPath("_config.yml"))?.content, "title: A");
});

test("blank seed + matching origin reports no unpublished changes (g1.2)", () => {
  const seeds = blankSiteSeedFiles();
  const files = [...seeds, ...originSnapshotsFromLive(seeds)];
  assert.equal(unpublishedRepoChangesFromFiles(files), false);
});

test("no origin baseline with live files is unpublished (g1.2 forever-warn)", () => {
  assert.equal(unpublishedRepoChangesFromFiles(blankSiteSeedFiles()), true);
});

test("publish-success baseline then edit returns unpublished (g1.4)", () => {
  const seeds = blankSiteSeedFiles();
  const baseline = [...seeds, ...originSnapshotsFromLive(seeds)];
  assert.equal(unpublishedRepoChangesFromFiles(baseline), false);

  const edited = baseline.map((file) =>
    file.path === WELCOME_POST_PATH ? { ...file, content: `${file.content}\nextra` } : file,
  );
  assert.equal(unpublishedRepoChangesFromFiles(edited), true);
});

test("failed publish keeps old origin (g1.4) — comparing unchanged files stays dirty if origin differs", () => {
  const live = blankSiteSeedFiles();
  const staleOrigin = originSnapshotsFromLive(live).map((file) => ({
    ...file,
    content: `${file.content}\nOLD`,
  }));
  assert.equal(unpublishedRepoChangesFromFiles([...live, ...staleOrigin]), true);
});

// --- Plan g2.4: logout confirm copy ---

test("logoutWipeConfirmCopy explains local wipe and keeps GitHub (g2.1)", () => {
  const copy = logoutWipeConfirmCopy();
  assert.equal(copy.title, "退出并清空本地？");
  assert.equal(copy.confirmLabel, "退出并清空");
  assert.match(copy.message, /绑定/);
  assert.match(copy.message, /删除本机/);
  assert.match(copy.message, /不会删除.*GitHub/);
});

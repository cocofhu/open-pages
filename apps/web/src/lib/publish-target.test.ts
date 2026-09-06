import assert from "node:assert/strict";
import { test } from "node:test";
import type { GithubBinding } from "@open-pages/shared";
import { bindingAfterPublish, resolvePublishTarget } from "./publish-target.js";

const binding: GithubBinding = {
  owner: "alice",
  repo: "my-site",
  defaultBranch: "main",
  pagesUrl: "https://alice.github.io/my-site/",
};

test("resolvePublishTarget returns bound owner/repo only", () => {
  assert.deepEqual(resolvePublishTarget(binding), { owner: "alice", repo: "my-site" });
});

test("resolvePublishTarget is null when unbound", () => {
  assert.equal(resolvePublishTarget(undefined), null);
  assert.equal(resolvePublishTarget({ ...binding, owner: "", repo: "x" }), null);
  assert.equal(resolvePublishTarget({ ...binding, owner: "a", repo: "  " }), null);
});

test("bindingAfterPublish keeps owner/repo and refreshes pagesUrl", () => {
  const next = bindingAfterPublish(binding, {
    owner: "other",
    repo: "hijack",
    url: "https://alice.github.io/my-site/",
  });
  assert.equal(next.owner, "alice");
  assert.equal(next.repo, "my-site");
  assert.equal(next.pagesUrl, "https://alice.github.io/my-site/");
  assert.equal(next.defaultBranch, "main");
});

test("bindingAfterPublish creates binding only when previously unbound", () => {
  const next = bindingAfterPublish(undefined, {
    owner: "bob",
    repo: "blog",
    url: "https://bob.github.io/blog/",
  });
  assert.deepEqual(next, {
    owner: "bob",
    repo: "blog",
    defaultBranch: "main",
    pagesUrl: "https://bob.github.io/blog/",
  });
});

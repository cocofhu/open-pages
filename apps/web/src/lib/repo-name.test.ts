import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assessNewRepoName } from "./repo-name";

describe("assessNewRepoName", () => {
  it("rejects empty and illegal names", () => {
    assert.equal(assessNewRepoName("", []).eligible, false);
    assert.equal(assessNewRepoName("..bad", []).eligible, false);
    assert.equal(assessNewRepoName(".starts", []).eligible, false);
    assert.equal(assessNewRepoName("ends.", []).eligible, false);
    assert.equal(assessNewRepoName("has space", []).eligible, false);
  });

  it("rejects names that already exist in the list (case-insensitive)", () => {
    const check = assessNewRepoName("Blog", [{ name: "blog", fullName: "me/blog" }], {
      forOnboarding: true,
    });
    assert.equal(check.eligible, false);
    assert.match(check.message, /选择已有仓库/);
  });

  it("accepts a fresh legal name for onboarding", () => {
    const check = assessNewRepoName("me.github.io", [], { forOnboarding: true });
    assert.equal(check.eligible, true);
    assert.match(check.message, /可以|新建|空白/);
  });
});

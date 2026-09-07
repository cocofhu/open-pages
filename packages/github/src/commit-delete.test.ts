import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeDeleteTreeEntries } from "./index.js";

test("mergeDeleteTreeEntries emits sha=null delete entries (plan g3.1)", () => {
  const entries = mergeDeleteTreeEntries(
    ["source/origin/_config.yml", "source/origin/source/_posts/a.md", "LICENSE"],
    ["_config.yml"],
  );
  assert.deepEqual(entries, [
    { path: "source/origin/_config.yml", mode: "100644", type: "blob", sha: null },
    { path: "source/origin/source/_posts/a.md", mode: "100644", type: "blob", sha: null },
    { path: "LICENSE", mode: "100644", type: "blob", sha: null },
  ]);
});

test("mergeDeleteTreeEntries skips paths already written and empties", () => {
  const entries = mergeDeleteTreeEntries(
    ["source/origin/_config.yml", "", "source/_posts/a.md"],
    ["source/_posts/a.md"],
  );
  assert.deepEqual(
    entries.map((e) => e.path),
    ["source/origin/_config.yml"],
  );
  assert.equal(entries[0]?.sha, null);
});

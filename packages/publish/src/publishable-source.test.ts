import assert from "node:assert/strict";
import { test } from "node:test";
import { publishableSourceFiles } from "./index.js";

test("publishableSourceFiles excludes origin paths (plan g1.2)", () => {
  const filtered = publishableSourceFiles([
    { path: "source/_posts/a.md", content: "hi", encoding: "utf8" },
    { path: "source/origin/_config.yml", content: "title: x", encoding: "utf8" },
    { path: "source/origin/source/_posts/a.md", content: "old", encoding: "utf8" },
    { path: "_config.yml", content: "title: y", encoding: "utf8" },
  ]);
  assert.deepEqual(
    filtered.map((f) => f.path).sort(),
    ["_config.yml", "source/_posts/a.md"].sort(),
  );
});

test("publishableSourceFiles aligns with isUserEditablePath root constraint (plan g1.2 / g3.2)", async () => {
  const { isUserEditablePath } = await import("@open-pages/shared");
  const paths = [
    "source/_posts/a.md",
    "source/origin/_config.yml",
    "README.md",
    "_config.yml",
  ];
  for (const path of paths) {
    const inList = publishableSourceFiles([{ path, content: "", encoding: "utf8" }]).length > 0;
    assert.equal(inList, isUserEditablePath(path), path);
  }
});

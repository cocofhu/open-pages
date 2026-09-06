import assert from "node:assert/strict";
import { joinPreviewUrl, resolveSourcePermalink } from "./index.js";

const map = {
  "source/_posts/hello-open-pages.md": "2026/09/06/hello-open-pages/",
  "source/about/index.md": "about/",
  "source/_drafts/draft-preview-body.md": "2026/09/06/draft-preview-body/",
};

assert.equal(
  resolveSourcePermalink(map, "source/_posts/hello-open-pages.md"),
  "2026/09/06/hello-open-pages/",
);
assert.equal(resolveSourcePermalink(map, "_posts/hello-open-pages.md"), "2026/09/06/hello-open-pages/");
assert.equal(resolveSourcePermalink(map, "source/about/index.md"), "about/");
assert.equal(resolveSourcePermalink(map, "source/missing.md"), undefined);
assert.equal(
  joinPreviewUrl("http://localhost:8788/preview/abc/", "2026/09/06/hello-open-pages/"),
  "http://localhost:8788/preview/abc/2026/09/06/hello-open-pages/",
);
assert.equal(
  joinPreviewUrl("http://localhost:8788/preview/abc", "about/"),
  "http://localhost:8788/preview/abc/about/",
);

console.log("source-permalink.resolve ok");

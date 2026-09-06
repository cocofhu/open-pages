import assert from "node:assert/strict";
import { test } from "node:test";
import { resolvePublishCustomDomain } from "./index.js";

test("resolvePublishCustomDomain parses explicit hostname", async () => {
  const hostname = await resolvePublishCustomDomain("tok", "alice", "notes", "Blog.Example.COM");
  assert.equal(hostname, "blog.example.com");
});

test("resolvePublishCustomDomain treats empty string as clear", async () => {
  const hostname = await resolvePublishCustomDomain("tok", "alice", "notes", "  ");
  assert.equal(hostname, null);
});

test("resolvePublishCustomDomain rejects illegal host so CNAME cannot diverge", async () => {
  await assert.rejects(
    () => resolvePublishCustomDomain("tok", "alice", "notes", "https://bad.example.com"),
    /只填主机名/,
  );
});

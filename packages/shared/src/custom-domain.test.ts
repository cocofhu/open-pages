import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parseCustomDomain,
  publishUrlAndRoot,
  withCnameFile,
  pagesRoot,
  pagesUrl,
} from "./index.js";

test("parseCustomDomain accepts hostnames", () => {
  assert.deepEqual(parseCustomDomain("blog.example.com"), {
    ok: true,
    hostname: "blog.example.com",
  });
  assert.deepEqual(parseCustomDomain("Example.COM"), {
    ok: true,
    hostname: "example.com",
  });
  assert.deepEqual(parseCustomDomain(""), { ok: true, hostname: "" });
});

test("parseCustomDomain rejects scheme path and spaces", () => {
  assert.equal(parseCustomDomain("https://blog.example.com").ok, false);
  assert.equal(parseCustomDomain("blog.example.com/path").ok, false);
  assert.equal(parseCustomDomain("blog example.com").ok, false);
  assert.equal(parseCustomDomain("not_a_domain").ok, false);
});

test("publishUrlAndRoot uses custom domain root slash", () => {
  assert.deepEqual(publishUrlAndRoot("alice", "notes", "blog.example.com"), {
    url: "https://blog.example.com",
    root: "/",
    hostname: "blog.example.com",
  });
});

test("publishUrlAndRoot keeps project page path without domain", () => {
  assert.deepEqual(publishUrlAndRoot("alice", "notes"), {
    url: "https://alice.github.io/notes",
    root: "/notes/",
    hostname: null,
  });
  assert.equal(pagesRoot("alice", "notes"), "/notes/");
  assert.equal(pagesUrl("alice", "notes"), "https://alice.github.io/notes/");
});

test("publishUrlAndRoot keeps user page root without domain", () => {
  assert.deepEqual(publishUrlAndRoot("alice", "alice.github.io"), {
    url: "https://alice.github.io",
    root: "/",
    hostname: null,
  });
});

test("withCnameFile injects hostname and omits when empty", () => {
  const files = [
    { path: "index.html", content: "<html></html>" },
    { path: "CNAME", content: "old.example.com\n" },
  ];
  assert.deepEqual(withCnameFile(files, "blog.example.com"), [
    { path: "index.html", content: "<html></html>" },
    { path: "CNAME", content: "blog.example.com\n" },
  ]);
  assert.deepEqual(withCnameFile(files, null), [
    { path: "index.html", content: "<html></html>" },
  ]);
  assert.deepEqual(withCnameFile(files, ""), [
    { path: "index.html", content: "<html></html>" },
  ]);
});

#!/usr/bin/env node
/**
 * Runs hexo generate in an isolated child process so theme / plugin code
 * cannot touch the API process env (session secrets, GitHub tokens, etc.).
 */
import { createRequire } from "node:module";
import { resolve } from "node:path";

const siteDir = process.argv[2] ? resolve(process.argv[2]) : "";
if (!siteDir) {
  console.error("usage: generate-worker.mjs <siteDir>");
  process.exit(2);
}

const require = createRequire(import.meta.url);
const Hexo = require("hexo");
const GENERATE_TIMEOUT_MS = 60_000;

const hexo = new Hexo(siteDir, { silent: true, draft: false });
let timedOut = false;
const timer = setTimeout(() => {
  timedOut = true;
  console.error("hexo generate timed out");
  process.exit(124);
}, GENERATE_TIMEOUT_MS);

try {
  await hexo.init();
  await hexo.call("generate", { force: true, deploy: false });
  await hexo.exit();
  clearTimeout(timer);
  if (!timedOut) process.exit(0);
} catch (error) {
  clearTimeout(timer);
  console.error(error instanceof Error ? error.stack || error.message : error);
  try {
    await hexo.exit(error);
  } catch {
    // ignore
  }
  process.exit(1);
}

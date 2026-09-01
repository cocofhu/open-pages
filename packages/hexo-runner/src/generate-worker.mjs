#!/usr/bin/env node
/**
 * Runs hexo generate in an isolated child process so theme / plugin code
 * cannot touch the API process env (session secrets, GitHub tokens, etc.).
 */
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { resolve, sep } from "node:path";

const siteDir = process.argv[2] ? resolve(process.argv[2]) : "";
const publicRel = process.argv[3] ?? "public";
const plugins = JSON.parse(process.argv[4] ?? "[]");
if (!siteDir) {
  console.error("usage: generate-worker.mjs <siteDir> [publicDir]");
  process.exit(2);
}

const require = createRequire(import.meta.url);
const Hexo = require("hexo");
const { load: loadYaml } = require("js-yaml");
const { deepMerge } = require("hexo-util");
const GENERATE_TIMEOUT_MS = 60_000;

// Some themes conditionally register generators and filters from `env.cmd`.
// Match Hexo CLI semantics even though we invoke its API directly.
const hexo = new Hexo(siteDir, { draft: false, _: ["generate"] });
let timedOut = false;
const timer = setTimeout(() => {
  timedOut = true;
  console.error("hexo generate timed out");
  process.exit(124);
}, GENERATE_TIMEOUT_MS);

try {
  await hexo.init();
  const protectedConfig = {
    theme: hexo.config.theme,
    source_dir: hexo.config.source_dir,
    public_dir: hexo.config.public_dir,
    deploy: hexo.config.deploy,
  };
  for (const plugin of plugins) {
    const configPath = resolve(siteDir, `_config.plugin.${plugin.id}.yml`);
    if (existsSync(configPath)) {
      const config = loadYaml(readFileSync(configPath, "utf8"));
      if (config && typeof config === "object") hexo.config = deepMerge(hexo.config, config);
    }
  }
  Object.assign(hexo.config, protectedConfig);
  hexo.config.marked = {
    ...(hexo.config.marked ?? {}),
    dompurify: true,
    sanitizeUrl: true,
  };
  for (const plugin of plugins) {
    await hexo.loadPlugin(resolve(plugin.path));
  }
  // Redirect the output after init: hexo derives `public_dir` from the config
  // while loading it, so overriding earlier would be discarded.
  hexo.config.public_dir = publicRel;
  hexo.public_dir = resolve(siteDir, publicRel) + sep;
  await hexo.call("generate", { force: true, deploy: false });
  await hexo.exit();
  clearTimeout(timer);
  if (!timedOut) process.exitCode = 0;
} catch (error) {
  clearTimeout(timer);
  console.error(error instanceof Error ? error.stack || error.message : error);
  try {
    await hexo.exit(error);
  } catch {
    // ignore
  }
  process.exitCode = 1;
}

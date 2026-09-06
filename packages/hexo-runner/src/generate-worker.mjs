#!/usr/bin/env node
/**
 * Runs hexo generate in an isolated child process so theme / plugin code
 * cannot touch the API process env (session secrets, GitHub tokens, etc.).
 */
import { createRequire } from "node:module";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";

const siteDir = process.argv[2] ? resolve(process.argv[2]) : "";
const publicRel = process.argv[3] ?? "public";
const plugins = JSON.parse(process.argv[4] ?? "[]");
const workerOptions = JSON.parse(process.argv[5] ?? "{}");
if (!siteDir) {
  console.error("usage: generate-worker.mjs <siteDir> [publicDir] [plugins] [options]");
  process.exit(2);
}

const require = createRequire(import.meta.url);
const Hexo = require("hexo");
const katex = require("katex");
const { load: loadYaml } = require("js-yaml");
const { deepMerge } = require("hexo-util");
const GENERATE_TIMEOUT_MS = 60_000;
const SOURCE_MAP_FILE = ".open-pages-source-map.json";
const draft = Boolean(workerOptions.draft);

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderRichMarkdown(markdown) {
  const protectedMarkdown = /(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`)/g;
  return markdown
    .split(protectedMarkdown)
    .map((part, index) => {
      if (index % 2 === 1) {
        const diagram = part.match(/^```mermaid[^\n]*\n([\s\S]*?)```$/i);
        return diagram
          ? `<div class="mermaid">${escapeHtml(diagram[1].trim())}</div>`
          : part;
      }
      return part
        .replace(/(?<!\\)\$\$\s*([\s\S]*?)\s*(?<!\\)\$\$/g, (_match, expression) =>
          katex.renderToString(expression, {
            displayMode: true,
            throwOnError: false,
            strict: false,
          }),
        )
        .replace(
          /(?<!\\)\$(?!\s)([^$\n]+?)(?<!\s)(?<!\\)\$/g,
          (_match, expression) =>
            katex.renderToString(expression, {
              displayMode: false,
              throwOnError: false,
              strict: false,
            }),
        );
    })
    .join("");
}

function normalizePermalink(path) {
  let value = String(path ?? "").replaceAll("\\", "/");
  if (!value) return "";
  if (value.endsWith("index.html")) value = value.slice(0, -"index.html".length);
  if (!value.endsWith("/")) value += "/";
  return value.replace(/^\/+/, "");
}

function appSourcePath(source) {
  const rel = String(source ?? "").replaceAll("\\", "/").replace(/^\/+/, "");
  if (!rel) return "";
  return rel.startsWith("source/") ? rel : `source/${rel}`;
}

function collectSourceMap(hexo) {
  const map = {};
  const add = (doc) => {
    const key = appSourcePath(doc?.source);
    const permalink = normalizePermalink(doc?.path);
    if (!key || !permalink) return;
    map[key] = permalink;
  };
  for (const post of hexo.locals.get("posts").toArray()) add(post);
  for (const page of hexo.locals.get("pages").toArray()) add(page);
  return map;
}

// Some themes conditionally register generators and filters from `env.cmd`.
// Match Hexo CLI semantics even though we invoke its API directly.
const hexo = new Hexo(siteDir, { draft, _: ["generate"] });
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
  if (draft) hexo.config.render_drafts = true;
  hexo.config.marked = {
    ...(hexo.config.marked ?? {}),
    dompurify: true,
    sanitizeUrl: true,
  };
  for (const plugin of plugins) {
    await hexo.loadPlugin(resolve(plugin.path));
  }
  hexo.extend.filter.register("before_post_render", (data) => {
    data.content = renderRichMarkdown(data.content);
    return data;
  }, -100);
  // Redirect the output after init: hexo derives `public_dir` from the config
  // while loading it, so overriding earlier would be discarded.
  hexo.config.public_dir = publicRel;
  hexo.public_dir = resolve(siteDir, publicRel) + sep;
  await hexo.call("generate", { force: true, deploy: false, draft });
  writeFileSync(join(siteDir, SOURCE_MAP_FILE), JSON.stringify(collectSourceMap(hexo)));
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

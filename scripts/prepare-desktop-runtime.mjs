#!/usr/bin/env node
import { cp, lstat, mkdir, readdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const bundle = join(root, "apps/desktop/src-tauri/runtime-bundle");
const runtimeOut = join(bundle, "runtime");

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  await main();
}

async function main() {
  await rm(bundle, { recursive: true, force: true });
  execSync(`pnpm deploy "${bundle}" --filter=@open-pages/desktop --prod --legacy`, {
    cwd: root,
    stdio: "inherit",
    env: {
      ...process.env,
      npm_config_node_linker: "hoisted",
      npm_config_package_import_method: "copy",
    },
  });
  await rm(join(bundle, "src-tauri"), { recursive: true, force: true });
  await rm(join(bundle, "apps"), { recursive: true, force: true });
  await mkdir(runtimeOut, { recursive: true });
  execSync(
    `pnpm --filter @open-pages/desktop exec tsc -p tsconfig.json --outDir "${runtimeOut}" --declaration false --declarationMap false --sourceMap false`,
    { cwd: root, stdio: "inherit" },
  );
  await useCompiledWorkspaceEntries(join(bundle, "node_modules/@open-pages"));
  await copyLinkedPackages(join(bundle, "node_modules"));
  await assertRuntimeImports(bundle);
  await assertThemesResolvable(bundle);
  console.log(`desktop runtime bundle prepared at ${bundle}`);
}

/**
 * Workspace packages resolve to `src/index.ts` so that dev servers pick up edits
 * without a build step. The shipped runtime runs under plain `node`, which
 * refuses to strip types from anything under `node_modules`
 * (ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING), so repoint the deployed copies
 * at their compiled output.
 */
export async function useCompiledWorkspaceEntries(scope) {
  let names;
  try {
    names = await readdir(scope);
  } catch {
    throw new Error(`no @open-pages packages in the deployed bundle at ${scope}`);
  }

  const repointed = [];
  for (const name of names) {
    const pkgDir = join(scope, name);
    if ((await lstat(pkgDir)).isSymbolicLink()) {
      const target = await realpath(pkgDir);
      await rm(pkgDir, { recursive: true, force: true });
      await cp(target, pkgDir, { recursive: true });
    }
    const manifestPath = join(pkgDir, "package.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    if (!usesTypeScriptEntry(manifest)) continue;

    if (!(await exists(join(pkgDir, "dist/index.js")))) {
      throw new Error(
        `@open-pages/${name} has no dist/index.js; run \`pnpm build\` before packaging`,
      );
    }

    manifest.main = "./dist/index.js";
    manifest.types = "./dist/index.d.ts";
    manifest.exports = {
      ".": { types: "./dist/index.d.ts", default: "./dist/index.js" },
    };
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(`repointed @open-pages/${name} at dist/index.js`);
    repointed.push(name);
  }
  return repointed;
}

function usesTypeScriptEntry(manifest) {
  const entry = manifest.exports?.["."];
  const target = typeof entry === "string" ? entry : entry?.default;
  return typeof target === "string" && target.endsWith(".ts");
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * pnpm still links workspace packages (and sometimes bins). Windows installers
 * drop those links, which shows up as ERR_MODULE_NOT_FOUND when host.js starts.
 * Copy the link target in place so the tree is real files only.
 */
export async function copyLinkedPackages(nodeModules) {
  const replaced = [];
  await visit(nodeModules, async (path) => {
    const info = await lstat(path);
    if (!info.isSymbolicLink()) return;
    const target = await realpath(path);
    const targetInfo = await stat(target);
    await rm(path, { recursive: true, force: true });
    if (targetInfo.isDirectory()) {
      await cp(target, path, { recursive: true, dereference: false });
    } else {
      await cp(target, path, { dereference: true });
    }
    replaced.push(path);
  });
  console.log(`copied ${replaced.length} linked packages into ${nodeModules}`);
  return replaced;
}

async function visit(dir, onPath) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name === ".bin" || entry.name === ".pnpm") continue;
    const path = join(dir, entry.name);
    if (entry.isSymbolicLink()) {
      await onPath(path);
      continue;
    }
    if (entry.isDirectory() && (entry.name.startsWith("@") || entry.name === "node_modules")) {
      await visit(path, onPath);
    }
  }
}

async function assertRuntimeImports(bundleDir) {
  execSync(
    `node --input-type=module -e "await import('@open-pages/publish'); await import('@open-pages/github'); await import('@open-pages/hexo-runner'); await import('@open-pages/shared'); console.log('runtime imports ok')"`,
    { cwd: bundleDir, stdio: "inherit" },
  );
}

/**
 * A theme the runner cannot find here is a theme the installed app cannot
 * render, and nothing in the workspace test suite can see that: the checkout
 * resolves themes through links the bundle does not have.
 */
async function assertThemesResolvable(bundleDir) {
  execSync(
    `node --input-type=module -e "const { missingThemePackages } = await import('@open-pages/hexo-runner'); const missing = await missingThemePackages(); if (missing.length) throw new Error('theme packages unreachable from the bundle: ' + missing.join(', ')); console.log('themes resolvable ok')"`,
    { cwd: bundleDir, stdio: "inherit" },
  );
}

#!/usr/bin/env node
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
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
  });
  await mkdir(runtimeOut, { recursive: true });
  execSync(
    `pnpm --filter @open-pages/desktop exec tsc -p tsconfig.json --outDir "${runtimeOut}" --declaration false --declarationMap false --sourceMap false`,
    { cwd: root, stdio: "inherit" },
  );
  await useCompiledWorkspaceEntries(join(bundle, "node_modules/@open-pages"));
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

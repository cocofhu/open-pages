#!/usr/bin/env node
import { mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const bundle = join(root, "apps/desktop/src-tauri/runtime-bundle");
const runtimeOut = join(bundle, "runtime");

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
console.log(`desktop runtime bundle prepared at ${bundle}`);

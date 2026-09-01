#!/usr/bin/env node
import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const bundle = join(root, "apps/desktop/src-tauri/runtime-bundle");

await rm(bundle, { recursive: true, force: true });
execSync(`pnpm deploy "${bundle}" --filter=@open-pages/desktop --prod --legacy`, {
  cwd: root,
  stdio: "inherit",
});
await mkdir(join(bundle, "runtime"), { recursive: true });
await cp(join(root, "apps/desktop/runtime/host.ts"), join(bundle, "runtime/host.ts"));
console.log(`desktop runtime bundle prepared at ${bundle}`);

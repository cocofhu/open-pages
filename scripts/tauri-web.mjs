#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const script = process.argv[2] === "dev" ? "dev" : "build";
const result = spawnSync("pnpm", ["--filter", "@open-pages/web", script], {
  cwd: root,
  stdio: "inherit",
  shell: process.platform === "win32",
  // Keeps the PWA service worker out of the desktop bundle, where it would
  // pin the app shell of whichever version installed first. See vite.config.ts.
  env: { ...process.env, OPEN_PAGES_DESKTOP: "1" },
});
process.exit(result.status ?? 1);

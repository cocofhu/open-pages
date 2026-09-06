import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  DEFAULT_SITE_CONFIG,
  WELCOME_POST_PATH,
  welcomeMarkdown,
} from "./packages/shared/src/index.ts";
import { createAddonStore } from "./packages/addons/src/index.ts";
import {
  listAddons,
  resolveGenerationAddons,
  setAddonEnabled,
} from "./apps/api/src/lib/addons.ts";
import { previewSite, resetSite } from "./apps/api/src/lib/workspace.ts";
import { env } from "./apps/api/src/env.ts";

const owner = `verify-addons-${Date.now()}`;
const siteId = "default";

try {
  const plugins = await listAddons(owner, "plugin");
  const marked = plugins.find((plugin) => plugin.id === "hexo-renderer-marked");
  if (!marked?.core || marked.enabled !== true) throw new Error("core plugin catalog is invalid");

  let rejectedCore = false;
  try {
    await setAddonEnabled(owner, "hexo-renderer-marked", false);
  } catch {
    rejectedCore = true;
  }
  if (!rejectedCore) throw new Error("core plugin could be disabled");

  await setAddonEnabled(owner, "hexo-generator-feed", false);
  const runtime = await resolveGenerationAddons(owner, DEFAULT_SITE_CONFIG.theme);
  if (!runtime.disabledPluginNames.includes("hexo-generator-feed")) {
    throw new Error("disabled plugin was not passed to the runner");
  }

  const result = await previewSite(
    owner,
    siteId,
    [{ path: WELCOME_POST_PATH, content: welcomeMarkdown(), encoding: "utf8" }],
    DEFAULT_SITE_CONFIG,
  );
  const atomExists = await stat(resolve(result.publicDir, "atom.xml")).then(
    () => true,
    () => false,
  );
  if (atomExists) throw new Error("disabled feed plugin still generated atom.xml");
  console.log("ADDON_OK catalog core-lock toggle generation");

  const updateOwner = `verify-addon-update-${Date.now()}`;
  const siteDir = join(env.workspaceRoot, updateOwner, "default");
  const store = createAddonStore({
    workspaceRoot: env.workspaceRoot,
    siteDirs: async () => [siteDir],
  });
  const pkgName = "hexo-theme-uptest";
  const pkgRoot = join(env.workspaceRoot, updateOwner, ".addon-store", "packages", "uptest", "node_modules", pkgName);
  await mkdir(pkgRoot, { recursive: true });
  await mkdir(join(siteDir, "themes", "uptest"), { recursive: true });
  await writeFile(
    join(pkgRoot, "package.json"),
    JSON.stringify({ name: pkgName, version: "1.0.0", description: "old uptest" }),
  );
  await writeFile(
    join(pkgRoot, "open-pages.theme.json"),
    JSON.stringify({ label: "Uptest", description: "old uptest", settings: [] }),
  );
  await mkdir(join(env.workspaceRoot, updateOwner, ".addon-store"), { recursive: true });
  await writeFile(
    join(env.workspaceRoot, updateOwner, ".addon-store", "index.json"),
    JSON.stringify({
      addons: [
        {
          id: "uptest",
          kind: "theme",
          packageName: pkgName,
          label: "Uptest",
          description: "old uptest",
          source: { type: "github", packageName: pkgName, repo: "example/uptest-theme" },
          settings: [],
          builtin: false,
        },
      ],
      disabledPlugins: [],
    }),
  );
  await writeFile(join(siteDir, "themes", "uptest", ".open-pages-theme"), "uptest:3:stale\n");

  const duplicate = await store.installAddon(updateOwner, "example/uptest-theme", "theme");
  if (duplicate.description !== "old uptest") {
    throw new Error("second install should keep the already-installed addon");
  }

  let builtinRejected = false;
  try {
    await store.updateAddon(updateOwner, "landscape");
  } catch {
    builtinRejected = true;
  }
  if (!builtinRejected) throw new Error("built-in theme should not update");

  let missingRejected = false;
  try {
    await store.updateAddon(updateOwner, "missing-theme");
  } catch {
    missingRejected = true;
  }
  if (!missingRejected) throw new Error("missing addon should not update");

  await writeFile(
    join(pkgRoot, "open-pages.theme.json"),
    JSON.stringify({
      label: "Uptest",
      description: "new uptest",
      settings: [{ key: "lede", label: "副文案", yamlPath: "lede", group: "开场", type: "text", default: "hi" }],
    }),
  );
  const listed = await store.listAddons(updateOwner, "theme");
  const refreshed = listed.find((addon) => addon.id === "uptest");
  if (refreshed?.description !== "new uptest" || !refreshed.settings.length) {
    throw new Error("stored theme schema was not re-read from disk");
  }

  await rm(resolve(env.workspaceRoot, updateOwner), { recursive: true, force: true });
  console.log("ADDON_OK update-gate duplicate-install schema-refresh");
} finally {
  await resetSite(owner, siteId).catch(() => undefined);
  await rm(resolve(env.workspaceRoot, owner), { recursive: true, force: true });
}

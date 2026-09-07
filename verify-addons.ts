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
  if (!marked.installedVersion?.trim()) {
    throw new Error("builtin plugin should expose installedVersion from package.json");
  }
  console.log(`ADDON_OK builtin-version ${marked.installedVersion}`);

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
  if (refreshed.installedVersion !== "1.0.0") {
    throw new Error(`github theme should expose package version, got ${refreshed.installedVersion}`);
  }
  if (refreshed.source.type !== "github" || refreshed.source.version !== "1.0.0") {
    throw new Error("github source should retain installed package version");
  }

  const pluginOwner = `verify-addon-plugin-ver-${Date.now()}`;
  const pluginStore = createAddonStore({
    workspaceRoot: env.workspaceRoot,
    siteDirs: async () => [],
  });
  const npmPkg = "hexo-generator-sitemap";
  const npmRoot = join(
    env.workspaceRoot,
    pluginOwner,
    ".addon-store",
    "packages",
    "generator-sitemap",
    "node_modules",
    npmPkg,
  );
  await mkdir(npmRoot, { recursive: true });
  await writeFile(
    join(npmRoot, "package.json"),
    JSON.stringify({ name: npmPkg, version: "3.0.1", description: "sitemap" }),
  );
  await mkdir(join(env.workspaceRoot, pluginOwner, ".addon-store"), { recursive: true });
  await writeFile(
    join(env.workspaceRoot, pluginOwner, ".addon-store", "index.json"),
    JSON.stringify({
      addons: [
        {
          id: "generator-sitemap",
          kind: "plugin",
          packageName: npmPkg,
          label: "generator-sitemap",
          description: "sitemap",
          installedVersion: "3.0.1",
          source: { type: "npm", packageName: npmPkg, version: "3.0.1" },
          settings: [],
          builtin: false,
          enabled: true,
        },
        {
          id: "wordcount-gh",
          kind: "plugin",
          packageName: "hexo-wordcount-gh",
          label: "wordcount-gh",
          description: "github plugin",
          source: {
            type: "github",
            packageName: "hexo-wordcount-gh",
            repo: "example/hexo-wordcount-gh",
          },
          settings: [],
          builtin: false,
          enabled: true,
        },
      ],
      disabledPlugins: [],
    }),
  );
  const ghRoot = join(
    env.workspaceRoot,
    pluginOwner,
    ".addon-store",
    "packages",
    "wordcount-gh",
    "node_modules",
    "hexo-wordcount-gh",
  );
  await mkdir(ghRoot, { recursive: true });
  await writeFile(
    join(ghRoot, "package.json"),
    JSON.stringify({ name: "hexo-wordcount-gh", version: "6.0.1", description: "wc" }),
  );

  const pluginList = await pluginStore.listAddons(pluginOwner, "plugin");
  const npmListed = pluginList.find((addon) => addon.id === "generator-sitemap");
  const ghListed = pluginList.find((addon) => addon.id === "wordcount-gh");
  if (npmListed?.installedVersion !== "3.0.1") {
    throw new Error(`npm plugin version missing: ${npmListed?.installedVersion}`);
  }
  if (ghListed?.installedVersion !== "6.0.1") {
    throw new Error(`github plugin version missing: ${ghListed?.installedVersion}`);
  }
  console.log("ADDON_OK plugin-versions npm github");

  await rm(resolve(env.workspaceRoot, updateOwner), { recursive: true, force: true });
  await rm(resolve(env.workspaceRoot, pluginOwner), { recursive: true, force: true });
  console.log("ADDON_OK update-gate duplicate-install schema-refresh");
} finally {
  await resetSite(owner, siteId).catch(() => undefined);
  await rm(resolve(env.workspaceRoot, owner), { recursive: true, force: true });
}

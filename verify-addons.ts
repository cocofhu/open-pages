import { rm, stat } from "node:fs/promises";
import { resolve } from "node:path";
import {
  DEFAULT_SITE_CONFIG,
  WELCOME_POST_PATH,
  welcomeMarkdown,
} from "./packages/shared/src/index.ts";
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
} finally {
  await resetSite(owner, siteId).catch(() => undefined);
  await rm(resolve(env.workspaceRoot, owner), { recursive: true, force: true });
}

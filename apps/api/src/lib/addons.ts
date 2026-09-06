import { createAddonStore, type GenerationAddons, type InstallProgress } from "@open-pages/addons";
import type { AddonKind, AddonManifest } from "@open-pages/shared";
import { ClientError } from "../errors.js";
import { env } from "../env.js";

export type { GenerationAddons, InstallProgress };

const store = createAddonStore({ workspaceRoot: env.workspaceRoot });

function wrap<T>(error: unknown): T {
  if (error instanceof ClientError) throw error;
  if (error instanceof Error) throw new ClientError(error.message);
  throw error;
}

export async function listAddons(owner: string, kind?: AddonKind): Promise<AddonManifest[]> {
  try {
    return await store.listAddons(owner, kind);
  } catch (error) {
    return wrap(error);
  }
}

export async function resolveGenerationAddons(
  owner: string,
  theme: string,
): Promise<GenerationAddons> {
  try {
    return await store.resolveGenerationAddons(owner, theme);
  } catch (error) {
    return wrap(error);
  }
}

export async function installAddon(
  owner: string,
  source: string,
  requestedKind?: AddonKind,
  onProgress?: (progress: InstallProgress) => void,
): Promise<AddonManifest> {
  try {
    return await store.installAddon(owner, source, requestedKind, onProgress);
  } catch (error) {
    return wrap(error);
  }
}

export async function setAddonEnabled(
  owner: string,
  id: string,
  enabled: boolean,
): Promise<AddonManifest> {
  try {
    return await store.setAddonEnabled(owner, id, enabled);
  } catch (error) {
    return wrap(error);
  }
}

export async function removeAddon(owner: string, id: string): Promise<void> {
  try {
    await store.removeAddon(owner, id);
  } catch (error) {
    wrap(error);
  }
}

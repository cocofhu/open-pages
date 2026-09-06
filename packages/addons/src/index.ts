import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { createRequire } from "node:module";
import {
  access,
  constants,
  lstat,
  mkdir,
  readFile,
  realpath,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { delimiter, dirname, join, resolve, sep } from "node:path";
import { x as extractTar } from "tar";
import {
  BUILTIN_ADDONS,
  isSafeWorkspaceId,
  isThemeId,
  normalizeThemeListItems,
  type AddonKind,
  type AddonManifest,
  type ThemeListItemField,
  type ThemeSettingField,
} from "@open-pages/shared";

export interface GenerationAddons {
  themeSource?: string;
  plugins: Array<{ id: string; path: string }>;
  disabledPluginNames: string[];
}

export interface InstallProgress {
  stage: "resolve" | "download" | "verify" | "inspect" | "register" | "done";
  label: string;
  percent: number;
}

export type ProgressReporter = (progress: InstallProgress) => void;

export interface AddonStoreOptions {
  workspaceRoot: string;
  siteDirs?: (owner: string) => Promise<string[]>;
}

export interface AddonStore {
  listAddons(owner: string, kind?: AddonKind): Promise<AddonManifest[]>;
  resolveGenerationAddons(owner: string, theme: string): Promise<GenerationAddons>;
  installAddon(
    owner: string,
    source: string,
    requestedKind?: AddonKind,
    onProgress?: ProgressReporter,
  ): Promise<AddonManifest>;
  setAddonEnabled(owner: string, id: string, enabled: boolean): Promise<AddonManifest>;
  removeAddon(owner: string, id: string): Promise<void>;
}

export function createAddonStore(options: AddonStoreOptions): AddonStore {
  const workspaceRoot = resolve(options.workspaceRoot);
  const siteDirs =
    options.siteDirs ??
    (async (owner: string) => {
      const root = resolve(workspaceRoot, owner);
      const entries = await readdir(root).catch(() => [] as string[]);
      return entries.filter((entry) => !entry.startsWith(".")).map((entry) => join(root, entry));
    });

  type StoredAddon = AddonManifest;

interface AddonIndex {
  addons: StoredAddon[];
  disabledPlugins: string[];
}

const DOWNLOAD_START = 10;
const DOWNLOAD_END = 70;
const EMPTY_INDEX: AddonIndex = { addons: [], disabledPlugins: [] };
const installTails = new Map<string, Promise<void>>();
const require = createRequire(import.meta.url);

function ownerRoot(owner: string): string {
  if (!isSafeWorkspaceId(owner)) throw new Error("Invalid workspace");
  const root = resolve(workspaceRoot);
  const target = resolve(root, owner, ".addon-store");
  if (!target.startsWith(root + sep)) throw new Error("Invalid workspace");
  return target;
}

async function readIndex(owner: string): Promise<AddonIndex> {
  try {
    const raw = JSON.parse(await readFile(join(ownerRoot(owner), "index.json"), "utf8")) as AddonIndex;
    return {
      addons: Array.isArray(raw.addons) ? raw.addons : [],
      disabledPlugins: Array.isArray(raw.disabledPlugins) ? raw.disabledPlugins : [],
    };
  } catch {
    return { ...EMPTY_INDEX, addons: [], disabledPlugins: [] };
  }
}

async function writeIndex(owner: string, index: AddonIndex): Promise<void> {
  const root = ownerRoot(owner);
  await mkdir(root, { recursive: true });
  const staged = join(root, `.index-${process.pid}-${Date.now()}.json`);
  await writeFile(staged, `${JSON.stringify(index, null, 2)}\n`);
  await rename(staged, join(root, "index.json"));
}

  async function listAddons(owner: string, kind?: AddonKind): Promise<AddonManifest[]> {
  const index = await readIndex(owner);
  const disabled = new Set(index.disabledPlugins);
  const builtins = BUILTIN_ADDONS.map((addon) => ({
    ...addon,
    enabled: addon.kind === "plugin" ? addon.core || !disabled.has(addon.id) : undefined,
  }));
  const extras = await Promise.all(index.addons.map((addon) => refreshStoredAddon(owner, addon)));
  return [...builtins, ...extras]
    .filter((addon) => !kind || addon.kind === kind)
    .map(publicAddon);
}

  async function resolveGenerationAddons(
  owner: string,
  theme: string,
): Promise<GenerationAddons> {
  if (!isThemeId(theme)) throw new Error("Invalid theme");
  const index = await readIndex(owner);
  const customTheme = index.addons.find((addon) => addon.kind === "theme" && addon.id === theme);
  const builtinTheme = BUILTIN_ADDONS.some((addon) => addon.kind === "theme" && addon.id === theme);
  if (!customTheme && !builtinTheme) throw new Error(`Theme not installed: ${theme}`);

  return {
    themeSource: customTheme ? packageRoot(owner, customTheme) : undefined,
    plugins: await Promise.all(
      index.addons
        .filter((addon) => addon.kind === "plugin" && addon.enabled !== false)
        .map(async (addon) => ({ id: addon.id, path: await pluginEntry(owner, addon) })),
    ),
    disabledPluginNames: BUILTIN_ADDONS.filter(
      (addon) =>
        addon.kind === "plugin" &&
        !addon.core &&
        index.disabledPlugins.includes(addon.id),
    ).map((addon) => addon.packageName),
  };
}

  async function installAddon(
  owner: string,
  source: string,
  requestedKind?: AddonKind,
  onProgress: ProgressReporter = () => {},
): Promise<AddonManifest> {
  const report = (stage: InstallProgress["stage"], label: string, percent: number) =>
    onProgress({ stage, label, percent: Math.round(percent) });

  report("resolve", "解析安装来源", 4);
  const normalized = normalizeSource(source);
  if (normalized.source.type === "npm") {
    const builtin = BUILTIN_ADDONS.find(
      (addon) => addon.packageName === normalized.source.packageName,
    );
    if (builtin) {
      if (requestedKind && builtin.kind !== requestedKind) {
        throw new Error(`Package is a Hexo ${builtin.kind}, not a ${requestedKind}`);
      }
      report("done", "已预装，无需重复安装", 100);
      return builtin;
    }
  }
  return withInstallGate(owner, async () => {
    const index = await readIndex(owner);
    const duplicate = index.addons.find((addon) => sameSource(addon.source, normalized.source));
    if (duplicate) {
      report("done", "已安装过这个扩展", 100);
      return publicAddon(duplicate);
    }

    const root = ownerRoot(owner);
    const staging = join(root, `.install-${process.pid}-${Date.now()}`);
    await mkdir(staging, { recursive: true });
    let moved = false;
    try {
      await writeFile(join(staging, "package.json"), '{"private":true}\n');
      report("download", "正在下载依赖", DOWNLOAD_START);
      const npm = await findNpm();
      if (npm) {
        try {
          await runCommand(
            npm,
            [
              "install",
              "--ignore-scripts",
              "--no-audit",
              "--no-fund",
              "--no-package-lock",
              "--save-exact",
              "--loglevel=http",
              normalized.spec,
            ],
            staging,
            (fetched) =>
              report("download", `正在下载依赖（${fetched} 个包）`, downloadPercent(fetched)),
          );
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          const message = error instanceof Error ? error.message : "";
          if (code !== "ENOENT" && !/ENOENT/.test(message)) throw error;
          await installFromTarball(normalized, staging, report);
        }
      } else {
        await installFromTarball(normalized, staging, report);
      }
      report("verify", "校验安装内容", 74);
      await assertInstallTree(staging);
      report("inspect", "读取扩展信息", 84);
      const installed = await findInstalledAddon(staging);
      const kind = requestedKind ?? inferKind(installed.packageName);
      assertPackageKind(installed.packageName, kind);
      const id = addonId(installed.packageName);
      if (BUILTIN_ADDONS.some((addon) => addon.id === id || addon.packageName === installed.packageName)) {
        const builtin = BUILTIN_ADDONS.find(
          (addon) => addon.id === id || addon.packageName === installed.packageName,
        )!;
        report("done", "已预装，无需重复安装", 100);
        return builtin;
      }
      if (index.addons.some((addon) => addon.id === id)) {
        throw new Error(`Addon id already installed: ${id}`);
      }

      const finalDir = join(root, "packages", id);
      await mkdir(dirname(finalDir), { recursive: true });
      await rm(finalDir, { recursive: true, force: true });
      await rename(staging, finalDir);
      moved = true;
      const manifestFile =
        kind === "theme" ? "open-pages.theme.json" : "open-pages.plugin.json";
      const extension = await readExtensionManifest(
        join(finalDir, "node_modules", installed.packageName, manifestFile),
      );
      const addon: StoredAddon = {
        id,
        kind,
        packageName: installed.packageName,
        label: extension?.label ?? installed.displayName ?? installed.packageName,
        description: extension?.description ?? installed.description ?? "用户安装的 Hexo 扩展",
        source:
          normalized.source.type === "github"
            ? { ...normalized.source, packageName: installed.packageName }
            : {
                type: "npm",
                packageName: installed.packageName,
                version: installed.version,
              },
        settings: extension?.settings ?? [],
        builtin: false,
        enabled: kind === "plugin" ? true : undefined,
        tint: extension?.tint,
      };
      report("register", "写入扩展列表", 94);
      index.addons.push(addon);
      await writeIndex(owner, index);
      report("done", `${addon.label} 安装完成`, 100);
      return publicAddon(addon);
    } finally {
      if (!moved) await rm(staging, { recursive: true, force: true });
    }
  });
}

  async function setAddonEnabled(
  owner: string,
  id: string,
  enabled: boolean,
): Promise<AddonManifest> {
  return withInstallGate(owner, () => setAddonEnabledUnlocked(owner, id, enabled));
}

async function setAddonEnabledUnlocked(
  owner: string,
  id: string,
  enabled: boolean,
): Promise<AddonManifest> {
  const index = await readIndex(owner);
  const custom = index.addons.find((addon) => addon.id === id);
  if (custom) {
    if (custom.kind !== "plugin") throw new Error("Only plugins can be enabled or disabled");
    custom.enabled = enabled;
    await writeIndex(owner, index);
    return publicAddon(custom);
  }
  const builtin = BUILTIN_ADDONS.find((addon) => addon.id === id && addon.kind === "plugin");
  if (!builtin) throw new Error("Plugin not found");
  if (builtin.core) throw new Error("Core plugins cannot be disabled");
  const disabled = new Set(index.disabledPlugins);
  if (enabled) disabled.delete(id);
  else disabled.add(id);
  index.disabledPlugins = [...disabled];
  await writeIndex(owner, index);
  return { ...builtin, enabled };
}

  async function removeAddon(owner: string, id: string): Promise<void> {
  return withInstallGate(owner, () => removeAddonUnlocked(owner, id));
}

async function removeAddonUnlocked(owner: string, id: string): Promise<void> {
  const index = await readIndex(owner);
  const at = index.addons.findIndex((addon) => addon.id === id);
  if (at < 0) {
    if (BUILTIN_ADDONS.some((addon) => addon.id === id)) {
      throw new Error("Built-in addons cannot be removed");
    }
    throw new Error("Addon not found");
  }
  const [addon] = index.addons.splice(at, 1);
  if (addon.kind === "theme" && (await ownerUsesTheme(owner, addon.id))) {
    throw new Error("Switch sites away from this theme before removing it");
  }
  await writeIndex(owner, index);
  await rm(join(ownerRoot(owner), "packages", addon.id), { recursive: true, force: true });
}

  async function ownerUsesTheme(owner: string, theme: string): Promise<boolean> {
    for (const dir of await siteDirs(owner)) {
      const yaml = await readFile(join(dir, "_config.yml"), "utf8").catch(() => "");
      if (new RegExp(`^theme:\\s*${theme}\\s*$`, "m").test(yaml)) return true;
    }
    return false;
  }

async function refreshStoredAddon(owner: string, addon: StoredAddon): Promise<StoredAddon> {
  const file = addon.kind === "theme" ? "open-pages.theme.json" : "open-pages.plugin.json";
  const extension = await readExtensionManifest(join(packageRoot(owner, addon), file));
  if (!extension) return addon;
  return {
    ...addon,
    label: extension.label ?? addon.label,
    description: extension.description ?? addon.description,
    settings: extension.settings ?? addon.settings,
    tint: extension.tint ?? addon.tint,
  };
}

function packageRoot(owner: string, addon: StoredAddon): string {
  return join(ownerRoot(owner), "packages", addon.id, "node_modules", addon.packageName);
}

async function pluginEntry(owner: string, addon: StoredAddon): Promise<string> {
  const root = await realpath(packageRoot(owner, addon));
  let entry: string;
  try {
    entry = require.resolve(addon.packageName, {
      paths: [join(ownerRoot(owner), "packages", addon.id, "node_modules")],
    });
  } catch {
    throw new Error(`Plugin entry not found: ${addon.packageName}`);
  }
  const resolved = await realpath(entry);
  if (
    (resolved !== root && !resolved.startsWith(root + sep)) ||
    !/\.(?:c?js|mjs)$/.test(resolved)
  ) {
    throw new Error(`Plugin entry escapes its package: ${addon.packageName}`);
  }
  return resolved;
}

function publicAddon(addon: AddonManifest | StoredAddon): AddonManifest {
  const { installDir: _installDir, ...manifest } = addon as StoredAddon & {
    installDir?: string;
  };
  return manifest;
}

function sameSource(
  left: AddonManifest["source"],
  right: AddonManifest["source"],
): boolean {
  if (left.type !== right.type) return false;
  if (left.type === "github" && right.type === "github") {
    return left.repo.toLowerCase() === right.repo.toLowerCase() && left.ref === right.ref;
  }
  return left.packageName === right.packageName;
}

function normalizeSource(source: string): {
  spec: string;
  source:
    | { type: "npm"; packageName: string; version: string }
    | { type: "github"; packageName: string; repo: string; ref?: string };
} {
  const value = source.trim();
  const github = value.match(/^([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)(?:#([A-Za-z0-9._/-]+))?$/);
  if (github) {
    return {
      spec: `github:${github[1]}${github[2] ? `#${github[2]}` : ""}`,
      source: { type: "github", packageName: "", repo: github[1], ref: github[2] },
    };
  }
  const npm = value.match(/^((?:@[a-z0-9._-]+\/)?hexo-[a-z0-9._-]+)(?:@([a-zA-Z0-9._~^<>=*-]+))?$/i);
  if (!npm) throw new Error("Use a Hexo npm package name or public GitHub owner/repo");
  return {
    spec: value,
    source: { type: "npm", packageName: npm[1], version: npm[2] ?? "latest" },
  };
}

async function findInstalledAddon(
  root: string,
): Promise<{ packageName: string; version: string; description?: string; displayName?: string }> {
  const modules = join(root, "node_modules");
  const rootManifest = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as {
    dependencies?: Record<string, string>;
  };
  const direct = Object.keys(rootManifest.dependencies ?? {});
  for (const packageName of direct) {
    if (!/^hexo-|^@[^/]+\/hexo-/.test(packageName)) continue;
    const json = JSON.parse(
      await readFile(join(modules, packageName, "package.json"), "utf8"),
    ) as { name?: string; version?: string; description?: string; displayName?: string };
    if (json.name !== packageName) continue;
    return {
      packageName,
      version: json.version ?? "0.0.0",
      description: json.description,
      displayName: json.displayName,
    };
  }
  throw new Error("Installed package is not a Hexo theme or plugin");
}

function inferKind(packageName: string): AddonKind {
  return /(?:^|\/)hexo-theme-/.test(packageName) ? "theme" : "plugin";
}

function assertPackageKind(packageName: string, kind: AddonKind): void {
  const inferred = inferKind(packageName);
  if (inferred !== kind) throw new Error(`Package is a Hexo ${inferred}, not a ${kind}`);
}

function addonId(packageName: string): string {
  const value = packageName
    .replace(/^@/, "")
    .replaceAll("/", "-")
    .replace(/^hexo-theme-/, "")
    .toLowerCase();
  if (!isThemeId(value)) throw new Error("Package name cannot be used as an addon id");
  return value;
}

async function readExtensionManifest(path: string): Promise<{
  label?: string;
  description?: string;
  settings?: ThemeSettingField[];
  tint?: { ink: string; paper: string };
} | null> {
  try {
    const raw = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
    return {
      label: typeof raw.label === "string" ? raw.label.slice(0, 100) : undefined,
      description:
        typeof raw.description === "string" ? raw.description.slice(0, 500) : undefined,
      settings: Array.isArray(raw.settings)
        ? raw.settings
            .map(parseSettingField)
            .filter((field): field is ThemeSettingField => field !== null)
            .slice(0, 100)
        : [],
      tint:
        raw.tint &&
        typeof raw.tint === "object" &&
        isSafeColor((raw.tint as Record<string, unknown>).ink) &&
        isSafeColor((raw.tint as Record<string, unknown>).paper)
          ? (raw.tint as { ink: string; paper: string })
          : undefined,
    };
  } catch {
    return null;
  }
}

function parseSettingField(value: unknown): ThemeSettingField | null {
  if (!value || typeof value !== "object") return null;
  const field = value as Record<string, unknown>;
  if (
    typeof field.key !== "string" ||
    !/^[a-zA-Z][a-zA-Z0-9_-]{0,79}$/.test(field.key) ||
    typeof field.label !== "string" ||
    typeof field.yamlPath !== "string" ||
    !/^(?!.*(?:^|\.)(?:__proto__|prototype|constructor)(?:\.|$))[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)*$/.test(
      field.yamlPath,
    ) ||
    typeof field.group !== "string"
  ) {
    return null;
  }
  const base = {
    key: field.key,
    label: field.label.slice(0, 100),
    hint: typeof field.hint === "string" ? field.hint.slice(0, 300) : undefined,
    yamlPath: field.yamlPath,
    group: field.group.slice(0, 100),
  };
  if (field.type === "toggle" && typeof field.default === "boolean") {
    return { ...base, type: "toggle", default: field.default };
  }
  if (field.type === "text" && typeof field.default === "string") {
    return {
      ...base,
      type: "text",
      default: field.default.slice(0, 2_000),
      placeholder:
        typeof field.placeholder === "string" ? field.placeholder.slice(0, 200) : undefined,
    };
  }
  if ((field.type === "choice" || field.type === "swatch") && typeof field.default === "string") {
    const options = Array.isArray(field.options)
      ? field.options
          .filter(
            (option) =>
              option &&
              typeof option === "object" &&
              typeof (option as Record<string, unknown>).value === "string" &&
              typeof (option as Record<string, unknown>).label === "string",
          )
          .map((option) => option as Record<string, string>)
          .slice(0, 30)
      : [];
    if (!options.length) return null;
    return field.type === "swatch"
      ? {
          ...base,
          type: "swatch",
          default: field.default,
          options: options.map((item) => ({
            value: item.value.slice(0, 200),
            label: item.label.slice(0, 100),
            color: isSafeColor(item.color) ? item.color : "#777777",
          })),
        }
      : {
          ...base,
          type: "choice",
          default: field.default,
          options: options.map((item) => ({
            value: item.value.slice(0, 200),
            label: item.label.slice(0, 100),
          })),
        };
  }
  if (field.type === "list") {
    const itemFields = Array.isArray(field.itemFields)
      ? field.itemFields
          .map(parseListItemField)
          .filter((item): item is ThemeListItemField => item !== null)
          .slice(0, 12)
      : [];
    if (!itemFields.length) return null;
    const maxItems = Math.min(
      24,
      Math.max(1, typeof field.maxItems === "number" ? Math.floor(field.maxItems) : 12),
    );
    const minItems = Math.min(
      maxItems,
      Math.max(0, typeof field.minItems === "number" ? Math.floor(field.minItems) : 0),
    );
    return {
      ...base,
      type: "list",
      itemLabel: typeof field.itemLabel === "string" ? field.itemLabel.slice(0, 40) : undefined,
      minItems,
      maxItems,
      itemFields,
      default: normalizeThemeListItems(itemFields, field.default, maxItems, minItems),
    };
  }
  return null;
}

function parseListItemField(value: unknown): ThemeListItemField | null {
  if (!value || typeof value !== "object") return null;
  const field = value as Record<string, unknown>;
  if (
    typeof field.key !== "string" ||
    !/^[a-zA-Z][a-zA-Z0-9_-]{0,79}$/.test(field.key) ||
    typeof field.label !== "string"
  ) {
    return null;
  }
  const placeholder =
    typeof field.placeholder === "string" ? field.placeholder.slice(0, 200) : undefined;
  const fallback = typeof field.default === "string" ? field.default.slice(0, 2_000) : undefined;
  if (field.type === "annotated-text") {
    if (typeof field.tipsKey !== "string" || !/^[a-zA-Z][a-zA-Z0-9_-]{0,79}$/.test(field.tipsKey)) {
      return null;
    }
    return {
      key: field.key,
      label: field.label.slice(0, 100),
      type: "annotated-text",
      tipsKey: field.tipsKey,
      placeholder,
      default: fallback,
    };
  }
  if (field.type === "text" || field.type === undefined) {
    return {
      key: field.key,
      label: field.label.slice(0, 100),
      type: "text",
      placeholder,
      default: fallback,
    };
  }
  return null;
}

function isSafeColor(value: unknown): value is string {
  return (
    typeof value === "string" &&
    (/^#[0-9a-f]{3,8}$/i.test(value) ||
      /^(?:rgb|hsl)a?\([\d\s.,%+-]+\)$/i.test(value))
  );
}

async function assertInstallTree(root: string): Promise<void> {
  const base = await realpath(root);
  let bytes = 0;
  let files = 0;
  const walk = async (dir: string): Promise<void> => {
    for (const name of await readdir(dir)) {
      const path = join(dir, name);
      const info = await lstat(path);
      if (info.isSymbolicLink()) {
        const target = await realpath(path);
        if (target !== base && !target.startsWith(base + sep)) {
          throw new Error("Installed package contains an unsafe symlink");
        }
        continue;
      }
      if (info.isDirectory()) {
        await walk(path);
        continue;
      }
      files += 1;
      bytes += info.size;
      if (files > 10_000 || bytes > 30 * 1024 * 1024) {
        throw new Error("Installed addon is too large");
      }
    }
  };
  await walk(base);
}

/** npm never reports a total, so downloads approach the ceiling instead of reaching it. */
function downloadPercent(fetched: number): number {
  return DOWNLOAD_START + (DOWNLOAD_END - DOWNLOAD_START) * (1 - Math.exp(-fetched / 18));
}

type NormalizedSource = ReturnType<typeof normalizeSource>;

async function existsPath(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function findNpm(): Promise<string | null> {
  if (process.env.OPEN_PAGES_FORCE_TARBALL === "1") return null;
  const names = process.platform === "win32" ? ["npm.cmd", "npm.exe"] : ["npm"];
  const dirs = [
    dirname(process.execPath),
    ...(process.env.PATH ?? "").split(delimiter),
    "/usr/local/bin",
    "/opt/homebrew/bin",
    "/usr/bin",
    process.env.ProgramFiles ? join(process.env.ProgramFiles, "nodejs") : "",
    process.env["ProgramFiles(x86)"] ? join(process.env["ProgramFiles(x86)"], "nodejs") : "",
    process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, "Programs", "nodejs") : "",
  ].filter(Boolean);
  for (const dir of dirs) {
    for (const name of names) {
      const candidate = join(dir, name);
      if (await existsPath(candidate)) return candidate;
    }
  }
  return null;
}

async function tarballUrl(source: NormalizedSource): Promise<string> {
  if (source.source.type === "github") {
    return `https://codeload.github.com/${source.source.repo}/tar.gz/${source.source.ref ?? "HEAD"}`;
  }
  const pkg = source.source.packageName;
  const encoded = pkg.startsWith("@") ? pkg.replace("/", "%2F") : pkg;
  const spec = source.source.version === "latest" ? "latest" : source.source.version;
  const response = await fetch(`https://registry.npmjs.org/${encoded}/${spec}`, {
    headers: { "user-agent": "open-pages-addon-installer", accept: "application/json" },
  });
  if (!response.ok) throw new Error(`Package not found: ${pkg}`);
  const json = (await response.json()) as { dist?: { tarball?: string } };
  if (typeof json.dist?.tarball !== "string") throw new Error(`Package tarball missing: ${pkg}`);
  return json.dist.tarball;
}

async function downloadFile(
  url: string,
  dest: string,
  onPercent?: (percent: number) => void,
): Promise<void> {
  const response = await fetch(url, {
    headers: { "user-agent": "open-pages-addon-installer", accept: "application/octet-stream" },
    redirect: "follow",
  });
  if (!response.ok || !response.body) {
    throw new Error(`Download failed (${response.status || "no body"})`);
  }
  const total = Number(response.headers.get("content-length") ?? 0);
  const file = createWriteStream(dest);
  const reader = response.body.getReader();
  let received = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      await new Promise<void>((resolveWrite, rejectWrite) => {
        file.write(value, (error) => (error ? rejectWrite(error) : resolveWrite()));
      });
      if (total && onPercent) onPercent(received / total);
    }
  } finally {
    await new Promise<void>((resolveClose, rejectClose) => {
      file.end((error?: Error | null) => (error ? rejectClose(error) : resolveClose()));
    });
  }
}

type StageReport = (stage: InstallProgress["stage"], label: string, percent: number) => void;

async function installFromTarball(
  normalized: NormalizedSource,
  staging: string,
  report: StageReport,
): Promise<void> {
  const archive = join(staging, "package.tgz");
  const extractDir = join(staging, ".extract");
  await mkdir(extractDir, { recursive: true });
  report("download", "正在下载扩展", DOWNLOAD_START);
  const url = await tarballUrl(normalized);
  await downloadFile(url, archive, (percent) =>
    report(
      "download",
      "正在下载扩展",
      DOWNLOAD_START + (DOWNLOAD_END - DOWNLOAD_START) * percent,
    ),
  );
  report("download", "正在解压扩展", DOWNLOAD_END);
  await extractTar({ file: archive, cwd: extractDir, strip: 1 });
  await rm(archive, { force: true });
  const pkg = JSON.parse(await readFile(join(extractDir, "package.json"), "utf8")) as {
    name?: string;
    version?: string;
    dependencies?: Record<string, string>;
  };
  const packageName = pkg.name;
  if (typeof packageName !== "string" || !/^hexo-|^@[^/]+\/hexo-/.test(packageName)) {
    throw new Error("Installed package is not a Hexo theme or plugin");
  }
  if (Object.keys(pkg.dependencies ?? {}).length) {
    throw new Error("这个扩展还依赖其他包。请安装 Node.js（含 npm）后再试，或换一个无额外依赖的主题。");
  }
  const dest = join(staging, "node_modules", packageName);
  await mkdir(dirname(dest), { recursive: true });
  await rm(dest, { recursive: true, force: true });
  await rename(extractDir, dest);
  await writeFile(
    join(staging, "package.json"),
    `${JSON.stringify({
      private: true,
      dependencies: { [packageName]: pkg.version ?? "0.0.0" },
    })}\n`,
  );
}

async function runCommand(
  command: string,
  args: string[],
  cwd: string,
  onFetch?: (fetched: number) => void,
): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: {
        PATH: [process.env.PATH, dirname(process.execPath)].filter(Boolean).join(delimiter),
        HOME: process.env.HOME,
        npm_config_cache: process.env.npm_config_cache,
      },
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    let fetched = 0;
    const timer = setTimeout(() => child.kill("SIGKILL"), 120_000);
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr = `${stderr}${chunk}`.slice(-4_000);
      const downloads = chunk.match(/^npm http fetch GET 2\d\d /gm)?.length ?? 0;
      if (downloads && onFetch) {
        fetched += downloads;
        onFetch(fetched);
      }
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      if (code === 0) resolvePromise();
      else reject(new Error(stderr.trim() || `Package installation failed (${code})`));
    });
  });
}

async function withInstallGate<T>(owner: string, task: () => Promise<T>): Promise<T> {
  const previous = installTails.get(owner) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolvePromise) => {
    release = resolvePromise;
  });
  installTails.set(owner, current);
  await previous;
  try {
    return await task();
  } finally {
    release();
    if (installTails.get(owner) === current) installTails.delete(owner);
  }
}

  return {
    listAddons,
    resolveGenerationAddons,
    installAddon,
    setAddonEnabled,
    removeAddon,
  };
}

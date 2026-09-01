import { openDB, type IDBPDatabase } from "idb";
import {
  DEFAULT_SITE_CONFIG,
  parseSiteConfig,
  type SiteConfig,
  type SiteFile,
  type GithubBinding,
  aboutPageMarkdown,
  defaultHexoConfigYaml,
  welcomeMarkdown,
  WELCOME_POST_PATH,
} from "@open-pages/shared";

const DB_NAME = "open-pages";
const SITE_ID = "default";

interface FileRow {
  path: string;
  content: string;
  encoding: "utf8" | "base64";
  updatedAt: number;
}

interface MetaRow {
  key: string;
  config: SiteConfig;
  github?: GithubBinding;
  updatedAt: number;
}

let dbPromise: Promise<IDBPDatabase> | null = null;

function db() {
  dbPromise ??= openDB(DB_NAME, 1, {
    upgrade(database) {
      database.createObjectStore("files", { keyPath: "path" });
      database.createObjectStore("meta", { keyPath: "key" });
    },
  });
  return dbPromise;
}

export function siteId(): string {
  return SITE_ID;
}

export async function loadConfig(): Promise<{ config: SiteConfig; github?: GithubBinding }> {
  const database = await db();
  const row = (await database.get("meta", SITE_ID)) as MetaRow | undefined;
  if (row) return { config: parseSiteConfig(row.config), github: row.github };
  const config = { ...DEFAULT_SITE_CONFIG };
  await database.put("meta", { key: SITE_ID, config, updatedAt: Date.now() });
  return { config };
}

export async function saveConfig(config: SiteConfig, github?: GithubBinding): Promise<void> {
  const database = await db();
  await database.put("meta", { key: SITE_ID, config, github, updatedAt: Date.now() });
}

export async function listFiles(): Promise<FileRow[]> {
  const database = await db();
  const files = (await database.getAll("files")) as FileRow[];
  if (files.length) return files.sort((a, b) => a.path.localeCompare(b.path));
  const seeded: FileRow[] = [
    {
      path: "_config.yml",
      content: defaultHexoConfigYaml(DEFAULT_SITE_CONFIG),
      encoding: "utf8",
      updatedAt: Date.now(),
    },
    {
      path: WELCOME_POST_PATH,
      content: welcomeMarkdown(),
      encoding: "utf8",
      updatedAt: Date.now(),
    },
    {
      path: "source/about/index.md",
      content: aboutPageMarkdown(),
      encoding: "utf8",
      updatedAt: Date.now(),
    },
  ];
  for (const file of seeded) {
    await database.put("files", file);
  }
  return seeded;
}

export async function readFile(path: string): Promise<FileRow | undefined> {
  const database = await db();
  return database.get("files", path);
}

export async function writeFile(
  path: string,
  content: string,
  encoding: "utf8" | "base64" = "utf8",
): Promise<void> {
  const database = await db();
  await database.put("files", { path, content, encoding, updatedAt: Date.now() });
}

export async function deleteFile(path: string): Promise<void> {
  const database = await db();
  await database.delete("files", path);
}

export async function snapshotFiles(): Promise<SiteFile[]> {
  const files = await listFiles();
  return files.map(({ path, content, encoding }) => ({ path, content, encoding }));
}

export function fileName(path: string): string {
  return path.split("/").pop() ?? path;
}

const imageUrlCache = new Map<string, string>();

export async function uniqueUserPath(path: string): Promise<{ path: string; renamed: boolean }> {
  if (!(await readFile(path))) return { path, renamed: false };
  if (path.endsWith("/index.md")) {
    const dir = path.slice(0, -"/index.md".length);
    let index = 2;
    while (await readFile(`${dir}-${index}/index.md`)) index += 1;
    return { path: `${dir}-${index}/index.md`, renamed: true };
  }
  const dot = path.lastIndexOf(".");
  const stem = dot >= 0 ? path.slice(0, dot) : path;
  const ext = dot >= 0 ? path.slice(dot) : "";
  let index = 2;
  while (await readFile(`${stem}-${index}${ext}`)) index += 1;
  return { path: `${stem}-${index}${ext}`, renamed: true };
}

export async function storeLocalImage(file: File): Promise<string> {
  const safe = (file.name || "image.png").replace(/[^\w.\-]+/g, "-");
  const filename = `${Date.now()}-${safe}`;
  const path = `source/images/${filename}`;
  await writeFile(path, await blobToBase64(file), "base64");
  const publicPath = `/images/${filename}`;
  const previous = imageUrlCache.get(publicPath);
  if (previous) URL.revokeObjectURL(previous);
  imageUrlCache.set(publicPath, URL.createObjectURL(file));
  return publicPath;
}

export async function resolveLocalImageUrl(url: string): Promise<string> {
  if (!url.startsWith("/images/")) return url;
  const cached = imageUrlCache.get(url);
  if (cached) return cached;
  const file = await readFile(`source/images/${url.slice("/images/".length)}`);
  if (!file) return url;
  const previous = imageUrlCache.get(url);
  if (previous) URL.revokeObjectURL(previous);
  const objectUrl = URL.createObjectURL(base64ToBlob(file.content, mimeFromPath(file.path)));
  imageUrlCache.set(url, objectUrl);
  return objectUrl;
}

function mimeFromPath(path: string): string {
  if (/\.png$/i.test(path)) return "image/png";
  if (/\.jpe?g$/i.test(path)) return "image/jpeg";
  if (/\.gif$/i.test(path)) return "image/gif";
  if (/\.webp$/i.test(path)) return "image/webp";
  if (/\.svg$/i.test(path)) return "image/svg+xml";
  return "application/octet-stream";
}

function blobToBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      resolve(result.includes(",") ? result.split(",")[1]! : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function base64ToBlob(base64: string, mime: string): Blob {
  const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
  return new Blob([bytes], { type: mime });
}

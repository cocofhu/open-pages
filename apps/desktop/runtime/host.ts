import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { lstat, readFile, realpath } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { assessRepoForPublish, createRepo, listRepos } from "@open-pages/github";
import { localSiteDir, previewLocalSite, publishSite } from "@open-pages/publish";
import { isSafeSiteId, parseRepoName, type SiteConfig, type SiteFile } from "@open-pages/shared";

const controlPort = Number(process.env.OPEN_PAGES_CONTROL_PORT ?? 3848);
const previewPort = Number(process.env.OPEN_PAGES_PREVIEW_PORT ?? 8788);
const previewOrigin = process.env.OPEN_PAGES_PREVIEW_ORIGIN ?? `http://127.0.0.1:${previewPort}`;

const CONTENT_TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8",
  htm: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  json: "application/json; charset=utf-8",
  map: "application/json; charset=utf-8",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  ico: "image/x-icon",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  xml: "application/xml; charset=utf-8",
  txt: "text/plain; charset=utf-8",
};

function contentType(path: string): string {
  const ext = path.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  return (ext && CONTENT_TYPES[ext]) || "text/plain; charset=utf-8";
}

function isInside(root: string, target: string): boolean {
  const base = resolve(root);
  const abs = resolve(target);
  return abs === base || abs.startsWith(base + sep);
}

function readBearer(req: IncomingMessage): string {
  const header = req.headers.authorization ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match?.[1]) throw new Error("Not signed in");
  return match[1];
}

async function readJson<T>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  if (!chunks.length) return {} as T;
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function sendText(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
  res.end(body);
}

async function readPublicFile(siteId: string, relPath: string): Promise<{ body: Buffer; path: string } | null> {
  const dir = localSiteDir(siteId);
  const publicRoot = resolve(dir, "public");
  let realRoot: string;
  try {
    realRoot = await realpath(publicRoot);
  } catch {
    return null;
  }
  if (!isInside(dir, realRoot)) return null;
  const safe = relPath.replace(/^\/+/, "").replace(/\/+$/, "").replaceAll("\\", "/");
  if (safe.includes("..")) return null;

  const tryRead = async (abs: string) => {
    if (!isInside(publicRoot, abs) && !isInside(realRoot, abs)) return null;
    try {
      const info = await lstat(abs);
      if (info.isSymbolicLink()) return null;
      if (info.isDirectory()) {
        const index = resolve(abs, "index.html");
        if (!isInside(publicRoot, index) && !isInside(realRoot, index)) return null;
        return tryRead(index);
      }
      if (!info.isFile()) return null;
      const realAbs = await realpath(abs);
      if (!isInside(realRoot, realAbs)) return null;
      return { body: await readFile(abs), path: relative(publicRoot, abs) };
    } catch {
      return null;
    }
  };

  return (
    (await tryRead(resolve(publicRoot, safe))) ??
    (await tryRead(resolve(publicRoot, safe, "index.html"))) ??
    (!safe.includes(".") || /\.html?$/i.test(safe) ? tryRead(resolve(publicRoot, "index.html")) : null)
  );
}

async function handleControl(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${controlPort}`);
  try {
    if (req.method === "GET" && url.pathname === "/health") {
      sendJson(res, 200, { ok: true });
      return;
    }
    if (req.method === "GET" && url.pathname === "/repos") {
      const repos = await listRepos(readBearer(req));
      sendJson(res, 200, { repos });
      return;
    }
    if (req.method === "POST" && url.pathname === "/repos") {
      const body = await readJson<{ name: string; private?: boolean }>(req);
      const repo = await createRepo(readBearer(req), parseRepoName(body.name), Boolean(body.private));
      sendJson(res, 200, repo);
      return;
    }
    const publishCheck = url.pathname.match(/^\/repos\/([^/]+)\/([^/]+)\/publish-check$/);
    if (req.method === "GET" && publishCheck) {
      const owner = decodeURIComponent(publishCheck[1]);
      const repo = parseRepoName(decodeURIComponent(publishCheck[2]));
      const siteId = url.searchParams.get("siteId") ?? "default";
      if (!isSafeSiteId(siteId)) {
        sendJson(res, 400, { error: "Invalid site id" });
        return;
      }
      const check = await assessRepoForPublish(readBearer(req), owner, repo, siteId);
      sendJson(res, 200, check);
      return;
    }
    if (req.method === "POST" && url.pathname === "/preview") {
      const body = await readJson<{ siteId: string; files: SiteFile[]; config?: SiteConfig }>(req);
      const result = await previewLocalSite({
        siteId: body.siteId,
        files: body.files ?? [],
        config: body.config,
        previewOrigin,
      });
      sendJson(res, 200, { ok: true, elapsedMs: result.elapsedMs, url: result.url });
      return;
    }
    if (req.method === "POST" && url.pathname === "/publish") {
      const token = readBearer(req);
      const body = await readJson<{
        siteId: string;
        files: SiteFile[];
        config?: unknown;
        owner: string;
        repo: string;
        createRepo?: boolean;
      }>(req);
      const result = await publishSite({
        token,
        siteId: body.siteId,
        files: body.files ?? [],
        config: body.config,
        owner: body.owner,
        repo: body.repo,
        createRepo: body.createRepo,
      });
      sendJson(res, 200, { ok: true, ...result });
      return;
    }
    sendJson(res, 404, { error: "Not found" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Server error";
    const status = message === "Not signed in" ? 401 : 400;
    sendJson(res, status, { error: message });
  }
}

async function handlePreview(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${previewPort}`);
  const match = url.pathname.match(/^\/preview\/([^/]+)(?:\/(.*))?$/);
  if (!match) {
    sendText(res, 404, "Not found");
    return;
  }
  if (!match[2] && !url.pathname.endsWith("/")) {
    res.writeHead(302, { location: `${url.pathname}/` });
    res.end();
    return;
  }
  const file = await readPublicFile(decodeURIComponent(match[1]), match[2] || "index.html");
  if (!file) {
    sendText(res, 404, "Not found");
    return;
  }
  res.writeHead(200, {
    "content-type": contentType(file.path),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  res.end(file.body);
}

function listen(port: number, handler: (req: IncomingMessage, res: ServerResponse) => void): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer(handler);
    const fail = (error: Error) => {
      server.close();
      reject(error);
    };
    server.once("error", fail);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", fail);
      server.on("error", (error) => {
        console.error(`open-pages desktop server error on ${port}:`, error);
      });
      const addr = server.address();
      resolve(typeof addr === "object" && addr ? addr.port : port);
    });
  });
}

try {
  const boundControl = await listen(controlPort, (req, res) => {
    void handleControl(req, res);
  });
  const boundPreview = await listen(previewPort, (req, res) => {
    void handlePreview(req, res);
  });
  console.log(`open-pages desktop control listening on http://127.0.0.1:${boundControl}`);
  console.log(`open-pages desktop preview listening on http://127.0.0.1:${boundPreview}`);
} catch (error) {
  console.error("open-pages desktop runtime failed to listen", error);
  process.exit(1);
}

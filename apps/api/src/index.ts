import { mkdir } from "node:fs/promises";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { env } from "./env.js";
import { asClientError } from "./errors.js";
import { sessionMiddleware, type SessionData } from "./session.js";
import { authRoutes } from "./routes/auth.js";
import { addonRoutes } from "./routes/addons.js";
import { siteRoutes } from "./routes/sites.js";
import { readPublicFile } from "./lib/workspace.js";
import { readPreviewKey } from "./lib/preview-token.js";

await mkdir(env.workspaceRoot, { recursive: true });

const app = new Hono<{ Variables: { session: SessionData } }>();

app.use(
  "*",
  cors({
    origin: env.appOrigin,
    credentials: true,
  }),
);
app.use("*", sessionMiddleware);

app.get("/health", (c) => c.json({ ok: true }));
app.route("/auth", authRoutes);
app.route("/addons", addonRoutes);
app.route("/sites", siteRoutes);

app.notFound((c) => c.json({ error: "Not found" }, 404));
app.onError((error, c) => {
  const client = asClientError(error);
  if (client) return c.json({ error: client.message }, client.status);
  console.error(error);
  return c.json({ error: "Server error" }, 500);
});

/**
 * The preview runs on its own origin that holds no session cookie and exposes
 * no app API, so theme scripts are free to run: the isolation comes from the
 * origin boundary rather than from stripping the page apart. `frame-ancestors`
 * keeps the capability URL embeddable only by the editor itself.
 */
const previewApp = new Hono();

previewApp.get("/preview/:key", (c) => c.redirect(`/preview/${c.req.param("key")}/`));

previewApp.get("/preview/:key/*", async (c) => {
  const key = c.req.param("key");
  const site = readPreviewKey(key);
  if (!site) return c.text("Not found", 404);
  const leftover = c.req.path.slice(`/preview/${key}`.length);
  const rel = leftover.replace(/\/+$/, "") || "index.html";
  const file = await readPublicFile(site.owner, site.siteId, rel);
  // Plain text keeps a missing asset visible as a 404 instead of being swallowed
  // as an opaque-response block when the browser expected CSS or an image.
  if (!file) return c.text("Not found", 404);
  return new Response(file.body, {
    headers: {
      // Typed from the resolved file, never from the request path: a page URL
      // like /2026/09/01/post/ carries no extension, and guessing from it
      // labelled real pages as a download, which browsers refuse to navigate to.
      "content-type": contentType(file.path),
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "content-security-policy": `frame-ancestors ${env.appOrigin}`,
      "referrer-policy": "no-referrer",
    },
  });
});

previewApp.notFound((c) => c.text("Not found", 404));

const CONTENT_TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8",
  htm: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  json: "application/json; charset=utf-8",
  map: "application/json; charset=utf-8",
  webmanifest: "application/manifest+json; charset=utf-8",
  xml: "application/xml; charset=utf-8",
  txt: "text/plain; charset=utf-8",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  avif: "image/avif",
  gif: "image/gif",
  bmp: "image/bmp",
  ico: "image/x-icon",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
  eot: "application/vnd.ms-fontobject",
  mp3: "audio/mpeg",
  mp4: "video/mp4",
  webm: "video/webm",
  wasm: "application/wasm",
  pdf: "application/pdf",
};

/**
 * Typed from the file that was actually read, so a page URL like
 * /2026/09/01/post/ arrives here as `.../index.html` rather than as an
 * extensionless path that has to be guessed at.
 *
 * Unknown extensions fall back to plain text rather than octet-stream: this
 * server only ever hands back a generated site, and a download prompt in the
 * middle of a preview is a worse failure than a file rendered as text.
 */
function contentType(path: string): string {
  const ext = path.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  return (ext && CONTENT_TYPES[ext]) || "text/plain; charset=utf-8";
}

serve({ fetch: app.fetch, port: env.port }, (info) => {
  console.log(`open-pages api listening on http://localhost:${info.port}`);
});

serve({ fetch: previewApp.fetch, port: env.previewPort }, (info) => {
  console.log(`open-pages preview listening on http://localhost:${info.port}`);
});

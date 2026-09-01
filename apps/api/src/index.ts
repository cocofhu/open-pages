import { mkdir } from "node:fs/promises";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { env } from "./env.js";
import { asClientError } from "./errors.js";
import { ownerKey, sessionMiddleware, type SessionData } from "./session.js";
import { authRoutes } from "./routes/auth.js";
import { siteRoutes } from "./routes/sites.js";
import { readPublicFile } from "./lib/workspace.js";
import { isSafeSiteId } from "@open-pages/shared";

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
app.route("/sites", siteRoutes);

app.get("/preview/:siteId", (c) => {
  const siteId = c.req.param("siteId");
  if (!isSafeSiteId(siteId)) return c.notFound();
  return c.redirect(`/preview/${siteId}/`);
});

app.get("/preview/:siteId/*", async (c) => {
  const session = c.get("session");
  const siteId = c.req.param("siteId");
  if (!isSafeSiteId(siteId)) return c.notFound();
  const leftover = c.req.path.slice(`/preview/${siteId}`.length);
  const rel = leftover.replace(/\/+$/, "") || "index.html";
  const file = await readPublicFile(ownerKey(session), siteId, rel);
  if (!file) return c.notFound();
  const path = leftover.replace(/\/+$/, "") || "/index.html";
  return new Response(file, {
    headers: {
      "content-type": contentType(path),
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "content-security-policy": previewCsp(path),
      "referrer-policy": "no-referrer",
      "x-frame-options": "SAMEORIGIN",
    },
  });
});

app.use("/assets/*", serveStatic({ root: "./" }));

app.notFound((c) => c.json({ error: "Not found" }, 404));
app.onError((error, c) => {
  const client = asClientError(error);
  if (client) return c.json({ error: client.message }, client.status);
  console.error(error);
  return c.json({ error: "Server error" }, 500);
});

function previewCsp(path: string): string {
  if (path.endsWith(".css")) return "default-src 'none'; style-src 'unsafe-inline'";
  if (/\.(js|mjs)$/i.test(path)) return "default-src 'none'";
  return (
    "default-src 'none'; base-uri 'none'; form-action 'self'; " +
    "script-src 'none'; style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data: https: blob:; font-src 'self' data:; " +
    "connect-src 'none'; frame-src 'none'; object-src 'none'"
  );
}

function contentType(path: string): string {
  if (path.endsWith(".css")) return "text/css; charset=utf-8";
  if (path.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (path.endsWith(".json")) return "application/json; charset=utf-8";
  if (path.endsWith(".xml")) return "application/xml; charset=utf-8";
  if (path.endsWith(".svg")) return "image/svg+xml";
  if (path.endsWith(".png")) return "image/png";
  if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg";
  if (path.endsWith(".webp")) return "image/webp";
  if (path.endsWith(".gif")) return "image/gif";
  if (path.endsWith(".ico")) return "image/x-icon";
  if (path.endsWith(".woff")) return "font/woff";
  if (path.endsWith(".woff2")) return "font/woff2";
  if (path.endsWith(".ttf")) return "font/ttf";
  if (path.endsWith(".otf")) return "font/otf";
  if (path.endsWith(".eot")) return "application/vnd.ms-fontobject";
  if (path.endsWith(".map")) return "application/json; charset=utf-8";
  if (/\.html?$/i.test(path) || path.endsWith("/")) return "text/html; charset=utf-8";
  return "application/octet-stream";
}

serve({ fetch: app.fetch, port: env.port }, (info) => {
  console.log(`open-pages api listening on http://localhost:${info.port}`);
});

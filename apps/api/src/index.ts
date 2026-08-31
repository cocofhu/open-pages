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
  const file = await readPublicFile(ownerKey(session), siteId, leftover || "index.html");
  if (!file) return c.notFound();
  const path = leftover || "/index.html";
  return new Response(file, {
    headers: {
      "content-type": contentType(path),
      "cache-control": "no-store",
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
  return "text/html; charset=utf-8";
}

serve({ fetch: app.fetch, port: env.port }, (info) => {
  console.log(`open-pages api listening on http://localhost:${info.port}`);
});

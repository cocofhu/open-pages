import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { isThemeId, type AddonKind } from "@open-pages/shared";
import { ClientError } from "../errors.js";
import type { SessionData } from "../session.js";
import { ownerKey } from "../session.js";
import {
  installAddon,
  listAddons,
  removeAddon,
  setAddonEnabled,
} from "../lib/addons.js";
import { createRateLimiter, requestIp } from "../lib/rate-limit.js";
import { env } from "../env.js";

export const addonRoutes = new Hono<{ Variables: { session: SessionData } }>();
const installLimiter = createRateLimiter({ windowMs: 60_000, max: 2 });
const installIpLimiter = createRateLimiter({ windowMs: 60_000, max: 2 });

addonRoutes.get("/", async (c) => {
  const rawKind = c.req.query("kind");
  const kind = rawKind === "theme" || rawKind === "plugin" ? rawKind : undefined;
  return c.json({ addons: await listAddons(ownerKey(c.get("session")), kind) });
});

addonRoutes.post("/install", async (c) => {
  const session = c.get("session");
  if (!session.userId && !env.allowGuestAddons) {
    throw new ClientError("Sign in before installing third-party addons", 401);
  }
  const owner = ownerKey(session);
  const budget = installLimiter.check(owner);
  const ipBudget = installIpLimiter.check(requestIp(c));
  if (!budget.ok || !ipBudget.ok) throw new ClientError("Too many addon installs, try again shortly", 429);
  const body = (await c.req.json()) as { source?: unknown; kind?: unknown };
  if (typeof body.source !== "string") throw new ClientError("Addon source is required");
  const source = body.source;
  const kind: AddonKind | undefined =
    body.kind === "theme" || body.kind === "plugin" ? body.kind : undefined;

  if (!c.req.header("accept")?.includes("text/event-stream")) {
    return c.json({ addon: await installAddon(owner, source, kind) }, 201);
  }

  return streamSSE(c, async (stream) => {
    const send = (payload: Record<string, unknown>) =>
      stream.writeSSE({ data: JSON.stringify(payload) });
    try {
      const addon = await installAddon(owner, source, kind, (progress) => {
        void send({ type: "progress", ...progress });
      });
      await send({ type: "done", addon });
    } catch (error) {
      await send({
        type: "error",
        error: error instanceof Error ? error.message : "安装失败",
      });
    }
  });
});

addonRoutes.patch("/:id", async (c) => {
  const id = c.req.param("id");
  if (!isThemeId(id)) throw new ClientError("Invalid addon id");
  const body = (await c.req.json()) as { enabled?: unknown };
  if (typeof body.enabled !== "boolean") throw new ClientError("enabled must be boolean");
  return c.json({
    addon: await setAddonEnabled(ownerKey(c.get("session")), id, body.enabled),
  });
});

addonRoutes.delete("/:id", async (c) => {
  const id = c.req.param("id");
  if (!isThemeId(id)) throw new ClientError("Invalid addon id");
  await removeAddon(ownerKey(c.get("session")), id);
  return c.json({ ok: true });
});

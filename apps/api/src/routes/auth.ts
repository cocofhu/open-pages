import { Hono } from "hono";
import { env, githubConfigured } from "../env.js";
import {
  type SessionData,
  clearSessionCookie,
  writeSessionCookie,
} from "../session.js";
import { authorizeUrl, exchangeCode, octokit } from "../lib/github.js";

export const authRoutes = new Hono<{ Variables: { session: SessionData } }>();

authRoutes.get("/me", (c) => {
  const session = c.get("session");
  return c.json({
    guestId: session.guestId,
    login: session.login ?? null,
    name: session.name ?? null,
    avatarUrl: session.avatarUrl ?? null,
    githubEnabled: githubConfigured(),
  });
});

authRoutes.get("/github", async (c) => {
  if (!githubConfigured()) {
    return c.json({ error: "GitHub OAuth is not configured" }, 501);
  }
  const state = crypto.randomUUID();
  const session = c.get("session");
  await writeSessionCookie(c, { ...session, oauthState: state });
  return c.redirect(authorizeUrl(state));
});

authRoutes.get("/github/callback", async (c) => {
  const code = c.req.query("code");
  const state = c.req.query("state");
  const session = c.get("session");
  if (!code || !state || !session.oauthState || state !== session.oauthState) {
    return c.redirect(`${env.appOrigin}/?auth=error`);
  }
  try {
    const token = await exchangeCode(code);
    const { data: user } = await octokit(token).users.getAuthenticated();
    const next: SessionData = {
      ...session,
      userId: String(user.id),
      githubId: user.id,
      login: user.login,
      name: user.name ?? user.login,
      avatarUrl: user.avatar_url,
      accessToken: token,
    };
    delete next.oauthState;
    await writeSessionCookie(c, next);
    return c.redirect(`${env.appOrigin}/?auth=ok`);
  } catch {
    return c.redirect(`${env.appOrigin}/?auth=error`);
  }
});

authRoutes.post("/logout", async (c) => {
  clearSessionCookie(c);
  return c.json({ ok: true });
});

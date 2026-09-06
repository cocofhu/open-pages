import { Hono } from "hono";
import { fetchGitHubUser, pollDeviceToken, requestDeviceCode } from "@open-pages/github-auth";
import { env, githubConfigured } from "../env.js";
import {
  type SessionData,
  clearSessionCookie,
  writeSessionCookie,
} from "../session.js";

export const authRoutes = new Hono<{ Variables: { session: SessionData } }>();

function authUser(session: SessionData) {
  return {
    guestId: session.guestId,
    login: session.login ?? null,
    name: session.name ?? null,
    avatarUrl: session.avatarUrl ?? null,
    githubEnabled: githubConfigured(),
  };
}

function deviceErrorMessage(code: string, fallback: string): string {
  switch (code) {
    case "expired_token":
      return "GitHub 登录码已过期，请重新登录。";
    case "access_denied":
      return "GitHub 登录被拒绝。";
    case "unauthorized_client":
    case "unsupported_grant_type":
      return "这个 GitHub 应用还没开启 Device Flow。";
    default:
      return fallback;
  }
}

authRoutes.get("/me", (c) => c.json(authUser(c.get("session"))));

authRoutes.get("/github", (c) => c.redirect(env.appOrigin));
authRoutes.get("/github/callback", (c) => c.redirect(env.appOrigin));

authRoutes.post("/github/device", async (c) => {
  if (!githubConfigured()) {
    return c.json({ error: "GitHub OAuth is not configured" }, 501);
  }
  try {
    const device = await requestDeviceCode(env.githubClientId);
    const session = c.get("session");
    await writeSessionCookie(c, {
      ...session,
      deviceLogin: {
        deviceCode: device.deviceCode,
        interval: device.interval,
        expiresAt: Date.now() + device.expiresIn * 1000,
      },
    });
    return c.json({
      userCode: device.userCode,
      verificationUri: device.verificationUri,
      verificationUriComplete: device.verificationUriComplete,
      interval: device.interval,
      expiresIn: device.expiresIn,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "无法开始 GitHub 登录";
    return c.json({ error: message }, 400);
  }
});

authRoutes.post("/github/device/poll", async (c) => {
  const session = c.get("session");
  const pending = session.deviceLogin;
  if (!pending) {
    return c.json({ error: "没有进行中的 GitHub 登录" }, 400);
  }
  if (Date.now() >= pending.expiresAt) {
    delete session.deviceLogin;
    await writeSessionCookie(c, session);
    return c.json({ error: "GitHub 登录码已过期，请重新登录。" }, 400);
  }
  const result = await pollDeviceToken(env.githubClientId, pending.deviceCode);
  if (result.status === "pending") {
    return c.json({ status: "pending" }, 202);
  }
  if (result.status === "slow_down") {
    return c.json({ status: "slow_down" }, 202);
  }
  if (result.status === "error") {
    if (result.code === "expired_token" || result.code === "access_denied") {
      delete session.deviceLogin;
      await writeSessionCookie(c, session);
    }
    return c.json({ error: deviceErrorMessage(result.code, result.message) }, 400);
  }

  const user = await fetchGitHubUser(result.accessToken);
  const next: SessionData = {
    ...session,
    userId: String(user.id),
    githubId: user.id,
    login: user.login,
    name: user.name,
    avatarUrl: user.avatarUrl,
    accessToken: result.accessToken,
  };
  delete next.deviceLogin;
  await writeSessionCookie(c, next);
  return c.json({ status: "ok", ...authUser(next) });
});

authRoutes.post("/logout", async (c) => {
  clearSessionCookie(c);
  return c.json({ ok: true });
});

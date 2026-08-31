import { createMiddleware } from "hono/factory";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { seal, unseal, defaults } from "iron-webcrypto";
import { isSafeWorkspaceId } from "@open-pages/shared";
import { ClientError } from "./errors.js";
import { env } from "./env.js";

export interface SessionData {
  guestId: string;
  userId?: string;
  githubId?: number;
  login?: string;
  name?: string;
  avatarUrl?: string;
  accessToken?: string;
  oauthState?: string;
}

const COOKIE = "op_session";
const password = env.sessionSecret.padEnd(32, "x");

export async function readSession(cookie: string | undefined): Promise<SessionData | null> {
  if (!cookie) return null;
  try {
    return (await unseal(globalThis.crypto, cookie, password, defaults)) as SessionData;
  } catch {
    return null;
  }
}

export async function writeSessionCookie(
  c: { header: (name: string, value: string) => void },
  data: SessionData,
): Promise<void> {
  const sealed = await seal(globalThis.crypto, data, password, defaults);
  setCookie(c as never, COOKIE, sealed, {
    httpOnly: true,
    sameSite: "Lax",
    secure: env.appOrigin.startsWith("https:"),
    path: "/",
    maxAge: 60 * 60 * 24 * 14,
  });
}

export const sessionMiddleware = createMiddleware<{
  Variables: { session: SessionData };
}>(async (c, next) => {
  const cookie = getCookie(c, COOKIE);
  let session = await readSession(cookie);
  if (!session) {
    session = { guestId: crypto.randomUUID() };
    await writeSessionCookie(c, session);
  }
  c.set("session", session);
  await next();
});

export function clearSessionCookie(c: { header: (name: string, value: string) => void }): void {
  deleteCookie(c as never, COOKIE, { path: "/" });
}

export function ownerKey(session: SessionData): string {
  const key = session.userId ?? `guest-${session.guestId}`;
  if (!isSafeWorkspaceId(key)) {
    throw new ClientError("Invalid session", 401);
  }
  return key;
}

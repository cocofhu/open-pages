import { createHmac, timingSafeEqual } from "node:crypto";
import { isSafeSiteId, isSafeWorkspaceId } from "@open-pages/shared";
import { env } from "../env.js";

/**
 * Previews are addressed by a capability key instead of the app session, so the
 * preview origin never needs the session cookie and the frame can safely be a
 * foreign origin that runs theme JavaScript.
 *
 * The key is derived rather than stored, and is stable for a given site: every
 * regenerated build keeps the same URL, which matters because the generated
 * HTML has all of its asset paths rebased onto that prefix.
 */

const TAG_BYTES = 16;

function tagFor(payload: string): string {
  return createHmac("sha256", env.sessionSecret)
    .update(`preview:${payload}`)
    .digest("hex")
    .slice(0, TAG_BYTES * 2);
}

export function previewKey(owner: string, siteId: string): string {
  const payload = Buffer.from(`${owner}/${siteId}`, "utf8").toString("base64url");
  return `${payload}.${tagFor(payload)}`;
}

export function readPreviewKey(key: string): { owner: string; siteId: string } | null {
  const split = key.lastIndexOf(".");
  if (split <= 0) return null;
  const payload = key.slice(0, split);
  const tag = key.slice(split + 1);

  const expected = Buffer.from(tagFor(payload), "utf8");
  const actual = Buffer.from(tag, "utf8");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;

  let decoded: string;
  try {
    decoded = Buffer.from(payload, "base64url").toString("utf8");
  } catch {
    return null;
  }
  const cut = decoded.lastIndexOf("/");
  if (cut <= 0) return null;
  const owner = decoded.slice(0, cut);
  const siteId = decoded.slice(cut + 1);
  if (!isSafeWorkspaceId(owner) || !isSafeSiteId(siteId)) return null;
  return { owner, siteId };
}

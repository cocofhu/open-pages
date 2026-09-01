import { existsSync } from "node:fs";
import { resolve } from "node:path";

for (const file of [resolve(process.cwd(), ".env"), resolve(process.cwd(), "../../.env")]) {
  if (existsSync(file) && typeof process.loadEnvFile === "function") {
    process.loadEnvFile(file);
  }
}

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) {
    throw new Error(`Missing environment variable ${name}`);
  }
  return value;
}

function originOf(value: string, name: string): string {
  try {
    return new URL(value).origin;
  } catch {
    throw new Error(`Invalid ${name}: ${value}`);
  }
}

const previewPort = Number(process.env.PREVIEW_PORT ?? 8788);
const appOrigin = process.env.APP_ORIGIN ?? "http://localhost:5173";
const previewOrigin = process.env.PREVIEW_ORIGIN ?? `http://localhost:${previewPort}`;
if (originOf(appOrigin, "APP_ORIGIN") === originOf(previewOrigin, "PREVIEW_ORIGIN")) {
  throw new Error("PREVIEW_ORIGIN must be a different origin from APP_ORIGIN");
}

export const env = {
  port: Number(process.env.PORT ?? 8787),
  appOrigin,
  apiOrigin: process.env.API_ORIGIN ?? "http://localhost:8787",
  // Generated sites run untrusted third-party theme code. Serving them from
  // their own origin keeps that code away from the app's session cookie and
  // DOM, which is what makes it safe to let the preview execute scripts.
  previewPort,
  previewOrigin,
  sessionSecret: (() => {
    const value = required("SESSION_SECRET");
    if (value.length < 32) {
      throw new Error("SESSION_SECRET must be at least 32 characters");
    }
    return value;
  })(),
  githubClientId: process.env.GITHUB_CLIENT_ID ?? "",
  githubClientSecret: process.env.GITHUB_CLIENT_SECRET ?? "",
  workspaceRoot: resolve(process.env.WORKSPACE_ROOT ?? "./workspaces"),
  allowGuestAddons: process.env.ALLOW_GUEST_ADDONS === "true",
};

export function githubConfigured(): boolean {
  return Boolean(env.githubClientId && env.githubClientSecret);
}

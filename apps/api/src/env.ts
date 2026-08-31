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

export const env = {
  port: Number(process.env.PORT ?? 8787),
  appOrigin: process.env.APP_ORIGIN ?? "http://localhost:5173",
  apiOrigin: process.env.API_ORIGIN ?? "http://localhost:8787",
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
};

export function githubConfigured(): boolean {
  return Boolean(env.githubClientId && env.githubClientSecret);
}

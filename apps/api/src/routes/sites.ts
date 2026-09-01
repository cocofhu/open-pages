import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Hono } from "hono";
import { listPublicFiles } from "@open-pages/hexo-runner";
import {
  DEFAULT_SITE_CONFIG,
  isSafeSiteId,
  isUserEditablePath,
  pagesRoot,
  pagesUrl,
  parseRepoName,
  parseSiteConfig,
  type SiteConfig,
  type SiteFile,
} from "@open-pages/shared";
import { ClientError } from "../errors.js";
import type { SessionData } from "../session.js";
import { ownerKey } from "../session.js";
import {
  ensureSite,
  generatePublishedSite,
  previewSite,
  previewUrl,
  resetSite,
  syncSite,
} from "../lib/workspace.js";
import { commitFiles, createRepo, enablePages, listRepos } from "../lib/github.js";
import { createConcurrencyGate, createRateLimiter, requestIp } from "../lib/rate-limit.js";

export const siteRoutes = new Hono<{ Variables: { session: SessionData } }>();

// Settings studio regenerates on every theme/option change; keep headroom for
// a full built-in theme sweep (and CI shards) inside one minute.
const previewLimiter = createRateLimiter({ windowMs: 60_000, max: 60 });
const previewIpLimiter = createRateLimiter({ windowMs: 60_000, max: 60 });
const publishLimiter = createRateLimiter({ windowMs: 60_000, max: 3 });
const publishIpLimiter = createRateLimiter({ windowMs: 60_000, max: 3 });
const generateGate = createConcurrencyGate(2, 16);

function siteIdParam(c: { req: { param: (name: string) => string } }): string {
  const siteId = c.req.param("siteId");
  if (!isSafeSiteId(siteId)) throw new ClientError("Invalid site id");
  return siteId;
}

function optionalConfig(raw: unknown): SiteConfig | undefined {
  if (raw == null) return undefined;
  return parseSiteConfig(raw);
}

function assertGenerateBudget(
  c: { req: { header: (name: string) => string | undefined } },
  session: SessionData,
  kind: "preview" | "publish",
): void {
  const owner = ownerKey(session);
  const ip = requestIp(c);
  const limiter = kind === "preview" ? previewLimiter : publishLimiter;
  const ipLimiter = kind === "preview" ? previewIpLimiter : publishIpLimiter;
  if (!limiter.check(`${kind}:${owner}`).ok || !ipLimiter.check(`${kind}:${ip}`).ok) {
    throw new ClientError("Too many requests, try again shortly", 429);
  }
}

/** Only commit paths the server would accept for workspace writes. */
function publishableSourceFiles(files: SiteFile[]): SiteFile[] {
  return files.filter((file) => isUserEditablePath(file.path));
}

siteRoutes.get("/github/repos", async (c) => {
  const session = c.get("session");
  if (!session.accessToken) return c.json({ error: "Not signed in" }, 401);
  const repos = await listRepos(session.accessToken);
  return c.json({ repos });
});

siteRoutes.post("/github/repos", async (c) => {
  const session = c.get("session");
  if (!session.accessToken) return c.json({ error: "Not signed in" }, 401);
  const body = (await c.req.json()) as { name: string; private?: boolean };
  const repo = await createRepo(session.accessToken, parseRepoName(body.name), Boolean(body.private));
  return c.json(repo);
});

siteRoutes.post("/:siteId/ensure", async (c) => {
  const session = c.get("session");
  const body = (await c.req.json().catch(() => ({}))) as { config?: unknown };
  await ensureSite(ownerKey(session), siteIdParam(c), optionalConfig(body.config) ?? DEFAULT_SITE_CONFIG);
  return c.json({ ok: true });
});

siteRoutes.post("/:siteId/sync", async (c) => {
  const session = c.get("session");
  const body = (await c.req.json()) as { files: SiteFile[]; config?: unknown };
  await syncSite(ownerKey(session), siteIdParam(c), body.files ?? [], optionalConfig(body.config));
  return c.json({ ok: true });
});

siteRoutes.post("/:siteId/preview", async (c) => {
  const session = c.get("session");
  assertGenerateBudget(c, session, "preview");
  const body = (await c.req.json()) as { files: SiteFile[]; config?: unknown };
  const siteId = siteIdParam(c);
  const result = await generateGate.run(() =>
    previewSite(ownerKey(session), siteId, body.files ?? [], optionalConfig(body.config)),
  );
  return c.json({
    ok: true,
    elapsedMs: result.elapsedMs,
    url: previewUrl(ownerKey(session), siteId),
  });
});

siteRoutes.post("/:siteId/reset", async (c) => {
  const session = c.get("session");
  await resetSite(ownerKey(session), siteIdParam(c));
  return c.json({ ok: true });
});

siteRoutes.post("/:siteId/publish", async (c) => {
  const session = c.get("session");
  if (!session.accessToken || !session.login) {
    return c.json({ error: "Not signed in" }, 401);
  }
  assertGenerateBudget(c, session, "publish");
  const body = (await c.req.json()) as {
    files: SiteFile[];
    config?: unknown;
    owner?: string;
    repo: string;
    createRepo?: boolean;
  };
  if (body.owner && body.owner !== session.login) {
    throw new ClientError("Cannot publish to another owner", 403);
  }
  const owner = session.login;
  const repo = parseRepoName(body.repo);

  if (body.createRepo) {
    await createRepo(session.accessToken, repo, false);
  }

  const config = body.config
    ? parseSiteConfig({
        ...parseSiteConfig(body.config),
        url: pagesUrl(owner, repo).replace(/\/$/, ""),
        root: pagesRoot(owner, repo),
      })
    : undefined;

  const { dir } = await generateGate.run(() =>
    generatePublishedSite(ownerKey(session), siteIdParam(c), body.files ?? [], config),
  );
  const sourceFiles = publishableSourceFiles(body.files ?? []).filter((file) => file.path !== "_config.yml");
  try {
    sourceFiles.push({
      path: "_config.yml",
      content: await readFile(join(dir, "_config.yml"), "utf8"),
    });
  } catch {
    // keep empty if missing
  }

  await commitFiles({
    token: session.accessToken,
    owner,
    repo,
    branch: "main",
    message: "chore: update site source from Open Pages",
    files: sourceFiles,
  });

  const publicFiles = await listPublicFiles(join(dir, "public"));
  await commitFiles({
    token: session.accessToken,
    owner,
    repo,
    branch: "gh-pages",
    message: "chore: publish hexo public from Open Pages",
    files: publicFiles,
    replace: true,
  });

  const url = await enablePages(session.accessToken, owner, repo);
  return c.json({
    ok: true,
    url,
    owner,
    repo,
    root: pagesRoot(owner, repo),
  });
});

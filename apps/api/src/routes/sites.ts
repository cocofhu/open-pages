import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Hono } from "hono";
import { listPublicFiles } from "@open-pages/hexo-runner";
import {
  DEFAULT_SITE_CONFIG,
  isSafeSiteId,
  isUserEditablePath,
  manifestAddonsFromCatalog,
  openPagesManifestFile,
  openPagesReadmeFile,
  pagesUrl,
  parseCustomDomain,
  parseRepoName,
  parseSiteConfig,
  publishUrlAndRoot,
  withCnameFile,
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
import {
  assessRepoForPublish,
  commitFiles,
  createRepo,
  downloadRepoSnapshot,
  enablePages,
  listRepos,
  readPagesCustomDomain,
} from "../lib/github.js";
import { listAddons } from "../lib/addons.js";
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
  const siteId = c.req.query("siteId") ?? "default";
  if (!isSafeSiteId(siteId)) throw new ClientError("Invalid site id");
  const repos = await listRepos(session.accessToken, siteId);
  return c.json({ repos });
});

siteRoutes.post("/github/repos", async (c) => {
  const session = c.get("session");
  if (!session.accessToken) return c.json({ error: "Not signed in" }, 401);
  const body = (await c.req.json()) as { name: string; private?: boolean };
  const repo = await createRepo(session.accessToken, parseRepoName(body.name), Boolean(body.private));
  return c.json(repo);
});

siteRoutes.get("/github/repos/:owner/:repo/publish-check", async (c) => {
  const session = c.get("session");
  if (!session.accessToken || !session.login) return c.json({ error: "Not signed in" }, 401);
  const owner = c.req.param("owner");
  const repo = parseRepoName(c.req.param("repo"));
  if (owner !== session.login) throw new ClientError("Cannot inspect another owner's repository", 403);
  const siteId = c.req.query("siteId") ?? "default";
  if (!isSafeSiteId(siteId)) throw new ClientError("Invalid site id");
  const branch = c.req.query("branch") || undefined;
  const check = await assessRepoForPublish(session.accessToken, owner, repo, siteId, branch);
  return c.json(check);
});

siteRoutes.get("/github/repos/:owner/:repo/pages-domain", async (c) => {
  const session = c.get("session");
  if (!session.accessToken || !session.login) return c.json({ error: "Not signed in" }, 401);
  const owner = c.req.param("owner");
  const repo = parseRepoName(c.req.param("repo"));
  if (owner !== session.login) throw new ClientError("Cannot inspect another owner's repository", 403);
  const customDomain = await readPagesCustomDomain(session.accessToken, owner, repo);
  return c.json({ customDomain });
});

siteRoutes.get("/github/repos/:owner/:repo/snapshot", async (c) => {
  const session = c.get("session");
  if (!session.accessToken || !session.login) return c.json({ error: "Not signed in" }, 401);
  const owner = c.req.param("owner");
  const repo = parseRepoName(c.req.param("repo"));
  if (owner !== session.login) throw new ClientError("Cannot inspect another owner's repository", 403);
  const snapshot = await downloadRepoSnapshot(session.accessToken, owner, repo);
  return c.json(snapshot);
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
    customDomain?: string | null;
  };
  if (body.owner && body.owner !== session.login) {
    throw new ClientError("Cannot publish to another owner", 403);
  }
  const owner = session.login;
  const repo = parseRepoName(body.repo);
  const siteId = siteIdParam(c);

  if (body.createRepo) {
    await createRepo(session.accessToken, repo, false);
  } else {
    const check = await assessRepoForPublish(session.accessToken, owner, repo, siteId);
    if (!check.eligible) throw new ClientError(check.message, 403);
  }

  const hostname =
    typeof body.customDomain === "string"
      ? (() => {
          const parsed = parseCustomDomain(body.customDomain);
          if (!parsed.ok) throw new ClientError(parsed.error, 400);
          return parsed.hostname || null;
        })()
      : await readPagesCustomDomain(session.accessToken, owner, repo);
  const { url: siteUrl, root: siteRoot } = publishUrlAndRoot(owner, repo, hostname);

  const config = body.config
    ? parseSiteConfig({
        ...parseSiteConfig(body.config),
        url: siteUrl,
        root: siteRoot,
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
  const siteConfig = config ?? DEFAULT_SITE_CONFIG;
  const catalog = await listAddons(ownerKey(session));
  const displayPagesUrl = hostname ? `https://${hostname}/` : pagesUrl(owner, repo);
  sourceFiles.push(
    openPagesManifestFile(siteId, {
      theme: siteConfig.theme,
      addons: manifestAddonsFromCatalog(catalog, siteConfig.theme),
    }),
  );
  sourceFiles.push(
    openPagesReadmeFile({
      title: siteConfig.title,
      description: siteConfig.description,
      pagesUrl: displayPagesUrl,
      theme: siteConfig.theme,
      owner,
      repo,
    }),
  );

  await commitFiles({
    token: session.accessToken,
    owner,
    repo,
    branch: "main",
    message: "chore: update site source from Open Pages",
    files: sourceFiles,
  });

  const publicFiles = withCnameFile(await listPublicFiles(join(dir, "public")), hostname);
  await commitFiles({
    token: session.accessToken,
    owner,
    repo,
    branch: "gh-pages",
    message: "chore: publish hexo public from Open Pages",
    files: publicFiles,
    replace: true,
  });

  const url = await enablePages(session.accessToken, owner, repo, hostname);
  return c.json({
    ok: true,
    url,
    owner,
    repo,
    root: siteRoot,
  });
});

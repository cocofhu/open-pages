import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Hono } from "hono";
import { generateSite, listPublicFiles } from "@open-pages/hexo-runner";
import {
  DEFAULT_SITE_CONFIG,
  isSafeSiteId,
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
import { ensureSite, previewMount, previewSite, resetSite, syncSite } from "../lib/workspace.js";
import { commitFiles, createRepo, enablePages, listRepos } from "../lib/github.js";

export const siteRoutes = new Hono<{ Variables: { session: SessionData } }>();

function siteIdParam(c: { req: { param: (name: string) => string } }): string {
  const siteId = c.req.param("siteId");
  if (!isSafeSiteId(siteId)) throw new ClientError("Invalid site id");
  return siteId;
}

function optionalConfig(raw: unknown): SiteConfig | undefined {
  if (raw == null) return undefined;
  return parseSiteConfig(raw);
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
  const body = (await c.req.json()) as { files: SiteFile[]; config?: unknown };
  const siteId = siteIdParam(c);
  const result = await previewSite(ownerKey(session), siteId, body.files ?? [], optionalConfig(body.config));
  return c.json({
    ok: true,
    elapsedMs: result.elapsedMs,
    url: previewMount(siteId),
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

  const dir = await syncSite(ownerKey(session), siteIdParam(c), body.files ?? [], config);
  const sourceFiles = (body.files ?? []).filter((file) => !file.path.startsWith("public/"));
  try {
    sourceFiles.push({
      path: "_config.yml",
      content: await readFile(join(dir, "_config.yml"), "utf8"),
    });
  } catch {
    // keep client copy
  }

  await commitFiles({
    token: session.accessToken,
    owner,
    repo,
    branch: "main",
    message: "chore: update site source from Open Pages",
    files: sourceFiles,
  });

  await generateSite(dir);
  const publicFiles = await listPublicFiles(join(dir, "public"));
  await commitFiles({
    token: session.accessToken,
    owner,
    repo,
    branch: "gh-pages",
    message: "chore: publish hexo public from Open Pages",
    files: publicFiles,
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

import type { GithubBinding } from "@open-pages/shared";

/** Publish/preview always targets the site binding; never createRepo or override. */
export function resolvePublishTarget(
  binding: GithubBinding | undefined,
): { owner: string; repo: string } | null {
  if (!binding?.owner?.trim() || !binding?.repo?.trim()) return null;
  return { owner: binding.owner.trim(), repo: binding.repo.trim() };
}

/** After a successful publish, keep the bound owner/repo; only refresh pagesUrl. */
export function bindingAfterPublish(
  existing: GithubBinding | undefined,
  result: { owner: string; repo: string; url: string },
): GithubBinding {
  if (existing?.owner && existing?.repo) {
    return {
      ...existing,
      pagesUrl: result.url,
    };
  }
  return {
    owner: result.owner,
    repo: result.repo,
    defaultBranch: "main",
    pagesUrl: result.url,
    ...(typeof existing?.customDomain === "string" ? { customDomain: existing.customDomain } : {}),
  };
}

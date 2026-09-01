import { env } from "../env.js";

export { commitFiles, createRepo, enablePages, listRepos, octokit, assessRepoForPublish, getRepoTextFile, listRepoRootEntries } from "@open-pages/github";

export function authorizeUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: env.githubClientId,
    redirect_uri: `${env.appOrigin}/auth/github/callback`,
    scope: "repo read:user",
    state,
  });
  return `https://github.com/login/oauth/authorize?${params.toString()}`;
}

export async function exchangeCode(code: string): Promise<string> {
  const response = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: env.githubClientId,
      client_secret: env.githubClientSecret,
      code,
      redirect_uri: `${env.appOrigin}/auth/github/callback`,
    }),
  });
  const data = (await response.json()) as { access_token?: string; error?: string };
  if (!data.access_token) {
    throw new Error(data.error ?? "GitHub OAuth exchange failed");
  }
  return data.access_token;
}

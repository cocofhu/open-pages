import { createHash, randomBytes } from "node:crypto";

export const GITHUB_OAUTH_AUTHORIZE = "https://github.com/login/oauth/authorize";
export const GITHUB_OAUTH_TOKEN = "https://github.com/login/oauth/access_token";
export const GITHUB_OAUTH_SCOPE = "repo read:user";

export interface PkcePair {
  verifier: string;
  challenge: string;
}

export interface AuthorizeUrlOptions {
  clientId: string;
  redirectUri: string;
  state: string;
  challenge: string;
  scope?: string;
}

export interface TokenResponse {
  accessToken: string;
  tokenType: string;
  scope: string;
}

export interface GitHubUser {
  id: number;
  login: string;
  name: string;
  avatarUrl: string;
}

export function base64Url(buffer: Buffer | Uint8Array): string {
  return Buffer.from(buffer)
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/g, "");
}

export function createPkcePair(): PkcePair {
  const verifier = base64Url(randomBytes(32));
  const challenge = base64Url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

export function buildAuthorizeUrl(options: AuthorizeUrlOptions): string {
  const params = new URLSearchParams({
    client_id: options.clientId,
    redirect_uri: options.redirectUri,
    scope: options.scope ?? GITHUB_OAUTH_SCOPE,
    state: options.state,
    code_challenge: options.challenge,
    code_challenge_method: "S256",
  });
  return `${GITHUB_OAUTH_AUTHORIZE}?${params.toString()}`;
}

export async function exchangeCode(options: {
  clientId: string;
  code: string;
  verifier: string;
  redirectUri: string;
  fetchImpl?: typeof fetch;
}): Promise<TokenResponse> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(GITHUB_OAUTH_TOKEN, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: options.clientId,
      code: options.code,
      redirect_uri: options.redirectUri,
      code_verifier: options.verifier,
      grant_type: "authorization_code",
    }),
  });
  const data = (await response.json()) as {
    access_token?: string;
    token_type?: string;
    scope?: string;
    error?: string;
    error_description?: string;
  };
  if (!data.access_token) {
    throw new Error(data.error_description ?? data.error ?? "GitHub OAuth exchange failed");
  }
  return {
    accessToken: data.access_token,
    tokenType: data.token_type ?? "bearer",
    scope: data.scope ?? "",
  };
}

export async function fetchGitHubUser(
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<GitHubUser> {
  const response = await fetchImpl("https://api.github.com/user", {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "User-Agent": "open-pages",
    },
  });
  if (!response.ok) {
    throw new Error(`GitHub user lookup failed (${response.status})`);
  }
  const data = (await response.json()) as {
    id: number;
    login: string;
    name?: string | null;
    avatar_url: string;
  };
  return {
    id: data.id,
    login: data.login,
    name: data.name ?? data.login,
    avatarUrl: data.avatar_url,
  };
}

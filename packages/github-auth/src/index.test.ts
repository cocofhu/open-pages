import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import {
  base64Url,
  buildAuthorizeUrl,
  createPkcePair,
  exchangeCode,
  fetchGitHubUser,
  GITHUB_OAUTH_AUTHORIZE,
  GITHUB_OAUTH_SCOPE,
} from "./index.ts";

test("createPkcePair uses S256 and a 43-char verifier", () => {
  const pair = createPkcePair();
  assert.equal(pair.verifier.length, 43);
  assert.match(pair.verifier, /^[A-Za-z0-9_-]+$/);
  assert.equal(pair.challenge, base64Url(createHash("sha256").update(pair.verifier).digest()));
  assert.notEqual(createPkcePair().verifier, pair.verifier);
});

test("buildAuthorizeUrl includes PKCE query params", () => {
  const url = new URL(
    buildAuthorizeUrl({
      clientId: "abc",
      redirectUri: "http://127.0.0.1:3847/auth/callback",
      state: "st",
      challenge: "ch",
    }),
  );
  assert.equal(`${url.origin}${url.pathname}`, GITHUB_OAUTH_AUTHORIZE);
  assert.equal(url.searchParams.get("client_id"), "abc");
  assert.equal(url.searchParams.get("redirect_uri"), "http://127.0.0.1:3847/auth/callback");
  assert.equal(url.searchParams.get("state"), "st");
  assert.equal(url.searchParams.get("code_challenge"), "ch");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("scope"), GITHUB_OAUTH_SCOPE);
});

test("exchangeCode posts client_id and verifier without a secret", async () => {
  const fetchImpl: typeof fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, string>;
    assert.equal(body.client_id, "abc");
    assert.equal(body.code, "code-1");
    assert.equal(body.code_verifier, "ver");
    assert.equal(body.redirect_uri, "http://127.0.0.1:3847/auth/callback");
    assert.equal(body.grant_type, "authorization_code");
    assert.equal(body.client_secret, undefined);
    return new Response(JSON.stringify({ access_token: "tok", token_type: "bearer", scope: "repo" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  const token = await exchangeCode({
    clientId: "abc",
    code: "code-1",
    verifier: "ver",
    redirectUri: "http://127.0.0.1:3847/auth/callback",
    fetchImpl,
  });
  assert.equal(token.accessToken, "tok");
  assert.equal(token.scope, "repo");
});

test("exchangeCode surfaces GitHub error text", async () => {
  await assert.rejects(
    () =>
      exchangeCode({
        clientId: "abc",
        code: "bad",
        verifier: "ver",
        redirectUri: "http://127.0.0.1:3847/auth/callback",
        fetchImpl: async () =>
          new Response(JSON.stringify({ error: "invalid_grant", error_description: "bad code" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          }),
      }),
    /bad code/,
  );
});

test("fetchGitHubUser maps the authenticated profile", async () => {
  const user = await fetchGitHubUser("tok", async (input, init) => {
    assert.equal(String(input), "https://api.github.com/user");
    assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer tok");
    return new Response(
      JSON.stringify({ id: 7, login: "octocat", name: null, avatar_url: "https://example.com/a.png" }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  });
  assert.deepEqual(user, {
    id: 7,
    login: "octocat",
    name: "octocat",
    avatarUrl: "https://example.com/a.png",
  });
});

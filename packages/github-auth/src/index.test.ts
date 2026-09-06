import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import {
  base64Url,
  buildAuthorizeUrl,
  createPkcePair,
  exchangeCode,
  fetchGitHubUser,
  GITHUB_DEVICE_CODE,
  GITHUB_DEVICE_GRANT,
  GITHUB_OAUTH_AUTHORIZE,
  GITHUB_OAUTH_SCOPE,
  GITHUB_OAUTH_TOKEN,
  OFFICIAL_GITHUB_CLIENT_ID,
  pollDeviceToken,
  requestDeviceCode,
  resolveGithubClientId,
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

test("resolveGithubClientId prefers env then the official default", () => {
  assert.equal(resolveGithubClientId({}), OFFICIAL_GITHUB_CLIENT_ID);
  assert.equal(resolveGithubClientId({ GITHUB_CLIENT_ID: "  from-github  " }), "from-github");
  assert.equal(
    resolveGithubClientId({ OPEN_PAGES_GITHUB_CLIENT_ID: "from-open-pages" }),
    "from-open-pages",
  );
  assert.equal(
    resolveGithubClientId({
      GITHUB_CLIENT_ID: "from-github",
      OPEN_PAGES_GITHUB_CLIENT_ID: "from-open-pages",
    }),
    "from-github",
  );
});

test("requestDeviceCode posts a form body without a secret", async () => {
  const device = await requestDeviceCode("abc", {
    fetchImpl: async (input, init) => {
      assert.equal(String(input), GITHUB_DEVICE_CODE);
      assert.equal((init?.headers as Record<string, string>)["Content-Type"], "application/x-www-form-urlencoded");
      const body = new URLSearchParams(String(init?.body));
      assert.equal(body.get("client_id"), "abc");
      assert.equal(body.get("scope"), GITHUB_OAUTH_SCOPE);
      assert.equal(body.get("client_secret"), null);
      return new Response(
        JSON.stringify({
          device_code: "dev-1",
          user_code: "ABCD-EFGH",
          verification_uri: "https://github.com/login/device",
          verification_uri_complete: "https://github.com/login/device?user_code=ABCD-EFGH",
          expires_in: 900,
          interval: 5,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    },
  });
  assert.equal(device.deviceCode, "dev-1");
  assert.equal(device.userCode, "ABCD-EFGH");
  assert.equal(device.verificationUriComplete, "https://github.com/login/device?user_code=ABCD-EFGH");
  assert.equal(device.interval, 5);
});

test("pollDeviceToken maps pending, slow_down, token, and errors", async () => {
  const pending = await pollDeviceToken("abc", "dev-1", {
    fetchImpl: async (input, init) => {
      assert.equal(String(input), GITHUB_OAUTH_TOKEN);
      const body = new URLSearchParams(String(init?.body));
      assert.equal(body.get("grant_type"), GITHUB_DEVICE_GRANT);
      assert.equal(body.get("device_code"), "dev-1");
      return new Response(JSON.stringify({ error: "authorization_pending" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  });
  assert.deepEqual(pending, { status: "pending" });

  const slow = await pollDeviceToken("abc", "dev-1", {
    fetchImpl: async () =>
      new Response(JSON.stringify({ error: "slow_down" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
  });
  assert.deepEqual(slow, { status: "slow_down" });

  const token = await pollDeviceToken("abc", "dev-1", {
    fetchImpl: async () =>
      new Response(JSON.stringify({ access_token: "tok", token_type: "bearer", scope: "repo" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
  });
  assert.deepEqual(token, { status: "token", accessToken: "tok", tokenType: "bearer", scope: "repo" });

  const denied = await pollDeviceToken("abc", "dev-1", {
    fetchImpl: async () =>
      new Response(JSON.stringify({ error: "access_denied", error_description: "user said no" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
  });
  assert.deepEqual(denied, { status: "error", code: "access_denied", message: "user said no" });
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

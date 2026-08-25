import assert from "node:assert/strict";
import test from "node:test";
import { MetaOAuthService, metaOAuthScopes } from "../src/services/metaOAuth.js";

const options = {
  appId: "app-id",
  appSecret: "app-secret",
  graphVersion: "v25.0",
  redirectUri: "https://example.test/api/meta/oauth/callback",
  now: () => 1_000_000,
};

test("OAuth Facebook tạo state ký, đúng redirect và đủ quyền Page", () => {
  const oauth = new MetaOAuthService(options);
  const flow = oauth.begin();
  const url = new URL(flow.authorizationUrl);
  assert.equal(url.hostname, "www.facebook.com");
  assert.equal(url.searchParams.get("client_id"), "app-id");
  assert.equal(url.searchParams.get("redirect_uri"), options.redirectUri);
  assert.deepEqual(url.searchParams.get("scope")?.split(","), [...metaOAuthScopes]);
  oauth.verifyState(flow.state, flow.nonce);
  assert.throws(() => oauth.verifyState(`${flow.state}x`, flow.nonce), /state_invalid/u);
  assert.throws(() => oauth.verifyState(flow.state, "nonce-khac-khong-hop-le"), /state_invalid/u);
});

test("OAuth Facebook từ chối state quá hạn", () => {
  let now = 1_000_000;
  const oauth = new MetaOAuthService({ ...options, now: () => now });
  const flow = oauth.begin();
  now += 10 * 60 * 1000 + 1;
  assert.throws(() => oauth.verifyState(flow.state, flow.nonce), /state_invalid/u);
});

test("OAuth đổi code lấy User token tạm rồi đọc Page token", async () => {
  const calls: Array<{ url: URL; authorization?: string }> = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const headers = init?.headers as Record<string, string> | undefined;
    calls.push({ url, ...(headers?.authorization ? { authorization: headers.authorization } : {}) });
    if (url.pathname.endsWith("/oauth/access_token")) {
      return new Response(
        JSON.stringify({
          access_token: url.searchParams.get("grant_type") ? "long-user-token" : "short-user-token",
        }),
        { status: 200 },
      );
    }
    return new Response(
      JSON.stringify({
        data: [
          {
            id: "page-1",
            name: "Page Một",
            access_token: "page-token",
            tasks: ["MESSAGING", "MODERATE"],
          },
        ],
      }),
      { status: 200 },
    );
  };
  const oauth = new MetaOAuthService({ ...options, fetcher });
  const pages = await oauth.authorizedPages("authorization-code");

  assert.deepEqual(pages, [
    {
      id: "page-1",
      name: "Page Một",
      accessToken: "page-token",
      tasks: ["MESSAGING", "MODERATE"],
    },
  ]);
  assert.equal(calls.length, 3);
  assert.equal(calls[0]!.url.searchParams.get("code"), "authorization-code");
  assert.equal(calls[1]!.url.searchParams.get("fb_exchange_token"), "short-user-token");
  assert.equal(calls[2]!.authorization, "Bearer long-user-token");
});

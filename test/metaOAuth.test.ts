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

test("Facebook OAuth dùng state ký và đủ quyền Page đang triển khai", () => {
  const oauth = new MetaOAuthService(options);
  const flow = oauth.begin();
  const url = new URL(flow.authorizationUrl);
  assert.equal(url.searchParams.get("redirect_uri"), options.redirectUri);
  assert.deepEqual(url.searchParams.get("scope")?.split(","), [...metaOAuthScopes]);
  oauth.verifyState(flow.state, flow.nonce);
  assert.throws(() => oauth.verifyState(`${flow.state}x`, flow.nonce), /state_invalid/u);
});

test("Facebook OAuth đổi code và đọc Page token", async () => {
  const calls: URL[] = [];
  const oauth = new MetaOAuthService({
    ...options,
    fetcher: async (input) => {
      const url = new URL(String(input));
      calls.push(url);
      if (url.pathname.endsWith("/oauth/access_token")) {
        return Response.json({ access_token: url.searchParams.has("grant_type") ? "long" : "short" });
      }
      return Response.json({
        data: [{ id: "p1", name: "Page 1", access_token: "pt", tasks: ["MESSAGING"] }],
      });
    },
  });
  assert.deepEqual(await oauth.authorizedPages("code"), [
    { id: "p1", name: "Page 1", accessToken: "pt", tasks: ["MESSAGING"] },
  ]);
  assert.equal(calls.length, 3);
});

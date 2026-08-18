import assert from "node:assert/strict";
import test from "node:test";
import { createHmac } from "node:crypto";
import { verifyMetaChallenge, verifyMetaSignature } from "../src/adapters/metaWebhook.js";

test("xác thực webhook challenge", () => {
  assert.equal(
    verifyMetaChallenge({ mode: "subscribe", token: "token", challenge: "123", expectedToken: "token" }),
    "123",
  );
  assert.equal(
    verifyMetaChallenge({ mode: "subscribe", token: "sai", challenge: "123", expectedToken: "token" }),
    undefined,
  );
});

test("xác thực signature raw body", () => {
  const body = Buffer.from('{"object":"page"}');
  const secret = "app-secret";
  const signature = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
  assert.equal(verifyMetaSignature(body, signature, secret), true);
  assert.equal(verifyMetaSignature(body, "sha256=bad", secret), false);
});

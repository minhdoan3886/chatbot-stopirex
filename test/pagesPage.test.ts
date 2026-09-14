import assert from "node:assert/strict";
import test from "node:test";
import { pagesPage } from "../src/http/pagesPage.js";

test("trang Fanpage có reviewer flow tiếng Anh, Facebook OAuth và công tắc bot từng Page", () => {
  const script = pagesPage.match(/<script>([\s\S]*?)<\/script>/u)?.[1];
  assert.ok(script);
  assert.doesNotThrow(() => new Function(script));
  assert.match(pagesPage, /Facebook Page administration/u);
  assert.match(pagesPage, /Meta reviewer flow/u);
  assert.match(pagesPage, /Connect with Facebook/u);
  assert.match(pagesPage, /\/api\/meta\/oauth\/start/u);
  assert.match(pagesPage, /\/api\/meta\/pages\//u);
  assert.match(pagesPage, /Webhook: messages \+ feed/u);
  assert.match(pagesPage, /Credential encrypted/u);
  assert.match(pagesPage, /Comment operations/u);
  for (const permission of [
    "pages_show_list",
    "pages_manage_metadata",
    "pages_messaging",
    "pages_read_user_content",
    "pages_read_engagement",
    "pages_manage_engagement",
  ]) {
    assert.match(pagesPage, new RegExp(permission, "u"));
  }
  assert.doesNotMatch(pagesPage, /EAA[A-Za-z0-9]/u);
});

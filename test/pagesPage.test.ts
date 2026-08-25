import assert from "node:assert/strict";
import test from "node:test";
import { pagesPage } from "../src/http/pagesPage.js";

test("trang Fanpage dùng Facebook OAuth và công tắc bot riêng từng Page", () => {
  assert.match(pagesPage, /Quản trị Fanpage/u);
  assert.match(pagesPage, /Đăng nhập bằng Facebook/u);
  assert.match(pagesPage, /\/api\/meta\/oauth\/start/u);
  assert.match(pagesPage, /data-id/u);
  assert.match(pagesPage, /\/api\/meta\/pages\/.*\/bot/u);
  assert.match(pagesPage, /Page mới mặc định tắt bot/u);
  assert.doesNotMatch(pagesPage, /Dán Page Access Token/u);
});

test("trang Fanpage không nhúng credential thật vào HTML", () => {
  assert.doesNotMatch(pagesPage, /EAA[A-Za-z0-9]/u);
  assert.doesNotMatch(pagesPage, /META_TEST_PAGE_ACCESS_TOKEN/u);
});

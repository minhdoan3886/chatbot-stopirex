import assert from "node:assert/strict";
import test from "node:test";
import { pagesPage } from "../src/http/pagesPage.js";

test("trang Fanpage có Facebook OAuth và công tắc bot từng Page", () => {
  assert.match(pagesPage, /Quản trị Fanpage/u);
  assert.match(pagesPage, /\/api\/meta\/oauth\/start/u);
  assert.match(pagesPage, /\/api\/meta\/pages\//u);
  assert.doesNotMatch(pagesPage, /EAA[A-Za-z0-9]/u);
});

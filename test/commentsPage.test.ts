import assert from "node:assert/strict";
import test from "node:test";
import { commentsPage } from "../src/http/commentsPage.js";

test("tab Bình luận theo dõi đủ public reply và private reply duy nhất", () => {
  assert.match(commentsPage, /Theo dõi bình luận/u);
  assert.match(commentsPage, /trả lời công khai trước/iu);
  assert.match(commentsPage, /một tin nhắn riêng/iu);
  assert.match(commentsPage, /\/api\/meta\/comments/u);
  assert.match(commentsPage, /Khiếu nại/u);
  assert.match(commentsPage, /Tin nhắn riêng duy nhất/u);
});

test("tab Bình luận không nhúng token hoặc thông tin nội bộ", () => {
  assert.doesNotMatch(commentsPage, /EAA[A-Za-z0-9]/u);
  assert.doesNotMatch(commentsPage, /META_.*TOKEN/u);
  assert.doesNotMatch(commentsPage, /broadcast|webhook tạm dừng/iu);
});

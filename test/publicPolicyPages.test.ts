import test from "node:test";
import assert from "node:assert/strict";
import {
  appReviewPage,
  dataDeletionPage,
  privacyPolicyPage,
  termsOfServicePage,
} from "../src/http/publicPolicyPages.js";

test("public policy pages expose the Meta review essentials", () => {
  assert.match(privacyPolicyPage, /Chính sách quyền riêng tư/u);
  assert.match(privacyPolicyPage, /Thông tin được xử lý/u);
  assert.match(privacyPolicyPage, /Quyền của khách hàng/u);
  assert.match(termsOfServicePage, /Điều khoản sử dụng/u);
  assert.match(dataDeletionPage, /Yêu cầu xóa dữ liệu/u);
  assert.match(dataDeletionPage, /không quá 30 ngày/u);
});

test("app review page maps every requested permission to visible reviewer evidence", () => {
  for (const permission of [
    "pages_show_list",
    "pages_manage_metadata",
    "pages_messaging",
    "pages_read_user_content",
    "pages_read_engagement",
    "pages_manage_engagement",
  ]) {
    assert.match(appReviewPage, new RegExp(permission, "u"));
  }
  assert.match(appReviewPage, /Complete reviewer path/u);
  assert.match(appReviewPage, /entire Facebook Login flow/u);
  assert.match(appReviewPage, /public reply/u);
  assert.match(appReviewPage, /private follow-up/u);
  assert.match(appReviewPage, /Hide comment/u);
  assert.match(appReviewPage, /<html lang="en">/u);
  assert.doesNotMatch(appReviewPage, /EAA[A-Za-z0-9]|password\s*[:=]/u);
});

test("public policy pages contain no test-only wording", () => {
  for (const page of [privacyPolicyPage, termsOfServicePage, dataDeletionPage]) {
    assert.doesNotMatch(page, /localhost|sandbox|demo|đơn thử/iu);
    assert.match(page, /Facebook Page Stopirex/u);
  }
});

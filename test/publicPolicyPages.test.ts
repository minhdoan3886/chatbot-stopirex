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
  assert.match(appReviewPage, /Stopirex Facebook Customer Care/u);
  assert.match(appReviewPage, /Yến Nhi thích skincare/u);
});

test("public policy pages contain no test-only wording", () => {
  for (const page of [privacyPolicyPage, termsOfServicePage, dataDeletionPage, appReviewPage]) {
    assert.doesNotMatch(page, /localhost|sandbox|demo|đơn thử/iu);
  }
  assert.match(privacyPolicyPage, /Facebook Page Stopirex/u);
  assert.match(termsOfServicePage, /Facebook Page Stopirex/u);
  assert.match(dataDeletionPage, /Facebook Page Stopirex/u);
});

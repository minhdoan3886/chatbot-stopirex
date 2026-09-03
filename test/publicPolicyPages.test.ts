import test from "node:test";
import assert from "node:assert/strict";
import { dataDeletionPage, privacyPolicyPage, termsOfServicePage } from "../src/http/publicPolicyPages.js";

test("public policy pages expose the Meta review essentials", () => {
  assert.match(privacyPolicyPage, /Chính sách quyền riêng tư/u);
  assert.match(privacyPolicyPage, /Thông tin được xử lý/u);
  assert.match(privacyPolicyPage, /Quyền của khách hàng/u);
  assert.match(termsOfServicePage, /Điều khoản sử dụng/u);
  assert.match(dataDeletionPage, /Yêu cầu xóa dữ liệu/u);
  assert.match(dataDeletionPage, /không quá 30 ngày/u);
});

test("public policy pages contain no test-only wording", () => {
  for (const page of [privacyPolicyPage, termsOfServicePage, dataDeletionPage]) {
    assert.doesNotMatch(page, /localhost|sandbox|demo|đơn thử/iu);
    assert.match(page, /Facebook Page Stopirex/u);
  }
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  buildOrderTrackingNotification,
  metaRecipientIdFromOrderSession,
  normalizeTrackingNumber,
} from "../src/services/orderTrackingNotification.js";

test("tạo thông báo từ mã vận đơn thật và không chứa nội dung thử nghiệm", () => {
  const result = buildOrderTrackingNotification({
    carrier: "viettel_post",
    trackingNumber: "VTP123456789",
  });
  assert.match(result.text, /Viettel Post/u);
  assert.match(result.text, /Mã vận đơn: VTP123456789/u);
  assert.match(result.text, /Cảm ơn mình đã tin tưởng Stopirex/u);
  assert.match(result.text, /kiện có dấu hiệu bất thường/u);
  assert.match(result.text, /website hoặc ứng dụng Viettel Post.*nhập mã/isu);
  assert.doesNotMatch(result.text, /https?:\/\/|Link tra cứu/iu);
  assert.equal(result.trackingUrl, undefined);
  assert.doesNotMatch(result.text, /DEMO|localhost|đơn thử|hàng chính hãng/iu);
});

test("chỉ chấp nhận mã vận đơn có định dạng an toàn", () => {
  assert.equal(normalizeTrackingNumber("  SPX VN 123456  "), "SPXVN123456");
  assert.equal(normalizeTrackingNumber("abc"), undefined);
  assert.equal(normalizeTrackingNumber("<script>alert(1)</script>"), undefined);
});

test("lấy đúng PSID Meta từ session của đơn", () => {
  assert.equal(metaRecipientIdFromOrderSession("108631178590851:123456789012345"), "123456789012345");
  assert.equal(metaRecipientIdFromOrderSession("session-khong-hop-le"), undefined);
});

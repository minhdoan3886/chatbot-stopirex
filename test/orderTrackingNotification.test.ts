import assert from "node:assert/strict";
import test from "node:test";
import {
  buildOrderTrackingNotification,
  metaPageIdFromOrderSession,
  metaRecipientIdFromOrderSession,
  normalizeTrackingNumber,
} from "../src/services/orderTrackingNotification.js";

test("tạo thông báo từ mã vận đơn thật và không chứa nội dung thử nghiệm", () => {
  const result = buildOrderTrackingNotification({ carrier: "spx", trackingNumber: "SPXVN123456" });
  assert.match(result.text, /Mã vận đơn: SPXVN123456/u);
  assert.match(result.text, /Cảm ơn mình đã tin tưởng Stopirex/u);
  assert.match(result.text, /kiện có dấu hiệu bất thường/u);
  assert.match(result.text, /https:\/\/spx\.vn\/track\?SPXVN123456/u);
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

test("lấy đúng Page nội bộ từ session của đơn", () => {
  assert.equal(
    metaPageIdFromOrderSession("00000000-0000-0000-0000-000000000011:123456789012345"),
    "00000000-0000-0000-0000-000000000011",
  );
  assert.equal(metaPageIdFromOrderSession("page-1:123456"), undefined);
});

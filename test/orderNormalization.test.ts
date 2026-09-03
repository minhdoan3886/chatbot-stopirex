import assert from "node:assert/strict";
import test from "node:test";
import {
  formatVietnameseAddress,
  normalizeDeliveryNotes,
  normalizeVietnameseAddress,
  normalizeVietnamesePhone,
  resolveDeliveryContext,
} from "../src/domain/orderNormalization.js";

test("phone normalizer chuyển số chữ teencode thành SĐT Việt Nam", () => {
  const result = normalizeVietnamesePhone("sdt ko 9 tam bay 6 nam 4 ba 2 mot. giao trong gio hchjnh nha");
  assert.equal(result.valid, true);
  assert.equal(result.normalized, "0987654321");
  assert.equal(result.raw, "ko 9 tam bay 6 nam 4 ba 2 mot");
});

test("phone normalizer không biến chữ không thông thường thành SĐT", () => {
  const result = normalizeVietnamesePhone("không nhận hàng thứ 7 nhé");
  assert.equal(result.valid, false);
  assert.equal(result.reason, "missing_phone_marker");
});

test("q1 sg chỉ tạo delivery context mức mentioned", () => {
  const result = resolveDeliveryContext("ship dc q1 sg khum shop?");
  assert.equal(result.valid, true);
  assert.equal(result.normalized?.district, "Quận 1");
  assert.equal(result.normalized?.city, "TP. Hồ Chí Minh");
  assert.equal(result.normalized?.status, "mentioned");
  assert.equal(result.normalized?.street, undefined);
});

test("địa chỉ mới merge incremental với context và giữ raw parts", () => {
  const context = resolveDeliveryContext("q1 sg").normalized;
  assert.ok(context);
  const result = normalizeVietnameseAddress(
    "dc m la 12/4 nguyen thj minh khai, f dakao. sdt ko 9 tam bay 6 nam 4 ba 2 mot",
    context,
  );
  assert.equal(result.valid, true);
  assert.equal(
    formatVietnameseAddress(result.normalized!),
    "12/4 Nguyễn Thị Minh Khai, Phường Đa Kao, Quận 1, TP. Hồ Chí Minh",
  );
  assert.deepEqual(result.normalized?.rawParts, [
    "q1 sg",
    "dc m la 12/4 nguyen thj minh khai, f dakao. sdt ko 9 tam bay 6 nam 4 ba 2 mot",
  ]);
});

test("delivery note normalizer giữ đồng thời giờ và ngày nhận", () => {
  const result = normalizeDeliveryNotes(
    "giao trong gio hchjnh nha. dc do chi nhan dc t2 den t6 thui, thu 7 m ngi lam",
  );
  assert.deepEqual(result.normalized, [
    "Giao trong giờ hành chính",
    "Chỉ nhận hàng từ Thứ 2 đến Thứ 6",
    "Không nhận hàng Thứ 7",
  ]);
});

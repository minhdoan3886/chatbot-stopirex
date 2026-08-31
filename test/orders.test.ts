import assert from "node:assert/strict";
import test from "node:test";
import {
  assertOrderReady,
  formatOrderConfirmation,
  missingLegacyAddressComponents,
  OrderNotReadyError,
} from "../src/domain/orders.js";

const draft = {
  recipientName: "Nguyễn Văn A",
  phone: "0901234567",
  legacyAddress: "Số 1 Nguyễn Trãi, phường Thượng Đình, quận Thanh Xuân, Hà Nội",
  sku: "STOPIREX-30ML",
  quantity: 1,
  totalVnd: 315_000,
  paymentMethod: "cod" as const,
};

test("không tạo đơn trước khi khách xác nhận ĐỒNG Ý", () => {
  assert.throws(() => assertOrderReady(draft), OrderNotReadyError);
});

test("đơn đủ dữ liệu và đã xác nhận thì sẵn sàng", () => {
  assert.doesNotThrow(() => assertOrderReady({ ...draft, customerConfirmedAt: new Date() }));
});

test("tóm tắt đơn có đủ trường và CTA xác nhận", () => {
  const message = formatOrderConfirmation(draft);
  assert.match(message, /0901234567/);
  assert.match(message, /315\.000đ/);
  assert.match(message, /phản hồi “ĐỒNG Ý”/);
  assert.doesNotMatch(message, /Quà tặng:/u);
});

test("đơn từ 2 lọ có đúng một túi quà tính theo đơn hàng", () => {
  const message = formatOrderConfirmation({ ...draft, quantity: 5, totalVnd: 1_250_000 });
  assert.match(message, /Quà tặng: 1 túi đa năng vải dệt Stopirex \(1 túi\/đơn\)/u);
  assert.equal((message.match(/túi đa năng/gu) ?? []).length, 1);
});

test("địa chỉ có chi tiết và tỉnh thành không bắt khách viết như tờ khai hành chính", () => {
  assert.deepEqual(missingLegacyAddressComponents("Số 82 Nguyễn Tuân, Hà Nội"), []);
  assert.deepEqual(
    missingLegacyAddressComponents(
      "Số 82 Nguyễn Tuân, phường Thanh Xuân Trung, quận Thanh Xuân, Hà Nội",
    ),
    [],
  );
});

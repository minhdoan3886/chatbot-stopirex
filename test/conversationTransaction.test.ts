import assert from "node:assert/strict";
import test from "node:test";
import {
  reduceOrderTransaction,
  type OrderMutationAction,
} from "../src/domain/conversationTransaction.js";

const options = {
  sku: "STOPIREX",
  paymentMethod: "cod" as const,
  totalForQuantity: (quantity: 1 | 2 | 3 | 4 | 5) =>
    ({ 1: 315_000, 2: 510_000, 3: 750_000, 4: 1_000_000, 5: 1_250_000 })[quantity],
};

test("quantity action được commit nguyên tử cùng sku, total và payment", () => {
  const transaction = reduceOrderTransaction(
    { order: { phone: "0988111222" } },
    [{ type: "set_quantity", quantity: 2, evidence: "lấy 2 lọ" }],
    options,
  );
  assert.equal(transaction.after.selectedQuantity, 2);
  assert.deepEqual(transaction.after.order, {
    phone: "0988111222",
    sku: "STOPIREX",
    quantity: 2,
    totalVnd: 510_000,
    paymentMethod: "cod",
  });
  assert.ok(transaction.changedFields.includes("selectedQuantity"));
});

test("nhiều entity trong một lượt được commit đầy đủ, không dừng sau SĐT", () => {
  const actions: OrderMutationAction[] = [
    { type: "set_quantity", quantity: 1, evidence: "1 lọ" },
    { type: "set_phone", phone: "0988111222", evidence: "SĐT" },
    { type: "set_recipient_name", recipientName: "Lan", evidence: "tên Lan" },
    {
      type: "set_address",
      address: "số 10 Duy Tân, Quận Cầu Giấy, Hà Nội",
      operation: "replace",
      evidence: "giao về",
    },
    {
      type: "set_address",
      address: "Phường Dịch Vọng Hậu",
      operation: "append",
      evidence: "phường",
    },
  ];
  const transaction = reduceOrderTransaction({ order: {} }, actions, options);
  assert.equal(transaction.after.order.recipientName, "Lan");
  assert.equal(transaction.after.order.phone, "0988111222");
  assert.match(transaction.after.order.legacyAddress ?? "", /Duy Tân.*Dịch Vọng Hậu/iu);
});

test("xung đột quantity dùng last-write-wins nhưng phải phát trace", () => {
  const transaction = reduceOrderTransaction(
    { order: {} },
    [
      { type: "set_quantity", quantity: 1, evidence: "lấy 1" },
      { type: "set_quantity", quantity: 3, evidence: "đổi thành 3" },
    ],
    options,
  );
  assert.equal(transaction.after.selectedQuantity, 3);
  assert.deepEqual(transaction.conflicts, ["multiple_quantity_values_last_write_wins"]);
});

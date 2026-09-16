import assert from "node:assert/strict";
import test from "node:test";
import type { PriceQuote } from "../src/domain/products.js";
import {
  assertRenderedTransactionText,
  renderPriceQuote,
  TransactionRenderError,
} from "../src/domain/transactionRenderer.js";

function quote(quantity = 1): PriceQuote {
  const productPrice = quantity === 1 ? 285_000 : 510_000;
  const shippingFee = quantity === 1 ? 30_000 : 0;
  return {
    sourceId: `facebook-stopirex-${quantity}`,
    sku: "STOPIREX",
    quantity,
    productPrice: { amount: productPrice, currency: "VND" },
    shippingFee: { amount: shippingFee, currency: "VND" },
    total: { amount: productPrice + shippingFee, currency: "VND" },
    offerVersion: "facebook-2026-08",
  };
}

test("renderer gắn đúng vai trò tiền và nguồn cho quote", () => {
  const rendered = renderPriceQuote(quote());
  assert.equal(rendered.money("unit_price"), "285.000đ");
  assert.equal(rendered.money("shipping"), "30.000đ");
  assert.equal(rendered.money("total"), "315.000đ");
  assert.equal(rendered.slots.find((slot) => slot.role === "shipping")?.sourceRef, "facebook-stopirex-1");
});

test("renderer chặn quote có tổng bị đảo hoặc tính sai", () => {
  const invalid = quote();
  invalid.total.amount = invalid.shippingFee.amount;
  assert.throws(
    () => renderPriceQuote(invalid),
    (error: unknown) =>
      error instanceof TransactionRenderError && error.code === "transaction_total_mismatch",
  );
});

test("miễn phí giao cần receipt có version và được phản ánh vào tổng", () => {
  assert.throws(
    () =>
      renderPriceQuote(quote(), {
        shippingAdjustment: { shippingFeeVnd: 0, receiptId: "", sourceVersion: "policy-v1" },
      }),
    (error: unknown) =>
      error instanceof TransactionRenderError && error.code === "transaction_missing_shipping_receipt",
  );
  const rendered = renderPriceQuote(quote(), {
    shippingAdjustment: {
      shippingFeeVnd: 0,
      receiptId: "shipping-approval:turn-7",
      sourceVersion: "policy-v1",
    },
  });
  assert.equal(rendered.amount("shipping"), 0);
  assert.equal(rendered.money("total"), "285.000đ");
});

test("mức tiết kiệm là slot discount có nguồn so sánh", () => {
  const rendered = renderPriceQuote(quote(2), { comparisonUnitQuote: quote(1) });
  assert.equal(rendered.money("discount"), "60.000đ");
  assert.match(
    rendered.slots.find((slot) => slot.role === "discount")?.sourceRef ?? "",
    /facebook-stopirex-1/u,
  );
});

test("final text không được còn placeholder giao dịch", () => {
  assert.throws(
    () => assertRenderedTransactionText("Tổng thanh toán {{total}}"),
    (error: unknown) =>
      error instanceof TransactionRenderError && error.code === "transaction_unknown_placeholder",
  );
  assert.doesNotThrow(() => assertRenderedTransactionText("Tổng thanh toán 315.000đ"));
});

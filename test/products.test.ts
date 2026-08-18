import assert from "node:assert/strict";
import test from "node:test";
import { ProductCatalog, ProductDataError, type PriceRecord } from "../src/domain/products.js";
import { tenantId } from "../src/domain/types.js";

const tenant = tenantId("tenant-a");
const activePrice: PriceRecord = {
  id: "price-v1",
  tenantId: tenant,
  channel: "facebook",
  sku: "STOPIREX-30ML",
  quantity: 1,
  productPrice: { amount: 285_000, currency: "VND" },
  shippingFee: { amount: 30_000, currency: "VND" },
  effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
  status: "active",
};

test("trả đúng giá theo tenant, channel và thời điểm", () => {
  const quote = new ProductCatalog([activePrice]).quote({
    tenantId: tenant,
    channel: "facebook",
    sku: "STOPIREX-30ML",
    quantity: 1,
    at: new Date("2026-07-22T00:00:00.000Z"),
  });
  assert.equal(quote.total.amount, 315_000);
  assert.equal(quote.sourceId, "price-v1");
});

test("fail closed khi không có hoặc có nhiều giá active", () => {
  assert.throws(
    () =>
      new ProductCatalog([]).quote({
        tenantId: tenant,
        channel: "facebook",
        sku: "STOPIREX-30ML",
        quantity: 1,
      }),
    ProductDataError,
  );
  assert.throws(
    () =>
      new ProductCatalog([activePrice, { ...activePrice, id: "price-v2" }]).quote({
        tenantId: tenant,
        channel: "facebook",
        sku: "STOPIREX-30ML",
        quantity: 1,
      }),
    /mâu thuẫn/,
  );
});

test("không dùng giá Facebook cho TikTok", () => {
  assert.throws(
    () =>
      new ProductCatalog([activePrice]).quote({
        tenantId: tenant,
        channel: "tiktok",
        sku: "STOPIREX-30ML",
        quantity: 1,
      }),
    ProductDataError,
  );
});

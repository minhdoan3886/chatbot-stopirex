import { ProductCatalog, type PriceRecord } from "../domain/products.js";
import type { TenantId } from "../domain/types.js";

export const demoCommerceEffectiveAt = new Date(
  "2026-07-22T00:00:00.000Z",
);

export function createDemoProductCatalog(tenantId: TenantId): ProductCatalog {
  const records: PriceRecord[] = [
    {
      id: "demo-facebook-single-v2026-01",
      tenantId,
      channel: "facebook",
      sku: "STOPIREX",
      quantity: 1,
      productPrice: { amount: 285_000, currency: "VND" },
      shippingFee: { amount: 30_000, currency: "VND" },
      effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
      status: "active",
      offerVersion: "facebook-2026-01",
      approvedBy: "Stopirex Commercial Ops",
    },
    {
      id: "demo-facebook-combo-v2026-01",
      tenantId,
      channel: "facebook",
      sku: "STOPIREX",
      quantity: 2,
      productPrice: { amount: 510_000, currency: "VND" },
      shippingFee: { amount: 0, currency: "VND" },
      effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
      status: "active",
      offerVersion: "facebook-2026-01",
      approvedBy: "Stopirex Commercial Ops",
    },
    ...([3, 4, 5] as const).map((quantity) => ({
      id: `demo-facebook-combo-${quantity}-v2026-08`,
      tenantId,
      channel: "facebook" as const,
      sku: "STOPIREX",
      quantity,
      productPrice: { amount: quantity * 250_000, currency: "VND" as const },
      shippingFee: { amount: 0, currency: "VND" as const },
      effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
      status: "active" as const,
      offerVersion: "facebook-2026-08-bulk",
      approvedBy: "Stopirex Commercial Ops",
    })),
  ];
  return new ProductCatalog(records);
}

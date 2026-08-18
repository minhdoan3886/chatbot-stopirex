import type { Channel, TenantId } from "./types.js";

export type Money = { amount: number; currency: "VND" };

export type PriceRecord = {
  id: string;
  tenantId: TenantId;
  channel: Channel;
  sku: string;
  quantity: number;
  productPrice: Money;
  shippingFee: Money;
  effectiveFrom: Date;
  effectiveTo?: Date;
  status: "draft" | "active" | "archived";
  offerVersion?: string;
  approvedBy?: string;
};

export type PriceQuote = {
  sourceId: string;
  sku: string;
  quantity: number;
  productPrice: Money;
  shippingFee: Money;
  total: Money;
  offerVersion?: string;
};

export class ProductCatalog {
  constructor(private readonly prices: readonly PriceRecord[]) {}

  quote(input: {
    tenantId: TenantId;
    channel: Channel;
    sku: string;
    quantity: number;
    at?: Date;
  }): PriceQuote {
    const at = input.at ?? new Date();
    const candidates = this.prices.filter(
      (price) =>
        price.tenantId === input.tenantId &&
        price.channel === input.channel &&
        price.sku === input.sku &&
        price.quantity === input.quantity &&
        price.status === "active" &&
        price.effectiveFrom <= at &&
        (!price.effectiveTo || price.effectiveTo > at),
    );

    if (candidates.length !== 1) {
      throw new ProductDataError(
        candidates.length === 0
          ? "Không tìm thấy một mức giá active phù hợp"
          : "Có nhiều mức giá active mâu thuẫn",
      );
    }

    const price = candidates[0]!;
    return {
      sourceId: price.id,
      sku: price.sku,
      quantity: price.quantity,
      productPrice: price.productPrice,
      shippingFee: price.shippingFee,
      total: { amount: price.productPrice.amount + price.shippingFee.amount, currency: "VND" },
      ...(price.offerVersion ? { offerVersion: price.offerVersion } : {}),
    };
  }
}

export class ProductDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProductDataError";
  }
}

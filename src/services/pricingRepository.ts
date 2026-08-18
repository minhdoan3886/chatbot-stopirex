import type { Pool } from "pg";
import { ProductCatalog, type PriceRecord } from "../domain/products.js";
import type { Channel, TenantId } from "../domain/types.js";

export interface PricingRepository {
  activePrices(input: {
    tenantId: TenantId;
    channel: Channel;
    at: Date;
  }): Promise<PriceRecord[]> | PriceRecord[];
}

export class InMemoryPricingRepository implements PricingRepository {
  constructor(private readonly records: readonly PriceRecord[]) {}

  activePrices(input: {
    tenantId: TenantId;
    channel: Channel;
    at: Date;
  }): PriceRecord[] {
    return this.records
      .filter(
        (record) =>
          record.tenantId === input.tenantId &&
          record.channel === input.channel &&
          record.status === "active" &&
          record.effectiveFrom <= input.at &&
          (!record.effectiveTo || record.effectiveTo > input.at),
      )
      .map((record) => ({ ...record }));
  }
}

export class PgPricingRepository implements PricingRepository {
  constructor(private readonly pool: Pool) {}

  async activePrices(input: {
    tenantId: TenantId;
    channel: Channel;
    at: Date;
  }): Promise<PriceRecord[]> {
    const result = await this.pool.query(
      `SELECT id::text, tenant_id::text, channel, sku, quantity,
              product_price_vnd, shipping_fee_vnd, effective_from, effective_to,
              status, offer_version, approved_by
       FROM product_prices
       WHERE tenant_id=$1 AND channel=$2 AND status='active'
         AND effective_from <= $3
         AND (effective_to IS NULL OR effective_to > $3)`,
      [input.tenantId, input.channel, input.at],
    );
    return result.rows.map((row) => ({
      id: String(row.id),
      tenantId: row.tenant_id as TenantId,
      channel: row.channel as Channel,
      sku: String(row.sku),
      quantity: Number(row.quantity),
      productPrice: {
        amount: Number(row.product_price_vnd),
        currency: "VND" as const,
      },
      shippingFee: {
        amount: Number(row.shipping_fee_vnd),
        currency: "VND" as const,
      },
      effectiveFrom: new Date(row.effective_from),
      ...(row.effective_to
        ? { effectiveTo: new Date(row.effective_to) }
        : {}),
      status: row.status as PriceRecord["status"],
      ...(row.offer_version
        ? { offerVersion: String(row.offer_version) }
        : {}),
      ...(row.approved_by ? { approvedBy: String(row.approved_by) } : {}),
    }));
  }

  async catalog(input: {
    tenantId: TenantId;
    channel: Channel;
    at: Date;
  }): Promise<ProductCatalog> {
    return new ProductCatalog(await this.activePrices(input));
  }
}

import type { Pool } from "pg";
import type { ShipmentTracking } from "../integrations/contracts.js";

export function trackingUrl(carrier: ShipmentTracking["carrier"], trackingNumber: string): string {
  if (carrier === "viettel_post") return "";
  if (carrier === "spx") {
    return `https://spx.vn/track?${encodeURIComponent(trackingNumber)}`;
  }
  if (carrier === "ghn") {
    return `https://donhang.ghn.vn/?order_code=${encodeURIComponent(trackingNumber)}`;
  }
  if (carrier === "ghtk") {
    return `https://i.ghtk.vn/${encodeURIComponent(trackingNumber)}`;
  }
  return "";
}

export class PgShipmentTrackingRepository {
  constructor(private readonly pool: Pool) {}

  async save(orderId: string, tracking: ShipmentTracking): Promise<void> {
    await this.pool.query(
      `INSERT INTO shipment_tracking (
         order_id, carrier, tracking_number, tracking_url, eta_at, status, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,now())
       ON CONFLICT (carrier, tracking_number) DO UPDATE SET
         tracking_url=EXCLUDED.tracking_url,
         eta_at=EXCLUDED.eta_at,
         status=EXCLUDED.status,
         updated_at=now()`,
      [
        orderId,
        tracking.carrier,
        tracking.trackingNumber,
        tracking.trackingUrl,
        tracking.etaAt ?? null,
        tracking.status,
      ],
    );
  }

  async find(trackingNumber: string): Promise<ShipmentTracking | undefined> {
    const result = await this.pool.query(
      `SELECT carrier, tracking_number, tracking_url, eta_at, status
       FROM shipment_tracking WHERE tracking_number=$1
       ORDER BY updated_at DESC LIMIT 1`,
      [trackingNumber],
    );
    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (!row) return undefined;
    return {
      carrier: row.carrier as ShipmentTracking["carrier"],
      trackingNumber: String(row.tracking_number),
      trackingUrl: String(row.tracking_url),
      status: String(row.status),
      ...(row.eta_at ? { etaAt: new Date(String(row.eta_at)) } : {}),
    };
  }
}

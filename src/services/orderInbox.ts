import type { Pool } from "pg";
import type { OrderDraft } from "../domain/orders.js";

export type OrderInboxStatus = "pending" | "completed" | "cancelled";

export type OrderInboxRecord = {
  id: string;
  sessionId: string;
  channel: string;
  recipientName?: string;
  phone?: string;
  legacyAddress?: string;
  deliveryNote?: string;
  sku?: string;
  quantity?: number;
  totalVnd?: number;
  paymentMethod?: "cod" | "bank_transfer";
  status: OrderInboxStatus;
  note?: string;
  confirmedAt: string;
  createdAt: string;
  updatedAt: string;
};

export type PushOrderInboxInput = {
  sessionId: string;
  channel?: string;
  draft: OrderDraft;
  confirmedAt: Date;
};

export type OrderInboxListResult = {
  total: number;
  pending: number;
  records: OrderInboxRecord[];
};

export class OrderInboxService {
  constructor(private readonly pool: Pool) {}

  /**
   * Ghi đơn mới vào inbox sau khi khách xác nhận ĐỒNG Ý.
   * Idempotent: nếu session đã có đơn pending thì upsert thay vì tạo mới.
   */
  async push(input: PushOrderInboxInput): Promise<OrderInboxRecord> {
    const { sessionId, channel = "meta", draft, confirmedAt } = input;
    const result = await this.pool.query<OrderInboxRecord>(
      `INSERT INTO order_inbox
        (session_id, channel, recipient_name, phone, legacy_address, delivery_note,
         sku, quantity, total_vnd, payment_method, confirmed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT DO NOTHING
       RETURNING
         id,
         session_id       AS "sessionId",
         channel,
         recipient_name   AS "recipientName",
         phone,
         legacy_address   AS "legacyAddress",
         delivery_note    AS "deliveryNote",
         sku,
         quantity,
         total_vnd        AS "totalVnd",
         payment_method   AS "paymentMethod",
         status,
         note,
         confirmed_at     AS "confirmedAt",
         created_at       AS "createdAt",
         updated_at       AS "updatedAt"`,
      [
        sessionId,
        channel,
        draft.recipientName ?? null,
        draft.phone ?? null,
        draft.legacyAddress ?? null,
        draft.deliveryNote ?? null,
        draft.sku ?? null,
        draft.quantity ?? null,
        draft.totalVnd ?? null,
        draft.paymentMethod ?? null,
        confirmedAt.toISOString(),
      ],
    );

    // Nếu ON CONFLICT bắn ra thì lấy bản ghi hiện tại
    if (result.rows.length === 0) {
      const existing = await this.pool.query<OrderInboxRecord>(
        `SELECT
           id,
           session_id     AS "sessionId",
           channel,
           recipient_name AS "recipientName",
           phone,
           legacy_address AS "legacyAddress",
           delivery_note  AS "deliveryNote",
           sku,
           quantity,
           total_vnd      AS "totalVnd",
           payment_method AS "paymentMethod",
           status,
           note,
           confirmed_at   AS "confirmedAt",
           created_at     AS "createdAt",
           updated_at     AS "updatedAt"
         FROM order_inbox
         WHERE session_id = $1
         ORDER BY created_at DESC
         LIMIT 1`,
        [sessionId],
      );
      return existing.rows[0]!;
    }

    return result.rows[0]!;
  }

  /**
   * Lấy danh sách đơn cho trang sale.
   * Mặc định lấy 200 đơn gần nhất, ưu tiên pending trước.
   */
  async list(filter?: { status?: OrderInboxStatus }): Promise<OrderInboxListResult> {
    const whereClause = filter?.status ? `WHERE status = $1` : "";
    const params: string[] = filter?.status ? [filter.status] : [];

    const [countResult, recordsResult] = await Promise.all([
      this.pool.query<{ total: string; pending: string }>(
        `SELECT
           COUNT(*)                                    AS total,
           COUNT(*) FILTER (WHERE status = 'pending') AS pending
         FROM order_inbox`,
      ),
      this.pool.query<OrderInboxRecord>(
        `SELECT
           id,
           session_id     AS "sessionId",
           channel,
           recipient_name AS "recipientName",
           phone,
           legacy_address AS "legacyAddress",
           delivery_note  AS "deliveryNote",
           sku,
           quantity,
           total_vnd      AS "totalVnd",
           payment_method AS "paymentMethod",
           status,
           note,
           confirmed_at   AS "confirmedAt",
           created_at     AS "createdAt",
           updated_at     AS "updatedAt"
         FROM order_inbox
         ${whereClause}
         ORDER BY
           (status = 'pending') DESC,
           confirmed_at DESC
         LIMIT 200`,
        params,
      ),
    ]);

    const totals = countResult.rows[0]!;
    return {
      total: Number(totals.total),
      pending: Number(totals.pending),
      records: recordsResult.rows,
    };
  }

  /**
   * Đánh dấu đơn là đã lên Sapo (hoặc huỷ).
   */
  async updateStatus(
    id: string,
    status: "completed" | "cancelled",
    note?: string,
  ): Promise<OrderInboxRecord | undefined> {
    const result = await this.pool.query<OrderInboxRecord>(
      `UPDATE order_inbox
       SET
         status     = $2,
         note       = COALESCE($3, note),
         updated_at = NOW()
       WHERE id = $1
       RETURNING
         id,
         session_id     AS "sessionId",
         channel,
         recipient_name AS "recipientName",
         phone,
         legacy_address AS "legacyAddress",
         delivery_note  AS "deliveryNote",
         sku,
         quantity,
         total_vnd      AS "totalVnd",
         payment_method AS "paymentMethod",
         status,
         note,
         confirmed_at   AS "confirmedAt",
         created_at     AS "createdAt",
         updated_at     AS "updatedAt"`,
      [id, status, note ?? null],
    );
    return result.rows[0];
  }
}

import type { Pool } from "pg";
import type { OrderDraft } from "../domain/orders.js";

export type OrderInboxStatus = "pending" | "completed" | "cancelled";

export type OrderInboxRecord = {
  id: string;
  sessionId: string;
  idempotencyKey: string;
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
  idempotencyKey?: string;
};

export type OrderInboxListResult = {
  total: number;
  pending: number;
  completed: number;
  cancelled: number;
  today: number;
  records: OrderInboxRecord[];
};

export class OrderInboxService {
  constructor(private readonly pool: Pool) {}

  /**
   * Ghi đơn mới vào inbox sau khi khách xác nhận ĐỒNG Ý.
   * Idempotent theo phiên và thời điểm xác nhận để retry không tạo bản ghi trùng.
   */
  async push(input: PushOrderInboxInput): Promise<OrderInboxRecord> {
    const {
      sessionId,
      channel = "meta",
      draft,
      confirmedAt,
      idempotencyKey = `${sessionId}:${confirmedAt.toISOString()}`,
    } = input;
    const result = await this.pool.query<OrderInboxRecord>(
      `INSERT INTO order_inbox
        (session_id, idempotency_key, channel, recipient_name, phone, legacy_address, delivery_note,
         sku, quantity, total_vnd, payment_method, confirmed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (session_id, idempotency_key)
       DO UPDATE SET idempotency_key = EXCLUDED.idempotency_key
       RETURNING
         id,
         session_id       AS "sessionId",
         idempotency_key  AS "idempotencyKey",
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
        idempotencyKey,
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

    const record = result.rows[0];
    if (!record) throw new Error("order_inbox_upsert_returned_no_record");
    return record;
  }

  /**
   * Lấy danh sách đơn cho trang sale.
   * Mặc định lấy 200 đơn gần nhất, ưu tiên pending trước.
   */
  async list(filter?: { status?: OrderInboxStatus }): Promise<OrderInboxListResult> {
    const whereClause = filter?.status ? `WHERE status = $1` : "";
    const params: string[] = filter?.status ? [filter.status] : [];

    const [countResult, recordsResult] = await Promise.all([
      this.pool.query<{
        total: string;
        pending: string;
        completed: string;
        cancelled: string;
        today: string;
      }>(
        `SELECT
           COUNT(*)                                       AS total,
           COUNT(*) FILTER (WHERE status = 'pending')    AS pending,
           COUNT(*) FILTER (WHERE status = 'completed')  AS completed,
           COUNT(*) FILTER (WHERE status = 'cancelled')  AS cancelled,
           COUNT(*) FILTER (
             WHERE confirmed_at >= date_trunc('day', NOW() AT TIME ZONE 'Asia/Ho_Chi_Minh') AT TIME ZONE 'Asia/Ho_Chi_Minh'
               AND confirmed_at < (date_trunc('day', NOW() AT TIME ZONE 'Asia/Ho_Chi_Minh') + interval '1 day') AT TIME ZONE 'Asia/Ho_Chi_Minh'
           ) AS today
         FROM order_inbox`,
      ),
      this.pool.query<OrderInboxRecord>(
        `SELECT
           id,
           session_id     AS "sessionId",
           idempotency_key AS "idempotencyKey",
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
      completed: Number(totals.completed),
      cancelled: Number(totals.cancelled),
      today: Number(totals.today),
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
         idempotency_key AS "idempotencyKey",
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

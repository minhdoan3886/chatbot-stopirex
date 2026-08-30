import type { Pool } from "pg";
import type { OrderDraft } from "../domain/orders.js";
import type { OrderTrackingCarrier } from "./orderTrackingNotification.js";

export type OrderInboxStatus = "pending" | "completed" | "cancelled";
export type TrackingSendStatus = "not_sent" | "sending" | "sent" | "failed";

export type OrderChangeEvidence = {
  at: string;
  type?: "created" | "customer_update";
  source: "customer_message" | "system";
  customerMessage?: string;
  acceptedActions?: Array<{ type: string; evidence: string }>;
  changedFields: string[];
  before?: Partial<OrderDraft>;
  after?: Partial<OrderDraft>;
};

export type OrderInboxRecord = {
  id: string;
  sessionId: string;
  idempotencyKey?: string;
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
  trackingCarrier?: OrderTrackingCarrier;
  trackingNumber?: string;
  trackingUrl?: string;
  trackingSendStatus: TrackingSendStatus;
  trackingMessageId?: string;
  trackingSentAt?: string;
  trackingLastError?: string;
  changeHistory: OrderChangeEvidence[];
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
  changeEvidence?: {
    customerMessage?: string;
    acceptedActions?: Array<{ type: string; evidence: string }>;
    changedFields?: string[];
  };
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
    const evidence = JSON.stringify({
      at: new Date().toISOString(),
      source: input.changeEvidence?.customerMessage ? "customer_message" : "system",
      ...(input.changeEvidence?.customerMessage
        ? { customerMessage: input.changeEvidence.customerMessage.slice(0, 1_000) }
        : {}),
      ...(input.changeEvidence?.acceptedActions?.length
        ? { acceptedActions: input.changeEvidence.acceptedActions.slice(-12) }
        : {}),
      changedFields: [...new Set(input.changeEvidence?.changedFields ?? [])],
    } satisfies Omit<OrderChangeEvidence, "source"> & { source: OrderChangeEvidence["source"] });
    const result = await this.pool.query<OrderInboxRecord>(
      `INSERT INTO order_inbox
        (session_id, idempotency_key, channel, recipient_name, phone, legacy_address, delivery_note,
         sku, quantity, total_vnd, payment_method, confirmed_at, change_history)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
         jsonb_build_array($13::jsonb || jsonb_build_object(
           'type', 'created',
           'after', jsonb_build_object(
             'recipientName', $4::text, 'phone', $5::text, 'legacyAddress', $6::text,
             'deliveryNote', $7::text, 'sku', $8::text, 'quantity', $9::integer,
             'totalVnd', $10::bigint, 'paymentMethod', $11::text
           )
         )))
       ON CONFLICT (session_id, idempotency_key)
       DO UPDATE SET
         recipient_name = CASE WHEN order_inbox.status = 'pending'
                                    AND order_inbox.tracking_number IS NULL
                                    AND order_inbox.tracking_sent_at IS NULL
                               THEN EXCLUDED.recipient_name ELSE order_inbox.recipient_name END,
         phone = CASE WHEN order_inbox.status = 'pending'
                           AND order_inbox.tracking_number IS NULL
                           AND order_inbox.tracking_sent_at IS NULL
                      THEN EXCLUDED.phone ELSE order_inbox.phone END,
         legacy_address = CASE WHEN order_inbox.status = 'pending'
                                    AND order_inbox.tracking_number IS NULL
                                    AND order_inbox.tracking_sent_at IS NULL
                               THEN EXCLUDED.legacy_address ELSE order_inbox.legacy_address END,
         delivery_note = CASE WHEN order_inbox.status = 'pending'
                                   AND order_inbox.tracking_number IS NULL
                                   AND order_inbox.tracking_sent_at IS NULL
                              THEN EXCLUDED.delivery_note ELSE order_inbox.delivery_note END,
         sku = CASE WHEN order_inbox.status = 'pending'
                         AND order_inbox.tracking_number IS NULL
                         AND order_inbox.tracking_sent_at IS NULL
                    THEN EXCLUDED.sku ELSE order_inbox.sku END,
         quantity = CASE WHEN order_inbox.status = 'pending'
                              AND order_inbox.tracking_number IS NULL
                              AND order_inbox.tracking_sent_at IS NULL
                         THEN EXCLUDED.quantity ELSE order_inbox.quantity END,
         total_vnd = CASE WHEN order_inbox.status = 'pending'
                               AND order_inbox.tracking_number IS NULL
                               AND order_inbox.tracking_sent_at IS NULL
                          THEN EXCLUDED.total_vnd ELSE order_inbox.total_vnd END,
         payment_method = CASE WHEN order_inbox.status = 'pending'
                                    AND order_inbox.tracking_number IS NULL
                                    AND order_inbox.tracking_sent_at IS NULL
                               THEN EXCLUDED.payment_method ELSE order_inbox.payment_method END,
         change_history = CASE
           WHEN order_inbox.status = 'pending'
             AND order_inbox.tracking_number IS NULL
             AND order_inbox.tracking_sent_at IS NULL
             AND ROW(
               order_inbox.recipient_name, order_inbox.phone, order_inbox.legacy_address,
               order_inbox.delivery_note, order_inbox.sku, order_inbox.quantity,
               order_inbox.total_vnd, order_inbox.payment_method
             ) IS DISTINCT FROM ROW(
               EXCLUDED.recipient_name, EXCLUDED.phone, EXCLUDED.legacy_address,
               EXCLUDED.delivery_note, EXCLUDED.sku, EXCLUDED.quantity,
               EXCLUDED.total_vnd, EXCLUDED.payment_method
             )
           THEN order_inbox.change_history || jsonb_build_array(
             $13::jsonb || jsonb_build_object(
               'type', 'customer_update',
               'before', jsonb_build_object(
                 'recipientName', order_inbox.recipient_name,
                 'phone', order_inbox.phone,
                 'legacyAddress', order_inbox.legacy_address,
                 'deliveryNote', order_inbox.delivery_note,
                 'sku', order_inbox.sku,
                 'quantity', order_inbox.quantity,
                 'totalVnd', order_inbox.total_vnd,
                 'paymentMethod', order_inbox.payment_method
               ),
               'after', jsonb_build_object(
                 'recipientName', EXCLUDED.recipient_name,
                 'phone', EXCLUDED.phone,
                 'legacyAddress', EXCLUDED.legacy_address,
                 'deliveryNote', EXCLUDED.delivery_note,
                 'sku', EXCLUDED.sku,
                 'quantity', EXCLUDED.quantity,
                 'totalVnd', EXCLUDED.total_vnd,
                 'paymentMethod', EXCLUDED.payment_method
               )
             )
           )
           ELSE order_inbox.change_history
         END,
         updated_at = CASE
           WHEN order_inbox.status = 'pending'
             AND order_inbox.tracking_number IS NULL
             AND order_inbox.tracking_sent_at IS NULL
           THEN NOW() ELSE order_inbox.updated_at END
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
         tracking_carrier AS "trackingCarrier",
         tracking_number AS "trackingNumber",
         tracking_url AS "trackingUrl",
         tracking_send_status AS "trackingSendStatus",
         tracking_message_id AS "trackingMessageId",
         tracking_sent_at AS "trackingSentAt",
         tracking_last_error AS "trackingLastError",
         change_history AS "changeHistory",
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
        evidence,
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
           tracking_carrier AS "trackingCarrier",
           tracking_number AS "trackingNumber",
           tracking_url AS "trackingUrl",
           tracking_send_status AS "trackingSendStatus",
           tracking_message_id AS "trackingMessageId",
           tracking_sent_at AS "trackingSentAt",
           tracking_last_error AS "trackingLastError",
           change_history AS "changeHistory",
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
         tracking_carrier AS "trackingCarrier",
         tracking_number AS "trackingNumber",
         tracking_url AS "trackingUrl",
         tracking_send_status AS "trackingSendStatus",
         tracking_message_id AS "trackingMessageId",
         tracking_sent_at AS "trackingSentAt",
         tracking_last_error AS "trackingLastError",
         change_history AS "changeHistory",
         confirmed_at   AS "confirmedAt",
         created_at     AS "createdAt",
         updated_at     AS "updatedAt"`,
      [id, status, note ?? null],
    );
    return result.rows[0];
  }

  /** Giữ quyền gửi để hai thao tác đồng thời không gửi trùng cho khách. */
  async claimTrackingSend(input: {
    id: string;
    carrier: OrderTrackingCarrier;
    trackingNumber: string;
    trackingUrl?: string;
  }): Promise<OrderInboxRecord | undefined> {
    const result = await this.pool.query<OrderInboxRecord>(
      `UPDATE order_inbox
       SET tracking_carrier = $2,
           tracking_number = $3,
           tracking_url = $4,
           tracking_send_status = 'sending',
           tracking_last_error = NULL,
           updated_at = NOW()
       WHERE id = $1
         AND status = 'pending'
         AND tracking_sent_at IS NULL
         AND tracking_send_status IN ('not_sent', 'failed')
       RETURNING ${orderInboxReturningColumns}`,
      [input.id, input.carrier, input.trackingNumber, input.trackingUrl ?? null],
    );
    return result.rows[0];
  }

  async findById(id: string): Promise<OrderInboxRecord | undefined> {
    const result = await this.pool.query<OrderInboxRecord>(
      `SELECT ${orderInboxReturningColumns} FROM order_inbox WHERE id = $1`,
      [id],
    );
    return result.rows[0];
  }

  /** Trạng thái authoritative để chatbot chỉ nhận sửa khi chưa có mã vận đơn. */
  async canEditPending(sessionId: string): Promise<boolean | undefined> {
    const result = await this.pool.query<{
      status: OrderInboxStatus;
      trackingNumber?: string;
      trackingSentAt?: string;
    }>(
      `SELECT status,
              tracking_number AS "trackingNumber",
              tracking_sent_at AS "trackingSentAt"
       FROM order_inbox
       WHERE session_id = $1
       ORDER BY confirmed_at DESC
       LIMIT 1`,
      [sessionId],
    );
    const record = result.rows[0];
    if (!record) return undefined;
    return record.status === "pending" && !record.trackingNumber && !record.trackingSentAt;
  }

  async markTrackingSent(id: string, messageId: string): Promise<OrderInboxRecord | undefined> {
    const result = await this.pool.query<OrderInboxRecord>(
      `UPDATE order_inbox
       SET tracking_send_status = 'sent',
           tracking_message_id = $2,
           tracking_sent_at = NOW(),
           tracking_last_error = NULL,
           status = 'completed',
           updated_at = NOW()
       WHERE id = $1 AND tracking_send_status = 'sending'
       RETURNING ${orderInboxReturningColumns}`,
      [id, messageId],
    );
    return result.rows[0];
  }

  async markTrackingFailed(id: string, reason: string): Promise<OrderInboxRecord | undefined> {
    const result = await this.pool.query<OrderInboxRecord>(
      `UPDATE order_inbox
       SET tracking_send_status = 'failed',
           tracking_last_error = $2,
           updated_at = NOW()
       WHERE id = $1 AND tracking_send_status = 'sending'
       RETURNING ${orderInboxReturningColumns}`,
      [id, reason.slice(0, 500)],
    );
    return result.rows[0];
  }
}

const orderInboxReturningColumns = `
  id,
  session_id AS "sessionId",
  idempotency_key AS "idempotencyKey",
  channel,
  recipient_name AS "recipientName",
  phone,
  legacy_address AS "legacyAddress",
  delivery_note AS "deliveryNote",
  sku,
  quantity,
  total_vnd AS "totalVnd",
  payment_method AS "paymentMethod",
  status,
  note,
  tracking_carrier AS "trackingCarrier",
  tracking_number AS "trackingNumber",
  tracking_url AS "trackingUrl",
  tracking_send_status AS "trackingSendStatus",
  tracking_message_id AS "trackingMessageId",
  tracking_sent_at AS "trackingSentAt",
  tracking_last_error AS "trackingLastError",
  change_history AS "changeHistory",
  confirmed_at AS "confirmedAt",
  created_at AS "createdAt",
  updated_at AS "updatedAt"`;

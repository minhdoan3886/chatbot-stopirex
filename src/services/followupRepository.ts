import type { FollowupContextSnapshot, FollowupJob } from "../domain/followup.js";
import type { Pool } from "pg";

export type FollowupCycleSchedule = {
  tenantId: string;
  pageId: string;
  conversationId: string;
  anchorOutboundMessageId: string;
  anchorSentAt: Date;
  stateVersion: number;
  contextSnapshot?: FollowupContextSnapshot;
};

export type ClaimedFollowupJob = {
  id: string;
  cycleId: string;
  tenantId: string;
  pageId: string;
  conversationId: string;
  externalCustomerId: string;
  stage: "3h" | "6h" | "9h";
  idempotencyKey: string;
  attemptCount: number;
  anchorSentAt: Date;
  anchorStateVersion: number;
  currentStateVersion: number;
  cycleStatus: "active" | "completed" | "cancelled";
  humanStatus: "bot" | "human" | "paused";
  pipelineTag: string;
  pageActive: boolean;
  customerDeleted: boolean;
  orderExists: boolean;
  lastCustomerActivityAt?: Date;
  contextSnapshot: FollowupContextSnapshot;
};

export type FollowupRuntimeSnapshot = {
  scheduled: number;
  claimed: number;
  sent: number;
  cancelled: number;
  failed: number;
  shadowed: number;
  deliveryUnknown: number;
  due: number;
  oldestDueAt?: string;
  lastSentAt?: string;
  lastFailureAt?: string;
};

export class InMemoryFollowupRepository {
  private readonly jobs = new Map<string, FollowupJob>();

  schedule(input: readonly FollowupJob[]): void {
    for (const job of input) {
      if (!this.jobs.has(job.idempotencyKey)) this.jobs.set(job.idempotencyKey, { ...job });
    }
  }

  list(): FollowupJob[] {
    return [...this.jobs.values()].map((job) => ({ ...job }));
  }

  cancelAll(reason: string): void {
    for (const [key, job] of this.jobs) {
      if (job.status === "scheduled" || job.status === "claimed") {
        this.jobs.set(key, { ...job, status: "cancelled", cancelReason: reason });
      }
    }
  }
}

export class PgFollowupRepository {
  constructor(private readonly pool: Pool) {}

  async scheduleCycle(input: FollowupCycleSchedule): Promise<{ cycleId: string; created: boolean }> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [input.conversationId]);
      const existing = await client.query(
        `SELECT id::text
         FROM followup_cycles
         WHERE tenant_id = $1 AND conversation_id = $2 AND anchor_outbound_message_id = $3`,
        [input.tenantId, input.conversationId, input.anchorOutboundMessageId],
      );
      if (existing.rowCount === 1) {
        await client.query("COMMIT");
        return { cycleId: String(existing.rows[0].id), created: false };
      }
      await client.query(
        `UPDATE followup_cycles
         SET status = 'cancelled', cancel_reason = 'superseded_by_new_quote', updated_at = now()
         WHERE tenant_id = $1 AND conversation_id = $2 AND status = 'active'`,
        [input.tenantId, input.conversationId],
      );
      await client.query(
        `UPDATE followup_jobs
         SET status = 'cancelled', cancel_reason = 'superseded_by_new_quote'
         WHERE tenant_id = $1 AND conversation_id = $2 AND status IN ('scheduled', 'claimed')`,
        [input.tenantId, input.conversationId],
      );
      const cycle = await client.query(
        `INSERT INTO followup_cycles (
           tenant_id, page_id, conversation_id, anchor_outbound_message_id,
           anchor_sent_at, state_version, context_snapshot, status
         ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,'active')
         RETURNING id::text`,
        [
          input.tenantId,
          input.pageId,
          input.conversationId,
          input.anchorOutboundMessageId,
          input.anchorSentAt,
          input.stateVersion,
          JSON.stringify(input.contextSnapshot ?? {}),
        ],
      );
      const cycleId = String(cycle.rows[0].id);
      for (const [stage, hours] of [
        ["3h", 3],
        ["6h", 6],
        ["9h", 9],
      ] as const) {
        const dueAt = new Date(input.anchorSentAt.getTime() + hours * 60 * 60 * 1_000);
        const idempotencyKey = [
          input.tenantId,
          input.pageId,
          input.conversationId,
          "followup",
          cycleId,
          stage,
        ].join(":");
        await client.query(
          `INSERT INTO followup_jobs (
             tenant_id, page_id, conversation_id, cycle_id, state_version,
             stage, due_at, status, idempotency_key
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,'scheduled',$8)
           ON CONFLICT (idempotency_key) DO NOTHING`,
          [
            input.tenantId,
            input.pageId,
            input.conversationId,
            cycleId,
            input.stateVersion,
            stage,
            dueAt,
            idempotencyKey,
          ],
        );
      }
      await client.query("COMMIT");
      return { cycleId, created: true };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async schedule(jobs: readonly FollowupJob[]): Promise<void> {
    for (const job of jobs) {
      await this.pool.query(
        `INSERT INTO followup_jobs (tenant_id,page_id,conversation_id,stage,due_at,status,idempotency_key)
         VALUES ($1,$2,$3,$4,$5,'scheduled',$6) ON CONFLICT (idempotency_key) DO NOTHING`,
        [job.scope.tenantId, job.scope.pageId, job.conversationId, job.stage, job.dueAt, job.idempotencyKey],
      );
    }
  }

  async claimDue(now: Date, limit = 50): Promise<ClaimedFollowupJob[]> {
    const result = await this.pool.query(
      `WITH due AS (
         SELECT f.id
         FROM followup_jobs f
         JOIN followup_cycles fc ON fc.id = f.cycle_id
         WHERE f.status = 'scheduled' AND f.due_at <= $1 AND fc.status = 'active'
         ORDER BY f.due_at
         FOR UPDATE OF f SKIP LOCKED
         LIMIT $2
       ), claimed AS (
         UPDATE followup_jobs f
         SET status = 'claimed', claimed_at = now(), last_attempt_at = now(),
             attempt_count = attempt_count + 1
         FROM due
         WHERE f.id = due.id
         RETURNING f.*
       )
       SELECT
         f.id::text, f.cycle_id::text, f.tenant_id::text, f.page_id::text,
         f.conversation_id::text, f.stage, f.idempotency_key, f.attempt_count,
         fc.anchor_sent_at, fc.state_version AS anchor_state_version, fc.status AS cycle_status,
         fc.context_snapshot,
         c.state_version AS current_state_version, c.human_status, c.pipeline_tag,
         p.active AS page_active, (cu.deleted_at IS NOT NULL) AS customer_deleted,
         cu.external_customer_id,
         EXISTS (
           SELECT 1 FROM orders o
           WHERE o.conversation_id = c.id AND o.status IN ('confirmed','creating','created')
         ) OR EXISTS (
           SELECT 1 FROM order_inbox oi
           WHERE oi.session_id = concat(c.page_id::text, ':', cu.external_customer_id)
             AND oi.status IN ('pending','completed')
         ) AS order_exists,
         GREATEST(
           (SELECT max(m.created_at) FROM messages m
            WHERE m.conversation_id = c.id AND m.direction = 'inbound'),
           (SELECT max(ie.received_at) FROM inbound_events ie
            WHERE ie.page_id = c.page_id
              AND ie.payload->'sender'->>'id' = cu.external_customer_id
              AND (ie.payload ? 'message' OR ie.payload ? 'postback'))
         ) AS last_customer_activity_at
       FROM claimed f
       JOIN followup_cycles fc ON fc.id = f.cycle_id
       JOIN conversations c ON c.id = f.conversation_id
       JOIN customers cu ON cu.id = c.customer_id
       JOIN pages p ON p.id = f.page_id`,
      [now, limit],
    );
    return result.rows.map(mapClaimedJob);
  }

  async cancelConversation(input: {
    tenantId: string;
    conversationId: string;
    reason: string;
  }): Promise<number> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [input.conversationId]);
      await client.query(
        `UPDATE followup_cycles
         SET status = 'cancelled', cancel_reason = $3, updated_at = now()
         WHERE tenant_id = $1 AND conversation_id = $2 AND status = 'active'`,
        [input.tenantId, input.conversationId, input.reason],
      );
      const result = await client.query(
        `UPDATE followup_jobs
         SET status = 'cancelled', cancel_reason = $3
         WHERE tenant_id = $1 AND conversation_id = $2 AND status IN ('scheduled','claimed')`,
        [input.tenantId, input.conversationId, input.reason],
      );
      await client.query("COMMIT");
      return result.rowCount ?? 0;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async isStillClaimed(jobId: string): Promise<boolean> {
    const result = await this.pool.query(
      `SELECT EXISTS (
         SELECT 1 FROM followup_jobs f
         JOIN followup_cycles fc ON fc.id = f.cycle_id
         WHERE f.id = $1 AND f.status = 'claimed' AND fc.status = 'active'
       ) AS active`,
      [jobId],
    );
    return result.rows[0]?.active === true;
  }

  async markSent(input: {
    job: ClaimedFollowupJob;
    metaMessageId: string;
    text: string;
    sentAt: Date;
    pendingQuestionTopic?: string;
    composerStatus?: string;
  }): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `UPDATE followup_jobs
         SET status = 'sent', sent_at = $2, meta_message_id = $3,
             last_error_code = NULL, last_error_message = NULL
         WHERE id = $1 AND status = 'claimed'`,
        [input.job.id, input.sentAt, input.metaMessageId],
      );
      await client.query(
        `INSERT INTO messages (
           tenant_id, page_id, conversation_id, external_message_id,
           direction, kind, text_content, raw_payload
         ) VALUES ($1,$2,$3,$4,'outbound','text',$5,$6::jsonb)
         ON CONFLICT (page_id, external_message_id) DO NOTHING`,
        [
          input.job.tenantId,
          input.job.pageId,
          input.job.conversationId,
          input.metaMessageId,
          input.text,
          JSON.stringify({
            source: "followup",
            stage: input.job.stage,
            cycleId: input.job.cycleId,
            jobId: input.job.id,
            ...(input.composerStatus ? { composerStatus: input.composerStatus } : {}),
          }),
        ],
      );
      const conversation = await client.query(
        `SELECT runtime_state
         FROM conversations
         WHERE id = $1 AND human_status = 'bot'
         FOR UPDATE`,
        [input.job.conversationId],
      );
      const currentState = asRuntimeState(conversation.rows[0]?.runtime_state);
      const history = Array.isArray(currentState.history)
        ? currentState.history.filter(isHistoryTurn).slice(-39)
        : [];
      history.push({ role: "assistant", text: input.text });
      currentState.history = history;
      currentState.freeShippingApproved = true;
      currentState.lastNextBestAction =
        input.job.stage === "9h"
          ? {
              type: "close_without_question",
              state: "stopped",
              key: "followup_cycle_completed",
              reason: "Đã gửi nhịp cuối và khép vòng follow-up.",
            }
          : {
              type: "ask_relevant_fact",
              state: "preserved_existing_question",
              key: `followup_${input.job.stage}`,
              reason: "Câu hỏi follow-up đã gửi và được lưu vào lịch sử hội thoại.",
            };
      if (input.job.stage === "9h") {
        currentState.pipeline = "N.Nuôi dưỡng";
        delete currentState.pendingQuestionTopic;
      } else {
        currentState.pipeline = "7.Chờ followup";
        if (input.pendingQuestionTopic) currentState.pendingQuestionTopic = input.pendingQuestionTopic;
        else delete currentState.pendingQuestionTopic;
      }
      if (conversation.rowCount === 1) {
        await client.query(
          `UPDATE conversations
           SET pipeline_tag = $2,
               runtime_state = $3::jsonb,
               state_version = state_version + 1,
               updated_at = now()
           WHERE id = $1 AND human_status = 'bot'`,
          [
            input.job.conversationId,
            input.job.stage === "9h" ? "N.Nuôi dưỡng" : "7.Chờ followup",
            JSON.stringify(currentState),
          ],
        );
      }
      if (input.job.stage === "9h") {
        await client.query(
          `UPDATE followup_cycles SET status = 'completed', updated_at = now() WHERE id = $1`,
          [input.job.cycleId],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async markShadowed(jobId: string): Promise<void> {
    await this.pool.query(
      "UPDATE followup_jobs SET status = 'shadowed' WHERE id = $1 AND status = 'claimed'",
      [jobId],
    );
  }

  async markCancelled(jobId: string, reason: string): Promise<void> {
    await this.pool.query(
      `UPDATE followup_jobs SET status = 'cancelled', cancel_reason = $2
       WHERE id = $1 AND status IN ('scheduled','claimed')`,
      [jobId, reason],
    );
  }

  async releaseClaim(jobId: string, retryAt: Date, reason: string): Promise<void> {
    await this.pool.query(
      `UPDATE followup_jobs
       SET status = 'scheduled', due_at = $2, claimed_at = NULL,
           attempt_count = GREATEST(0, attempt_count - 1),
           last_error_code = $3, last_error_message = $3
       WHERE id = $1 AND status = 'claimed'`,
      [jobId, retryAt, reason],
    );
  }

  async markSendFailure(input: {
    job: ClaimedFollowupJob;
    code: string;
    message: string;
    retryable: boolean;
    ambiguous: boolean;
    maxAttempts: number;
    retryAt: Date;
  }): Promise<"scheduled" | "failed" | "delivery_unknown"> {
    const status = input.ambiguous
      ? "delivery_unknown"
      : input.retryable && input.job.attemptCount < input.maxAttempts
        ? "scheduled"
        : "failed";
    await this.pool.query(
      `UPDATE followup_jobs
       SET status = $2, due_at = CASE WHEN $2 = 'scheduled' THEN $3 ELSE due_at END,
           claimed_at = NULL, last_error_code = $4, last_error_message = $5
       WHERE id = $1 AND status = 'claimed'`,
      [input.job.id, status, input.retryAt, input.code, input.message.slice(0, 800)],
    );
    return status;
  }

  async releaseStaleClaims(before: Date): Promise<number> {
    const result = await this.pool.query(
      `UPDATE followup_jobs
       SET status = 'scheduled', claimed_at = NULL,
           last_error_code = 'stale_claim_recovered',
           last_error_message = 'Worker claim hết hạn trước khi hoàn tất'
       WHERE status = 'claimed' AND claimed_at < $1`,
      [before],
    );
    return result.rowCount ?? 0;
  }

  async runtimeSnapshot(now = new Date()): Promise<FollowupRuntimeSnapshot> {
    const result = await this.pool.query(
      `SELECT
         count(*) FILTER (WHERE status = 'scheduled')::int AS scheduled,
         count(*) FILTER (WHERE status = 'claimed')::int AS claimed,
         count(*) FILTER (WHERE status = 'sent')::int AS sent,
         count(*) FILTER (WHERE status = 'cancelled')::int AS cancelled,
         count(*) FILTER (WHERE status = 'failed')::int AS failed,
         count(*) FILTER (WHERE status = 'shadowed')::int AS shadowed,
         count(*) FILTER (WHERE status = 'delivery_unknown')::int AS delivery_unknown,
         count(*) FILTER (WHERE status = 'scheduled' AND due_at <= $1)::int AS due,
         min(due_at) FILTER (WHERE status = 'scheduled' AND due_at <= $1) AS oldest_due_at,
         max(sent_at) AS last_sent_at,
         max(last_attempt_at) FILTER (WHERE status IN ('failed','delivery_unknown')) AS last_failure_at
       FROM followup_jobs`,
      [now],
    );
    const row = result.rows[0] ?? {};
    return {
      scheduled: Number(row.scheduled ?? 0),
      claimed: Number(row.claimed ?? 0),
      sent: Number(row.sent ?? 0),
      cancelled: Number(row.cancelled ?? 0),
      failed: Number(row.failed ?? 0),
      shadowed: Number(row.shadowed ?? 0),
      deliveryUnknown: Number(row.delivery_unknown ?? 0),
      due: Number(row.due ?? 0),
      ...dateValue("oldestDueAt", row.oldest_due_at),
      ...dateValue("lastSentAt", row.last_sent_at),
      ...dateValue("lastFailureAt", row.last_failure_at),
    };
  }
}

function mapClaimedJob(row: Record<string, unknown>): ClaimedFollowupJob {
  return {
    id: String(row.id),
    cycleId: String(row.cycle_id),
    tenantId: String(row.tenant_id),
    pageId: String(row.page_id),
    conversationId: String(row.conversation_id),
    externalCustomerId: String(row.external_customer_id),
    stage: row.stage as ClaimedFollowupJob["stage"],
    idempotencyKey: String(row.idempotency_key),
    attemptCount: Number(row.attempt_count),
    anchorSentAt: new Date(row.anchor_sent_at as string | Date),
    anchorStateVersion: Number(row.anchor_state_version),
    currentStateVersion: Number(row.current_state_version),
    cycleStatus: row.cycle_status as ClaimedFollowupJob["cycleStatus"],
    humanStatus: row.human_status as ClaimedFollowupJob["humanStatus"],
    pipelineTag: String(row.pipeline_tag),
    pageActive: row.page_active === true,
    customerDeleted: row.customer_deleted === true,
    orderExists: row.order_exists === true,
    contextSnapshot: asFollowupContext(row.context_snapshot),
    ...(row.last_customer_activity_at
      ? { lastCustomerActivityAt: new Date(row.last_customer_activity_at as string | Date) }
      : {}),
  };
}

function asFollowupContext(value: unknown): FollowupContextSnapshot {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (structuredClone(value) as FollowupContextSnapshot)
    : {};
}

function asRuntimeState(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (structuredClone(value) as Record<string, unknown>)
    : {};
}

function isHistoryTurn(value: unknown): value is { role: "user" | "assistant"; text: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const turn = value as { role?: unknown; text?: unknown };
  return (turn.role === "user" || turn.role === "assistant") && typeof turn.text === "string";
}

function dateValue<Key extends string>(key: Key, value: unknown): Partial<Record<Key, string>> {
  return value ? ({ [key]: new Date(value as string | Date).toISOString() } as Record<Key, string>) : {};
}

import { Pool, type PoolClient } from "pg";
import type { TenantId } from "../domain/types.js";
import type { LlmUsageTelemetry } from "../services/codexLlm.js";
import type { ActionRolloutComparison } from "../domain/actionRollout.js";
import {
  marketingSourceCategory,
  marketingCustomerStage,
  referralAdTitle,
  referralPostId,
  shouldRecordMarketingTouch,
  type MarketingCustomerStage,
  type MarketingSourceCategory,
  type MetaReferralAttribution,
} from "../domain/marketingAttribution.js";

export type MessengerConversation = {
  customerId: string;
  displayName?: string;
  conversationId: string;
  humanStatus: "bot" | "human" | "paused";
  runtimeState: unknown;
  stateVersion: number;
  pipelineTag: string;
};

export type MarketingAttributionTouchInput = {
  tenantId: TenantId;
  pageId: string;
  customerId: string;
  conversationId: string;
  externalEventId: string;
  occurredAt: Date;
  referral?: MetaReferralAttribution;
};

export type MarketingAttributionSegment = {
  sourceCategory: MarketingSourceCategory;
  customerStage: MarketingCustomerStage;
  touches: number;
  uniqueCustomers: number;
  orders: number;
  revenueVnd: number;
};

export type MarketingAttributionAd = {
  adId: string;
  adTitle?: string;
  touches: number;
  uniqueCustomers: number;
  newCustomers: number;
  returningCustomers: number;
  orders: number;
  revenueVnd: number;
};

export type MarketingAttributionSnapshot = {
  generatedAt: string;
  periodDays: number;
  pageId?: string;
  totals: {
    touches: number;
    newCustomers: number;
    returningCustomers: number;
    paidTouches: number;
    organicTouches: number;
    referralTouches: number;
    orders: number;
    revenueVnd: number;
  };
  segments: MarketingAttributionSegment[];
  ads: MarketingAttributionAd[];
};

export type ConversationOutboundPlan = {
  outboxId: string;
  idempotencyKey: string;
  recipientId: string;
  texts: string[];
  sentCount: number;
  sourceEventIds: string[];
  status: "pending" | "processing" | "sent" | "failed";
  lastMessageId?: string;
};

export type ActionRolloutSnapshot = {
  sampleSize24h: number;
  multiActionLive24h: number;
  intentMismatchRate: number;
  pipelineMismatchRate: number;
  handoffMismatchRate: number;
  clarificationMismatchRate: number;
  replyMismatchRate: number;
  rejectedActionRate: number;
  conflictRate: number;
  multiActionMessageRate: number;
};

export type OperationalSessionRecord = {
  id: string;
  channel: string;
  pageLabel: string;
  humanStatus: "bot" | "human" | "paused";
  pipeline: string;
  stage: string;
  signal?: string;
  summary?: string;
  stateVersion: number;
  updatedAt: string;
  lastInboundAt?: string;
  lastOutboundAt?: string;
  inboundMessages: number;
  outboundMessages: number;
  lastIntent?: string;
  secondaryIntents?: string[];
  activeSkill?: string;
  selectedRoute?: string;
};

export type PostgresOperationalSnapshot = {
  totalSessions: number;
  activeSessions24h: number;
  botSessions: number;
  humanSessions: number;
  pausedSessions: number;
  pendingInboundEvents: number;
  oldestPendingInboundAt?: string;
  lastWebhookAt?: string;
  lastInboundAt?: string;
  lastOutboundAt?: string;
  pipelines: Array<{ name: string; count: number }>;
  sessions: OperationalSessionRecord[];
};

export type FollowupOperationalSnapshot = {
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

export type LlmUsageTotals = {
  calls: number;
  successes: number;
  failures: number;
  pricedCalls: number;
  unpricedCalls: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
  costUsd: number;
  averageLatencyMs: number;
};

export type LlmUsagePoint = LlmUsageTotals & { bucket: string };

export type LlmUsageModelBreakdown = LlmUsageTotals & {
  provider: string;
  model: string;
};

export type LlmUsageFailure = {
  occurredAt: string;
  provider: string;
  model: string;
  purpose: string;
  latencyMs: number;
  errorCode: string;
};

export type LlmProviderActivity = {
  occurredAt: string;
  provider: string;
  model: string;
  purpose: string;
  status: "success" | "failure";
  latencyMs: number;
  errorCode?: string;
};

export type LlmUsageSnapshot = {
  summaries: {
    hours24: LlmUsageTotals;
    days7: LlmUsageTotals;
    days30: LlmUsageTotals;
  };
  hourly24: LlmUsagePoint[];
  daily30: LlmUsagePoint[];
  models30: LlmUsageModelBreakdown[];
  recentFailures: LlmUsageFailure[];
  latestProviders: LlmProviderActivity[];
};

export class PostgresStore {
  readonly pool: Pool;
  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString, max: 10, statement_timeout: 5_000 });
  }

  async ready(): Promise<boolean> {
    try {
      const result = await this.pool.query("SELECT 1 AS ok");
      return result.rows[0]?.ok === 1;
    } catch {
      return false;
    }
  }

  async operationalSnapshot(limit = 500): Promise<PostgresOperationalSnapshot> {
    const safeLimit = Math.max(1, Math.min(Math.trunc(limit), 500));
    const [summary, pipelineRows, sessionRows] = await Promise.all([
      this.pool.query(
        `SELECT
           (SELECT count(*)::int FROM conversations) AS total_sessions,
           (SELECT count(*)::int FROM conversations WHERE updated_at >= now() - interval '24 hours') AS active_sessions_24h,
           (SELECT count(*)::int FROM conversations WHERE human_status = 'bot') AS bot_sessions,
           (SELECT count(*)::int FROM conversations WHERE human_status = 'human') AS human_sessions,
           (SELECT count(*)::int FROM conversations WHERE human_status = 'paused') AS paused_sessions,
           (SELECT count(*)::int FROM inbound_events WHERE processed_at IS NULL) AS pending_inbound_events,
           (SELECT min(received_at) FROM inbound_events WHERE processed_at IS NULL) AS oldest_pending_inbound_at,
           (SELECT max(received_at) FROM inbound_events) AS last_webhook_at,
           (SELECT max(created_at) FROM messages WHERE direction = 'inbound') AS last_inbound_at,
           (SELECT max(created_at) FROM messages WHERE direction = 'outbound') AS last_outbound_at`,
      ),
      this.pool.query(
        `SELECT pipeline_tag AS name, count(*)::int AS count
         FROM conversations
         GROUP BY pipeline_tag
         ORDER BY count(*) DESC, pipeline_tag ASC`,
      ),
      this.pool.query(
        `WITH message_activity AS (
           SELECT conversation_id,
             max(created_at) FILTER (WHERE direction = 'inbound') AS last_inbound_at,
             max(created_at) FILTER (WHERE direction = 'outbound') AS last_outbound_at,
             count(*) FILTER (WHERE direction = 'inbound')::int AS inbound_messages,
             count(*) FILTER (WHERE direction = 'outbound')::int AS outbound_messages
           FROM messages
           GROUP BY conversation_id
         )
         SELECT
           c.id::text,
           p.channel,
           right(p.external_page_id, 6) AS page_label,
           c.human_status,
           c.pipeline_tag,
           c.consultation_stage,
           c.signal_tag,
           c.summary,
           c.state_version::int,
           c.updated_at,
           activity.last_inbound_at,
           activity.last_outbound_at,
           coalesce(activity.inbound_messages, 0)::int AS inbound_messages,
           coalesce(activity.outbound_messages, 0)::int AS outbound_messages,
           c.runtime_state->>'lastIntent' AS last_intent,
           c.runtime_state->'lastDecision'->'secondaryIntents' AS secondary_intents,
           c.runtime_state->>'activeSkill' AS active_skill,
           c.runtime_state->'lastDecision'->>'selectedRoute' AS selected_route
         FROM conversations c
         JOIN pages p ON p.id = c.page_id
         LEFT JOIN message_activity activity ON activity.conversation_id = c.id
         ORDER BY c.updated_at DESC
         LIMIT $1`,
        [safeLimit],
      ),
    ]);
    const row = summary.rows[0] ?? {};
    return {
      totalSessions: Number(row.total_sessions ?? 0),
      activeSessions24h: Number(row.active_sessions_24h ?? 0),
      botSessions: Number(row.bot_sessions ?? 0),
      humanSessions: Number(row.human_sessions ?? 0),
      pausedSessions: Number(row.paused_sessions ?? 0),
      pendingInboundEvents: Number(row.pending_inbound_events ?? 0),
      ...dateField("oldestPendingInboundAt", row.oldest_pending_inbound_at),
      ...dateField("lastWebhookAt", row.last_webhook_at),
      ...dateField("lastInboundAt", row.last_inbound_at),
      ...dateField("lastOutboundAt", row.last_outbound_at),
      pipelines: pipelineRows.rows.map((item) => ({
        name: String(item.name),
        count: Number(item.count),
      })),
      sessions: sessionRows.rows.map((item) => ({
        id: String(item.id),
        channel: String(item.channel),
        pageLabel: `…${String(item.page_label)}`,
        humanStatus: item.human_status as OperationalSessionRecord["humanStatus"],
        pipeline: String(item.pipeline_tag),
        stage: String(item.consultation_stage),
        stateVersion: Number(item.state_version),
        updatedAt: new Date(item.updated_at).toISOString(),
        inboundMessages: Number(item.inbound_messages),
        outboundMessages: Number(item.outbound_messages),
        ...stringField("signal", item.signal_tag),
        ...stringField("summary", item.summary),
        ...dateField("lastInboundAt", item.last_inbound_at),
        ...dateField("lastOutboundAt", item.last_outbound_at),
        ...stringField("lastIntent", item.last_intent),
        ...(Array.isArray(item.secondary_intents)
          ? { secondaryIntents: item.secondary_intents.map(String) }
          : {}),
        ...stringField("activeSkill", item.active_skill),
        ...stringField("selectedRoute", item.selected_route),
      })),
    };
  }

  async actionRolloutSnapshot(): Promise<ActionRolloutSnapshot> {
    const result = await this.pool.query(
      `SELECT
         count(*)::int AS sample_size,
         count(*) FILTER (WHERE live_variant = 'multi_action')::int AS multi_action_live,
         coalesce(avg(intent_mismatch::int), 0)::float AS intent_mismatch_rate,
         coalesce(avg(pipeline_mismatch::int), 0)::float AS pipeline_mismatch_rate,
         coalesce(avg(handoff_mismatch::int), 0)::float AS handoff_mismatch_rate,
         coalesce(avg(clarification_mismatch::int), 0)::float AS clarification_mismatch_rate,
         coalesce(avg(reply_mismatch::int), 0)::float AS reply_mismatch_rate,
         coalesce(avg((rejected_action_count > 0)::int), 0)::float AS rejected_action_rate,
         coalesce(avg((conflict_count > 0)::int), 0)::float AS conflict_rate,
         coalesce(avg(candidate_has_multiple_actions::int), 0)::float AS multi_action_message_rate
       FROM action_rollout_events
       WHERE created_at >= now() - interval '24 hours'`,
    );
    const row = result.rows[0] ?? {};
    return {
      sampleSize24h: Number(row.sample_size ?? 0),
      multiActionLive24h: Number(row.multi_action_live ?? 0),
      intentMismatchRate: Number(row.intent_mismatch_rate ?? 0),
      pipelineMismatchRate: Number(row.pipeline_mismatch_rate ?? 0),
      handoffMismatchRate: Number(row.handoff_mismatch_rate ?? 0),
      clarificationMismatchRate: Number(row.clarification_mismatch_rate ?? 0),
      replyMismatchRate: Number(row.reply_mismatch_rate ?? 0),
      rejectedActionRate: Number(row.rejected_action_rate ?? 0),
      conflictRate: Number(row.conflict_rate ?? 0),
      multiActionMessageRate: Number(row.multi_action_message_rate ?? 0),
    };
  }

  async followupOperationalSnapshot(now = new Date()): Promise<FollowupOperationalSnapshot> {
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
      ...dateField("oldestDueAt", row.oldest_due_at),
      ...dateField("lastSentAt", row.last_sent_at),
      ...dateField("lastFailureAt", row.last_failure_at),
    };
  }

  async recordActionRollout(
    event: ActionRolloutComparison & {
      traceId?: string;
      sessionId: string;
      tenantId: TenantId;
      pageId: string;
      conversationId: string;
    },
  ): Promise<void> {
    await this.withTenant(event.tenantId, async (client) => {
      await client.query(
        `INSERT INTO action_rollout_events (
           tenant_id, page_id, conversation_id, trace_id, session_key,
           rollout_mode, live_variant, intent_mismatch, pipeline_mismatch,
           handoff_mismatch, clarification_mismatch, reply_mismatch,
           rejected_action_count, conflict_count, candidate_has_multiple_actions,
           candidate_needs_clarification, comparison
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, $9,
           $10, $11, $12, $13, $14, $15, $16, $17::jsonb
         )`,
        [
          event.tenantId,
          event.pageId,
          event.conversationId,
          event.traceId ?? null,
          event.sessionId,
          event.mode,
          event.liveVariant,
          event.intentMismatch,
          event.pipelineMismatch,
          event.handoffMismatch,
          event.clarificationMismatch,
          event.replyMismatch,
          event.rejectedActionCount,
          event.conflictCount,
          event.candidateHasMultipleActions,
          event.candidateNeedsClarification,
          JSON.stringify({ legacy: event.legacy, candidate: event.candidate }),
        ],
      );
    });
  }

  async recordLlmUsage(event: LlmUsageTelemetry): Promise<void> {
    await this.pool.query(
      `INSERT INTO llm_usage_events (
         occurred_at, provider, model, purpose, status, response_id,
         input_tokens, cached_input_tokens, output_tokens,
         reasoning_output_tokens, total_tokens, latency_ms,
         pricing_effective_at, input_rate_usd_per_million,
         cached_input_rate_usd_per_million, output_rate_usd_per_million,
         input_cost_usd, cached_input_cost_usd, output_cost_usd,
         total_cost_usd, error_code
       )
       VALUES (
         $1, $2, $3, $4, $5, $6,
         $7, $8, $9, $10, $11, $12,
         $13, $14, $15, $16, $17, $18, $19, $20, $21
       )
       ON CONFLICT (response_id) WHERE response_id IS NOT NULL DO NOTHING`,
      [
        event.occurredAt,
        event.provider,
        event.model,
        event.purpose,
        event.status,
        event.responseId ?? null,
        event.inputTokens,
        event.cachedInputTokens,
        event.outputTokens,
        event.reasoningOutputTokens,
        event.totalTokens,
        event.latencyMs,
        event.pricingEffectiveAt ?? null,
        event.inputRateUsdPerMillion ?? null,
        event.cachedInputRateUsdPerMillion ?? null,
        event.outputRateUsdPerMillion ?? null,
        event.inputCostUsd ?? null,
        event.cachedInputCostUsd ?? null,
        event.outputCostUsd ?? null,
        event.totalCostUsd ?? null,
        event.errorCode ?? null,
      ],
    );
  }

  async llmUsageSnapshot(): Promise<LlmUsageSnapshot> {
    const [summaryRows, hourlyRows, dailyRows, modelRows, failureRows, latestProviderRows] =
      await Promise.all([
        this.pool.query(
          `WITH windows(name, duration) AS (
             VALUES
               ('hours24', interval '24 hours'),
               ('days7', interval '7 days'),
               ('days30', interval '30 days')
           )
           SELECT w.name,
             count(e.id)::int AS calls,
             count(e.id) FILTER (WHERE e.status = 'success')::int AS successes,
             count(e.id) FILTER (WHERE e.status = 'failure')::int AS failures,
             count(e.id) FILTER (WHERE e.total_cost_usd IS NOT NULL)::int AS priced_calls,
             count(e.id) FILTER (WHERE e.status = 'success' AND e.total_cost_usd IS NULL)::int AS unpriced_calls,
             coalesce(sum(e.input_tokens), 0)::bigint AS input_tokens,
             coalesce(sum(e.cached_input_tokens), 0)::bigint AS cached_input_tokens,
             coalesce(sum(e.output_tokens), 0)::bigint AS output_tokens,
             coalesce(sum(e.reasoning_output_tokens), 0)::bigint AS reasoning_output_tokens,
             coalesce(sum(e.total_tokens), 0)::bigint AS total_tokens,
             coalesce(sum(e.total_cost_usd), 0)::numeric AS cost_usd,
             coalesce(avg(e.latency_ms) FILTER (WHERE e.status = 'success'), 0)::numeric AS average_latency_ms
           FROM windows w
           LEFT JOIN llm_usage_events e ON e.occurred_at >= now() - w.duration
           GROUP BY w.name`,
        ),
        this.pool.query(
          `WITH buckets AS (
             SELECT generate_series(
               date_trunc('hour', now()) - interval '23 hours',
               date_trunc('hour', now()),
               interval '1 hour'
             ) AS bucket
           )
           SELECT b.bucket,
             count(e.id)::int AS calls,
             count(e.id) FILTER (WHERE e.status = 'success')::int AS successes,
             count(e.id) FILTER (WHERE e.status = 'failure')::int AS failures,
             count(e.id) FILTER (WHERE e.total_cost_usd IS NOT NULL)::int AS priced_calls,
             count(e.id) FILTER (WHERE e.status = 'success' AND e.total_cost_usd IS NULL)::int AS unpriced_calls,
             coalesce(sum(e.input_tokens), 0)::bigint AS input_tokens,
             coalesce(sum(e.cached_input_tokens), 0)::bigint AS cached_input_tokens,
             coalesce(sum(e.output_tokens), 0)::bigint AS output_tokens,
             coalesce(sum(e.reasoning_output_tokens), 0)::bigint AS reasoning_output_tokens,
             coalesce(sum(e.total_tokens), 0)::bigint AS total_tokens,
             coalesce(sum(e.total_cost_usd), 0)::numeric AS cost_usd,
             coalesce(avg(e.latency_ms) FILTER (WHERE e.status = 'success'), 0)::numeric AS average_latency_ms
           FROM buckets b
           LEFT JOIN llm_usage_events e
             ON e.occurred_at >= b.bucket
            AND e.occurred_at < b.bucket + interval '1 hour'
           GROUP BY b.bucket
           ORDER BY b.bucket`,
        ),
        this.pool.query(
          `WITH buckets AS (
             SELECT generate_series(
               date_trunc('day', now()) - interval '29 days',
               date_trunc('day', now()),
               interval '1 day'
             ) AS bucket
           )
           SELECT b.bucket,
             count(e.id)::int AS calls,
             count(e.id) FILTER (WHERE e.status = 'success')::int AS successes,
             count(e.id) FILTER (WHERE e.status = 'failure')::int AS failures,
             count(e.id) FILTER (WHERE e.total_cost_usd IS NOT NULL)::int AS priced_calls,
             count(e.id) FILTER (WHERE e.status = 'success' AND e.total_cost_usd IS NULL)::int AS unpriced_calls,
             coalesce(sum(e.input_tokens), 0)::bigint AS input_tokens,
             coalesce(sum(e.cached_input_tokens), 0)::bigint AS cached_input_tokens,
             coalesce(sum(e.output_tokens), 0)::bigint AS output_tokens,
             coalesce(sum(e.reasoning_output_tokens), 0)::bigint AS reasoning_output_tokens,
             coalesce(sum(e.total_tokens), 0)::bigint AS total_tokens,
             coalesce(sum(e.total_cost_usd), 0)::numeric AS cost_usd,
             coalesce(avg(e.latency_ms) FILTER (WHERE e.status = 'success'), 0)::numeric AS average_latency_ms
           FROM buckets b
           LEFT JOIN llm_usage_events e
             ON e.occurred_at >= b.bucket
            AND e.occurred_at < b.bucket + interval '1 day'
           GROUP BY b.bucket
           ORDER BY b.bucket`,
        ),
        this.pool.query(
          `SELECT provider, model,
             count(*)::int AS calls,
             count(*) FILTER (WHERE status = 'success')::int AS successes,
             count(*) FILTER (WHERE status = 'failure')::int AS failures,
             count(*) FILTER (WHERE total_cost_usd IS NOT NULL)::int AS priced_calls,
             count(*) FILTER (WHERE status = 'success' AND total_cost_usd IS NULL)::int AS unpriced_calls,
             coalesce(sum(input_tokens), 0)::bigint AS input_tokens,
             coalesce(sum(cached_input_tokens), 0)::bigint AS cached_input_tokens,
             coalesce(sum(output_tokens), 0)::bigint AS output_tokens,
             coalesce(sum(reasoning_output_tokens), 0)::bigint AS reasoning_output_tokens,
             coalesce(sum(total_tokens), 0)::bigint AS total_tokens,
             coalesce(sum(total_cost_usd), 0)::numeric AS cost_usd,
             coalesce(avg(latency_ms) FILTER (WHERE status = 'success'), 0)::numeric AS average_latency_ms
           FROM llm_usage_events
           WHERE occurred_at >= now() - interval '30 days'
           GROUP BY provider, model
           ORDER BY cost_usd DESC, total_tokens DESC`,
        ),
        this.pool.query(
          `SELECT occurred_at, provider, model, purpose, latency_ms, error_code
           FROM llm_usage_events
           WHERE status = 'failure'
           ORDER BY occurred_at DESC
           LIMIT 20`,
        ),
        this.pool.query(
          `SELECT DISTINCT ON (provider)
             occurred_at, provider, model, purpose, status, latency_ms, error_code
           FROM llm_usage_events
           ORDER BY provider, occurred_at DESC`,
        ),
      ]);

    const summaries = new Map(
      summaryRows.rows.map((row) => [String(row.name), llmUsageTotals(row)]),
    );
    return {
      summaries: {
        hours24: summaries.get("hours24") ?? emptyLlmUsageTotals(),
        days7: summaries.get("days7") ?? emptyLlmUsageTotals(),
        days30: summaries.get("days30") ?? emptyLlmUsageTotals(),
      },
      hourly24: hourlyRows.rows.map((row) => ({
        bucket: new Date(row.bucket).toISOString(),
        ...llmUsageTotals(row),
      })),
      daily30: dailyRows.rows.map((row) => ({
        bucket: new Date(row.bucket).toISOString(),
        ...llmUsageTotals(row),
      })),
      models30: modelRows.rows.map((row) => ({
        provider: String(row.provider),
        model: String(row.model),
        ...llmUsageTotals(row),
      })),
      recentFailures: failureRows.rows.map((row) => ({
        occurredAt: new Date(row.occurred_at).toISOString(),
        provider: String(row.provider),
        model: String(row.model),
        purpose: String(row.purpose),
        latencyMs: Number(row.latency_ms),
        errorCode: String(row.error_code),
      })),
      latestProviders: latestProviderRows.rows.map((row) => ({
        occurredAt: new Date(row.occurred_at).toISOString(),
        provider: String(row.provider),
        model: String(row.model),
        purpose: String(row.purpose),
        status: row.status === "success" ? "success" : "failure",
        latencyMs: Number(row.latency_ms),
        ...(row.error_code ? { errorCode: String(row.error_code) } : {}),
      })),
    };
  }

  async withTenant<T>(tenantId: TenantId, operation: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
      const result = await operation(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async persistInbound(input: {
    tenantId: TenantId;
    pageId: string;
    externalEventId: string;
    payload: unknown;
  }): Promise<boolean> {
    return this.withTenant(input.tenantId, async (client) => {
      const result = await client.query(
        `INSERT INTO inbound_events (tenant_id, page_id, external_event_id, payload)
         VALUES ($1, $2, $3, $4::jsonb)
         ON CONFLICT (page_id, external_event_id) DO NOTHING`,
        [input.tenantId, input.pageId, input.externalEventId, JSON.stringify(input.payload)],
      );
      return result.rowCount === 1;
    });
  }

  async resolvePage(externalPageId: string): Promise<{ tenantId: TenantId; pageId: string } | undefined> {
    const result = await this.pool.query(
      "SELECT tenant_id::text, id::text FROM pages WHERE channel = 'facebook' AND external_page_id = $1 AND active = true",
      [externalPageId],
    );
    if (result.rowCount !== 1) return undefined;
    return { tenantId: result.rows[0].tenant_id as TenantId, pageId: result.rows[0].id as string };
  }

  async registerFacebookPage(input: { tenantId: TenantId; externalPageId: string }): Promise<string> {
    return this.withTenant(input.tenantId, async (client) => {
      const result = await client.query(
        `INSERT INTO pages (tenant_id, channel, external_page_id, active)
         VALUES ($1, 'facebook', $2, true)
         ON CONFLICT (channel, external_page_id)
         DO UPDATE SET active = true
         RETURNING id::text`,
        [input.tenantId, input.externalPageId],
      );
      return String(result.rows[0].id);
    });
  }

  async ensureMessengerConversation(input: {
    tenantId: TenantId;
    pageId: string;
    externalCustomerId: string;
    displayName?: string;
  }): Promise<MessengerConversation> {
    return this.withTenant(input.tenantId, async (client) => {
      const customer = await client.query(
        `INSERT INTO customers (tenant_id, page_id, external_customer_id, display_name)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (page_id, external_customer_id)
         DO UPDATE SET display_name = COALESCE(EXCLUDED.display_name, customers.display_name)
         RETURNING id::text, display_name`,
        [input.tenantId, input.pageId, input.externalCustomerId, input.displayName ?? null],
      );
      const customerId = String(customer.rows[0].id);
      const displayName =
        typeof customer.rows[0].display_name === "string" && customer.rows[0].display_name.trim()
          ? String(customer.rows[0].display_name).trim()
          : undefined;
      const existing = await client.query(
        `SELECT id::text, human_status, runtime_state, state_version::int, pipeline_tag
         FROM conversations
         WHERE tenant_id = $1 AND page_id = $2 AND customer_id = $3
         ORDER BY updated_at DESC
         LIMIT 1`,
        [input.tenantId, input.pageId, customerId],
      );
      if (existing.rowCount === 1) {
        return {
          customerId,
          ...(displayName ? { displayName } : {}),
          conversationId: String(existing.rows[0].id),
          humanStatus: existing.rows[0].human_status as MessengerConversation["humanStatus"],
          runtimeState: existing.rows[0].runtime_state,
          stateVersion: Number(existing.rows[0].state_version),
          pipelineTag: String(existing.rows[0].pipeline_tag),
        };
      }
      const created = await client.query(
        `INSERT INTO conversations (tenant_id, page_id, customer_id)
         VALUES ($1, $2, $3)
         RETURNING id::text, human_status, runtime_state, state_version::int, pipeline_tag`,
        [input.tenantId, input.pageId, customerId],
      );
      return {
        customerId,
        ...(displayName ? { displayName } : {}),
        conversationId: String(created.rows[0].id),
        humanStatus: created.rows[0].human_status as MessengerConversation["humanStatus"],
        runtimeState: created.rows[0].runtime_state,
        stateVersion: Number(created.rows[0].state_version),
        pipelineTag: String(created.rows[0].pipeline_tag),
      };
    });
  }

  async recordMarketingAttribution(input: MarketingAttributionTouchInput): Promise<{
    recorded: boolean;
    sourceCategory: MarketingSourceCategory;
    customerStage: MarketingCustomerStage;
  }> {
    const sourceCategory = marketingSourceCategory(input.referral);
    return this.withTenant(input.tenantId, async (client) => {
      const history = await client.query(
        `SELECT
           EXISTS (
             SELECT 1 FROM messages
             WHERE tenant_id = $1 AND conversation_id = $2 AND direction = 'inbound'
           ) AS had_prior_inbound,
           (
             SELECT max(created_at) FROM messages
             WHERE tenant_id = $1 AND conversation_id = $2 AND direction = 'inbound'
           ) AS last_inbound_at,
           EXISTS (
             SELECT 1 FROM marketing_attribution_touches
             WHERE tenant_id = $1 AND customer_id = $3
           ) AS had_prior_touch,
           (
             SELECT max(occurred_at) FROM marketing_attribution_touches
             WHERE tenant_id = $1 AND customer_id = $3
           ) AS last_touch_at`,
        [input.tenantId, input.conversationId, input.customerId],
      );
      const row = history.rows[0] ?? {};
      const customerStage = marketingCustomerStage({
        hadPriorInbound: row.had_prior_inbound === true,
        hadPriorTouch: row.had_prior_touch === true,
      });
      const activityDates = [row.last_touch_at, row.last_inbound_at]
        .filter(Boolean)
        .map((value) => new Date(value));
      const lastActivityAt = activityDates.length > 0
        ? new Date(Math.max(...activityDates.map((value) => value.getTime())))
        : undefined;
      if (!shouldRecordMarketingTouch({
        occurredAt: input.occurredAt,
        ...(lastActivityAt ? { lastActivityAt } : {}),
        hasReferral: Boolean(input.referral),
      })) {
        return { recorded: false, sourceCategory, customerStage };
      }
      const inserted = await client.query(
        `INSERT INTO marketing_attribution_touches (
           tenant_id, page_id, customer_id, conversation_id, external_event_id,
           source_category, customer_stage, referral_source, referral_type,
           referral_ref, ad_id, ad_title, post_id, ads_context_data,
           raw_referral, occurred_at
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15::jsonb,$16
         )
         ON CONFLICT (page_id, external_event_id) DO NOTHING`,
        [
          input.tenantId,
          input.pageId,
          input.customerId,
          input.conversationId,
          input.externalEventId,
          sourceCategory,
          customerStage,
          input.referral?.source ?? null,
          input.referral?.type ?? null,
          input.referral?.ref ?? null,
          input.referral?.adId ?? null,
          referralAdTitle(input.referral) ?? null,
          referralPostId(input.referral) ?? null,
          JSON.stringify(input.referral?.adsContextData ?? {}),
          JSON.stringify(input.referral?.raw ?? {}),
          input.occurredAt,
        ],
      );
      return { recorded: inserted.rowCount === 1, sourceCategory, customerStage };
    });
  }

  async marketingAttributionSnapshot(input: {
    periodDays?: number;
    pageId?: string;
  } = {}): Promise<MarketingAttributionSnapshot> {
    const periodDays = Math.max(1, Math.min(Math.trunc(input.periodDays ?? 30), 365));
    const pageId = input.pageId ?? null;
    const [segmentRows, adRows, orderRows] = await Promise.all([
      this.pool.query(
        `SELECT source_category, customer_stage,
                count(*)::int AS touches,
                count(DISTINCT customer_id)::int AS unique_customers
         FROM marketing_attribution_touches
         WHERE occurred_at >= now() - ($1::int * interval '1 day')
           AND ($2::uuid IS NULL OR page_id = $2::uuid)
         GROUP BY source_category, customer_stage
         ORDER BY touches DESC`,
        [periodDays, pageId],
      ),
      this.pool.query(
        `SELECT ad_id, max(ad_title) AS ad_title,
                count(*)::int AS touches,
                count(DISTINCT customer_id)::int AS unique_customers,
                count(*) FILTER (WHERE customer_stage = 'new')::int AS new_customers,
                count(*) FILTER (WHERE customer_stage = 'returning')::int AS returning_customers
         FROM marketing_attribution_touches
         WHERE occurred_at >= now() - ($1::int * interval '1 day')
           AND ($2::uuid IS NULL OR page_id = $2::uuid)
           AND ad_id IS NOT NULL
         GROUP BY ad_id
         ORDER BY touches DESC`,
        [periodDays, pageId],
      ),
      this.pool.query(
        `WITH eligible_orders AS (
           SELECT o.id, o.confirmed_at, coalesce(o.total_vnd, 0)::bigint AS total_vnd,
                  c.id AS customer_id
           FROM order_inbox o
           JOIN customers c
             ON o.session_id = c.page_id::text || ':' || c.external_customer_id
           WHERE o.status <> 'cancelled'
             AND o.confirmed_at >= now() - ($1::int * interval '1 day')
             AND ($2::uuid IS NULL OR c.page_id = $2::uuid)
         ), attributed AS (
           SELECT o.id, o.total_vnd, touch.source_category, touch.customer_stage, touch.ad_id
           FROM eligible_orders o
           JOIN LATERAL (
             SELECT source_category, customer_stage, ad_id
             FROM marketing_attribution_touches t
             WHERE t.customer_id = o.customer_id
               AND t.occurred_at <= o.confirmed_at
               AND t.occurred_at >= o.confirmed_at - interval '30 days'
             ORDER BY t.occurred_at DESC
             LIMIT 1
           ) touch ON true
         )
         SELECT source_category, customer_stage, ad_id,
                count(*)::int AS orders,
                coalesce(sum(total_vnd), 0)::bigint AS revenue_vnd
         FROM attributed
         GROUP BY source_category, customer_stage, ad_id`,
        [periodDays, pageId],
      ),
    ]);
    return buildMarketingAttributionSnapshot({
      periodDays,
      ...(input.pageId ? { pageId: input.pageId } : {}),
      segmentRows: segmentRows.rows,
      adRows: adRows.rows,
      orderRows: orderRows.rows,
    });
  }

  async markHumanTakeover(input: {
    tenantId: TenantId;
    pageId: string;
    externalCustomerId: string;
    externalMessageId: string;
    text?: string;
    appId?: string;
    payload: unknown;
  }): Promise<{ conversationId: string; cancelledFollowups: number }> {
    return this.withTenant(input.tenantId, async (client) => {
      const customer = await client.query(
        `INSERT INTO customers (tenant_id, page_id, external_customer_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (page_id, external_customer_id)
         DO UPDATE SET external_customer_id = EXCLUDED.external_customer_id
         RETURNING id::text`,
        [input.tenantId, input.pageId, input.externalCustomerId],
      );
      const customerId = String(customer.rows[0].id);
      const existing = await client.query(
        `SELECT id::text
         FROM conversations
         WHERE tenant_id = $1 AND page_id = $2 AND customer_id = $3
         ORDER BY updated_at DESC
         LIMIT 1
         FOR UPDATE`,
        [input.tenantId, input.pageId, customerId],
      );
      const conversationId =
        existing.rowCount === 1
          ? String(existing.rows[0].id)
          : String(
              (
                await client.query(
                  `INSERT INTO conversations (tenant_id, page_id, customer_id)
                   VALUES ($1, $2, $3)
                   RETURNING id::text`,
                  [input.tenantId, input.pageId, customerId],
                )
              ).rows[0].id,
            );
      await client.query(
        `UPDATE conversations
         SET human_status = 'human',
             consultation_stage = 'H.human',
             pipeline_tag = 'C3.Chờ CSKH',
             summary = 'Nhân viên đã tiếp quản hội thoại từ Pancake/Meta',
             state_version = state_version + 1,
             updated_at = now()
         WHERE id = $1`,
        [conversationId],
      );
      await client.query(
        `INSERT INTO messages (
           tenant_id, page_id, conversation_id, external_message_id,
           direction, kind, text_content, raw_payload
         ) VALUES ($1,$2,$3,$4,'outbound','text',$5,$6::jsonb)
         ON CONFLICT (page_id, external_message_id) DO NOTHING`,
        [
          input.tenantId,
          input.pageId,
          conversationId,
          input.externalMessageId,
          input.text ?? null,
          JSON.stringify({ source: "human_agent", appId: input.appId, event: input.payload }),
        ],
      );
      await client.query(
        `UPDATE followup_cycles
         SET status = 'cancelled', cancel_reason = 'human_takeover', updated_at = now()
         WHERE tenant_id = $1 AND conversation_id = $2 AND status = 'active'`,
        [input.tenantId, conversationId],
      );
      const cancelled = await client.query(
        `UPDATE followup_jobs
         SET status = 'cancelled', cancel_reason = 'human_takeover'
         WHERE tenant_id = $1 AND conversation_id = $2 AND status IN ('scheduled','claimed')`,
        [input.tenantId, conversationId],
      );
      await client.query(
        `UPDATE outbox
         SET status = 'failed',
             payload = jsonb_set(payload, '{cancelReason}', '"human_takeover"'::jsonb, true)
         WHERE tenant_id = $1
           AND topic = 'meta.reply'
           AND payload->>'conversationId' = $2
           AND status IN ('pending','processing')`,
        [input.tenantId, conversationId],
      );
      return { conversationId, cancelledFollowups: cancelled.rowCount ?? 0 };
    });
  }

  async canDispatchConversationOutbound(input: {
    tenantId: TenantId;
    conversationId: string;
    expectedStateVersion: number;
  }): Promise<boolean> {
    return this.withTenant(input.tenantId, async (client) => {
      const result = await client.query(
        `SELECT state_version = $3 AS dispatch_current
         FROM conversations
         WHERE tenant_id = $1 AND id = $2`,
        [input.tenantId, input.conversationId, input.expectedStateVersion],
      );
      return result.rows[0]?.dispatch_current === true;
    });
  }

  async persistConversationMessage(input: {
    tenantId: TenantId;
    pageId: string;
    conversationId: string;
    externalMessageId?: string;
    direction: "inbound" | "outbound";
    kind: "text" | "image" | "postback" | "system";
    text?: string;
    payload?: unknown;
  }): Promise<void> {
    await this.withTenant(input.tenantId, async (client) => {
      await client.query(
        `INSERT INTO messages (
           tenant_id, page_id, conversation_id, external_message_id,
           direction, kind, text_content, raw_payload
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
         ON CONFLICT (page_id, external_message_id) DO NOTHING`,
        [
          input.tenantId,
          input.pageId,
          input.conversationId,
          input.externalMessageId ?? null,
          input.direction,
          input.kind,
          input.text ?? null,
          JSON.stringify(input.payload ?? {}),
        ],
      );
    });
  }

  async hasNewerInboundContent(input: {
    tenantId: TenantId;
    pageId: string;
    externalCustomerId: string;
    currentEventIds: readonly string[];
  }): Promise<boolean> {
    if (input.currentEventIds.length === 0) return false;
    return this.withTenant(input.tenantId, async (client) => {
      const result = await client.query(
        `WITH current_batch AS (
           SELECT max(received_at) AS received_at
           FROM inbound_events
           WHERE tenant_id = $1
             AND page_id = $2
             AND external_event_id = ANY($4::text[])
         )
         SELECT EXISTS (
           SELECT 1
           FROM inbound_events, current_batch
           WHERE inbound_events.tenant_id = $1
             AND inbound_events.page_id = $2
             AND inbound_events.payload->'sender'->>'id' = $3
             AND (inbound_events.payload ? 'message' OR inbound_events.payload ? 'postback')
             AND inbound_events.received_at > current_batch.received_at
         ) AS has_newer`,
        [
          input.tenantId,
          input.pageId,
          input.externalCustomerId,
          [...input.currentEventIds],
        ],
      );
      return result.rows[0]?.has_newer === true;
    });
  }

  async updateConversationRuntime(input: {
    tenantId: TenantId;
    conversationId: string;
    consultationStage: string;
    pipelineTag: string;
    signalTag?: string;
    humanStatus: "bot" | "human" | "paused";
    runtimeState: unknown;
    summary?: string;
    expectedStateVersion: number;
  }): Promise<number> {
    return this.withTenant(input.tenantId, async (client) => {
      const result = await client.query(
        `UPDATE conversations
         SET consultation_stage = $2,
             pipeline_tag = $3,
             signal_tag = $4,
             human_status = $5,
             runtime_state = $6::jsonb,
             summary = $7,
             state_version = state_version + 1,
             updated_at = now()
         WHERE id = $1 AND state_version = $8
         RETURNING state_version::int`,
        [
          input.conversationId,
          input.consultationStage,
          input.pipelineTag,
          input.signalTag ?? null,
          input.humanStatus,
          JSON.stringify(input.runtimeState),
          input.summary ?? null,
          input.expectedStateVersion,
        ],
      );
      if (result.rowCount !== 1) throw conversationStateConflict();
      return Number(result.rows[0].state_version);
    });
  }

  async commitConversationTurn(input: {
    tenantId: TenantId;
    pageId: string;
    conversationId: string;
    expectedStateVersion: number;
    consultationStage: string;
    pipelineTag: string;
    signalTag?: string;
    humanStatus: "bot" | "human" | "paused";
    runtimeState: unknown;
    summary?: string;
    sourceEventIds: readonly string[];
    outbound: {
      idempotencyKey: string;
      recipientId: string;
      texts: readonly string[];
    };
  }): Promise<{ stateVersion: number; outbound: ConversationOutboundPlan }> {
    return this.withTenant(input.tenantId, async (client) => {
      const updated = await client.query(
        `UPDATE conversations
         SET consultation_stage = $2,
             pipeline_tag = $3,
             signal_tag = $4,
             human_status = $5,
             runtime_state = $6::jsonb,
             summary = $7,
             state_version = state_version + 1,
             updated_at = now()
         WHERE id = $1 AND state_version = $8
         RETURNING state_version::int`,
        [
          input.conversationId,
          input.consultationStage,
          input.pipelineTag,
          input.signalTag ?? null,
          input.humanStatus,
          JSON.stringify(input.runtimeState),
          input.summary ?? null,
          input.expectedStateVersion,
        ],
      );
      if (updated.rowCount !== 1) throw conversationStateConflict();
      const payload = {
        pageId: input.pageId,
        conversationId: input.conversationId,
        recipientId: input.outbound.recipientId,
        texts: [...input.outbound.texts],
        sentCount: 0,
        sourceEventIds: [...input.sourceEventIds],
      };
      const inserted = await client.query(
        `INSERT INTO outbox (tenant_id, topic, idempotency_key, payload)
         VALUES ($1, 'meta.reply', $2, $3::jsonb)
         ON CONFLICT (idempotency_key)
         DO UPDATE SET idempotency_key = EXCLUDED.idempotency_key
         RETURNING id::text, idempotency_key, payload, status`,
        [input.tenantId, input.outbound.idempotencyKey, JSON.stringify(payload)],
      );
      await client.query(
        `UPDATE inbound_events
         SET processed_at = COALESCE(processed_at, now())
         WHERE page_id = $1 AND external_event_id = ANY($2::text[])`,
        [input.pageId, [...input.sourceEventIds]],
      );
      return {
        stateVersion: Number(updated.rows[0].state_version),
        outbound: mapOutboundPlan(inserted.rows[0]),
      };
    });
  }

  async findConversationTurnOutbound(input: {
    tenantId: TenantId;
    idempotencyKey: string;
  }): Promise<ConversationOutboundPlan | undefined> {
    return this.withTenant(input.tenantId, async (client) => {
      const result = await client.query(
        `SELECT id::text, idempotency_key, payload, status
         FROM outbox
         WHERE tenant_id = $1 AND idempotency_key = $2 AND topic = 'meta.reply'`,
        [input.tenantId, input.idempotencyKey],
      );
      return result.rowCount === 1 ? mapOutboundPlan(result.rows[0]) : undefined;
    });
  }

  async markConversationTurnOutboundSent(input: {
    tenantId: TenantId;
    outboxId: string;
    sentCount: number;
    messageId: string;
  }): Promise<void> {
    await this.withTenant(input.tenantId, async (client) => {
      await client.query(
        `UPDATE outbox
         SET payload = jsonb_set(
               jsonb_set(payload, '{sentCount}', to_jsonb($2::int), true),
               '{lastMessageId}', to_jsonb($3::text), true
             ),
             status = CASE
               WHEN $2 >= CASE
                 WHEN jsonb_typeof(payload->'texts') = 'array' THEN jsonb_array_length(payload->'texts')
                 ELSE 1
               END THEN 'sent'
               ELSE 'pending'
             END
         WHERE id = $1`,
        [input.outboxId, input.sentCount, input.messageId],
      );
    });
  }

  async markInboundProcessed(input: {
    tenantId: TenantId;
    pageId: string;
    externalEventId: string;
  }): Promise<void> {
    await this.withTenant(input.tenantId, async (client) => {
      await client.query(
        `UPDATE inbound_events
         SET processed_at = COALESCE(processed_at, now())
         WHERE page_id = $1 AND external_event_id = $2`,
        [input.pageId, input.externalEventId],
      );
    });
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

function mapOutboundPlan(row: Record<string, unknown>): ConversationOutboundPlan {
  const payload = (row.payload ?? {}) as Record<string, unknown>;
  const texts = Array.isArray(payload.texts)
    ? payload.texts.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : typeof payload.text === "string" && payload.text.trim()
      ? [payload.text]
      : [];
  return {
    outboxId: String(row.id),
    idempotencyKey: String(row.idempotency_key),
    recipientId: String(payload.recipientId ?? ""),
    texts,
    sentCount: Math.max(0, Math.min(Number(payload.sentCount ?? 0), texts.length)),
    sourceEventIds: Array.isArray(payload.sourceEventIds)
      ? payload.sourceEventIds.filter((item): item is string => typeof item === "string")
      : [],
    status: row.status as ConversationOutboundPlan["status"],
    ...(typeof payload.lastMessageId === "string"
      ? { lastMessageId: payload.lastMessageId }
      : {}),
  };
}

function conversationStateConflict(): Error {
  const error = new Error("conversation_state_version_conflict");
  error.name = "ConversationStateConflictError";
  return error;
}

function stringField<Key extends string>(key: Key, value: unknown): Partial<Record<Key, string>> {
  return typeof value === "string" && value ? ({ [key]: value } as Record<Key, string>) : {};
}

function dateField<Key extends string>(key: Key, value: unknown): Partial<Record<Key, string>> {
  if (!value) return {};
  const date = new Date(value as string | number | Date);
  return Number.isNaN(date.getTime()) ? {} : ({ [key]: date.toISOString() } as Record<Key, string>);
}

function llmUsageTotals(row: Record<string, unknown>): LlmUsageTotals {
  return {
    calls: Number(row.calls ?? 0),
    successes: Number(row.successes ?? 0),
    failures: Number(row.failures ?? 0),
    pricedCalls: Number(row.priced_calls ?? 0),
    unpricedCalls: Number(row.unpriced_calls ?? 0),
    inputTokens: Number(row.input_tokens ?? 0),
    cachedInputTokens: Number(row.cached_input_tokens ?? 0),
    outputTokens: Number(row.output_tokens ?? 0),
    reasoningOutputTokens: Number(row.reasoning_output_tokens ?? 0),
    totalTokens: Number(row.total_tokens ?? 0),
    costUsd: Number(row.cost_usd ?? 0),
    averageLatencyMs: Math.round(Number(row.average_latency_ms ?? 0)),
  };
}

function emptyLlmUsageTotals(): LlmUsageTotals {
  return {
    calls: 0,
    successes: 0,
    failures: 0,
    pricedCalls: 0,
    unpricedCalls: 0,
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
    totalTokens: 0,
    costUsd: 0,
    averageLatencyMs: 0,
  };
}

function buildMarketingAttributionSnapshot(input: {
  periodDays: number;
  pageId?: string;
  segmentRows: Array<Record<string, unknown>>;
  adRows: Array<Record<string, unknown>>;
  orderRows: Array<Record<string, unknown>>;
}): MarketingAttributionSnapshot {
  const segmentOrders = new Map<string, { orders: number; revenueVnd: number }>();
  const adOrders = new Map<string, { orders: number; revenueVnd: number }>();
  let totalOrders = 0;
  let totalRevenueVnd = 0;
  for (const row of input.orderRows) {
    const orders = Number(row.orders ?? 0);
    const revenueVnd = Number(row.revenue_vnd ?? 0);
    const segmentKey = `${String(row.source_category)}:${String(row.customer_stage)}`;
    const currentSegment = segmentOrders.get(segmentKey) ?? { orders: 0, revenueVnd: 0 };
    currentSegment.orders += orders;
    currentSegment.revenueVnd += revenueVnd;
    segmentOrders.set(segmentKey, currentSegment);
    if (typeof row.ad_id === "string" && row.ad_id) {
      const currentAd = adOrders.get(row.ad_id) ?? { orders: 0, revenueVnd: 0 };
      currentAd.orders += orders;
      currentAd.revenueVnd += revenueVnd;
      adOrders.set(row.ad_id, currentAd);
    }
    totalOrders += orders;
    totalRevenueVnd += revenueVnd;
  }
  const segments = input.segmentRows.map((row): MarketingAttributionSegment => {
    const sourceCategory = row.source_category as MarketingSourceCategory;
    const customerStage = row.customer_stage as MarketingCustomerStage;
    const conversion = segmentOrders.get(`${sourceCategory}:${customerStage}`) ?? {
      orders: 0,
      revenueVnd: 0,
    };
    return {
      sourceCategory,
      customerStage,
      touches: Number(row.touches ?? 0),
      uniqueCustomers: Number(row.unique_customers ?? 0),
      ...conversion,
    };
  });
  const ads = input.adRows.map((row): MarketingAttributionAd => {
    const adId = String(row.ad_id);
    const conversion = adOrders.get(adId) ?? { orders: 0, revenueVnd: 0 };
    return {
      adId,
      ...(typeof row.ad_title === "string" && row.ad_title ? { adTitle: row.ad_title } : {}),
      touches: Number(row.touches ?? 0),
      uniqueCustomers: Number(row.unique_customers ?? 0),
      newCustomers: Number(row.new_customers ?? 0),
      returningCustomers: Number(row.returning_customers ?? 0),
      ...conversion,
    };
  });
  return {
    generatedAt: new Date().toISOString(),
    periodDays: input.periodDays,
    ...(input.pageId ? { pageId: input.pageId } : {}),
    totals: {
      touches: segments.reduce((sum, item) => sum + item.touches, 0),
      newCustomers: segments
        .filter((item) => item.customerStage === "new")
        .reduce((sum, item) => sum + item.uniqueCustomers, 0),
      returningCustomers: segments
        .filter((item) => item.customerStage === "returning")
        .reduce((sum, item) => sum + item.uniqueCustomers, 0),
      paidTouches: segments
        .filter((item) => item.sourceCategory === "paid_ad")
        .reduce((sum, item) => sum + item.touches, 0),
      organicTouches: segments
        .filter((item) => item.sourceCategory === "organic")
        .reduce((sum, item) => sum + item.touches, 0),
      referralTouches: segments
        .filter((item) => item.sourceCategory === "referral")
        .reduce((sum, item) => sum + item.touches, 0),
      orders: totalOrders,
      revenueVnd: totalRevenueVnd,
    },
    segments,
    ads,
  };
}

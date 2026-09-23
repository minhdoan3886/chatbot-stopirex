import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { PostgresStore } from "../src/infrastructure/postgres.js";
import { RedisRuntime, type RedisDeadLetter } from "../src/infrastructure/redis.js";
import { tenantId } from "../src/domain/types.js";
import { responseContextRef, responsePayloadRef } from "../src/domain/responseGuard.js";
import { PgFollowupRepository } from "../src/services/followupRepository.js";
import { FollowupDispatcher } from "../src/services/followupDispatcher.js";
import { StructuredLogger } from "../src/services/logger.js";

const enabled = process.env.INTEGRATION === "1";
const integration = enabled ? test : test.skip;

integration("T01 comment commit tách auth inconsistency, stale consistent và valid commit", async () => {
  const store = new PostgresStore(process.env.DATABASE_URL!);
  const scope = {
    tenantId: tenantId("00000000-0000-0000-0000-000000000001"),
    pageId: "00000000-0000-0000-0000-000000000011",
  };
  try {
    const conversation = await store.ensureMessengerConversation({
      ...scope,
      externalCustomerId: `comment-test-${randomUUID()}`,
    });
    await store.pool.query(
      `UPDATE conversations SET updated_at = now() - interval '3 days',
         state_version = 8, summary = 'active inbox draft', pipeline_tag = '3.Đã báo giá',
         consultation_stage = 'S6.price', signal_tag = 'TH.Cần NV', runtime_state = '{"quantity":2}'
       WHERE id = $1`,
      [conversation.conversationId],
    );
    const before = (
      await store.pool.query("SELECT * FROM conversations WHERE id = $1", [conversation.conversationId])
    ).rows[0];
    const eventId = `comment-${randomUUID()}`;
    const texts = ["public", "private"];
    const channel = "comment_public" as const;
    const responseRef = responsePayloadRef(channel, texts);
    const deliveryScope = {
      tenantId: String(scope.tenantId),
      pageId: scope.pageId,
      customerId: conversation.customerId,
      conversationId: conversation.conversationId,
      episodeId: eventId,
    };
    const inboundRevision = 9;
    await store.persistInbound({ ...scope, externalEventId: eventId, payload: { comment_id: eventId } });
    const input = {
      ...scope,
      conversationId: conversation.conversationId,
      expectedStateVersion: 8,
      consultationStage: "S0.new",
      pipelineTag: "0.Chưa tư vấn",
      humanStatus: "paused" as const,
      runtimeState: {},
      summary: "comment summary must not overwrite inbox",
      preserveConversationState: true,
      sourceEventIds: [eventId],
      outbound: {
        idempotencyKey: `${eventId}:reply`,
        recipientId: "test-customer",
        texts,
        channel,
        inboundRevision,
        responseRef,
        deliveryDecision: {
          outcome: "allow" as const,
          responseRef,
          contextRef: responseContextRef({
            scope: deliveryScope,
            inboundRevision,
            stateVersion: 8,
          }),
          channel,
          permission: "standard" as const,
          recipientId: "test-customer",
          sourceEventIds: [eventId],
          partChannels: ["comment_public", "comment_private"] as const,
          scope: deliveryScope,
          inboundRevision,
          requiredReceiptRefs: [],
        },
      },
    };
    const stateAndOutbox = async () => ({
      conversation: (
        await store.pool.query("SELECT * FROM conversations WHERE id = $1", [conversation.conversationId])
      ).rows[0],
      outboxCount: Number(
        (
          await store.pool.query(
            "SELECT count(*)::int AS count FROM outbox WHERE idempotency_key = ANY($1::text[])",
            [[`${eventId}:auth-invalid`, `${eventId}:stale`, `${eventId}:reply`]],
          )
        ).rows[0].count,
      ),
    });

    const invalidAuthorization = {
      ...input,
      outbound: {
        ...input.outbound,
        idempotencyKey: `${eventId}:auth-invalid`,
        inboundRevision: 8,
      },
    };
    await assert.rejects(
      store.commitConversationTurn(invalidAuthorization),
      /outbound_delivery_authorization_mismatch/u,
    );
    assert.deepEqual((await stateAndOutbox()).conversation, before);
    assert.equal((await stateAndOutbox()).outboxCount, 0);

    const staleRevision = 8;
    const staleConsistent = {
      ...input,
      expectedStateVersion: 7,
      outbound: {
        ...input.outbound,
        idempotencyKey: `${eventId}:stale`,
        inboundRevision: staleRevision,
        deliveryDecision: {
          ...input.outbound.deliveryDecision,
          inboundRevision: staleRevision,
          contextRef: responseContextRef({
            scope: deliveryScope,
            inboundRevision: staleRevision,
            stateVersion: 7,
          }),
        },
      },
    };
    await assert.rejects(store.commitConversationTurn(staleConsistent), {
      name: "ConversationStateConflictError",
    });
    assert.deepEqual((await stateAndOutbox()).conversation, before);
    assert.equal((await stateAndOutbox()).outboxCount, 0);

    const result = await store.commitConversationTurn(input);
    assert.equal(result.stateVersion, 8);
    assert.deepEqual(
      (await store.pool.query("SELECT * FROM conversations WHERE id = $1", [conversation.conversationId]))
        .rows[0],
      before,
    );
    assert.equal(result.outbound.texts.length, 2);
    assert.ok(
      (
        await store.pool.query("SELECT processed_at FROM inbound_events WHERE external_event_id = $1", [
          eventId,
        ])
      ).rows[0].processed_at,
    );
    assert.equal((await stateAndOutbox()).outboxCount, 1);
    // Inbox turns must still advance the version and save their state normally.
    const inbox = await store.commitConversationTurn({
      ...input,
      preserveConversationState: false,
      outbound: { ...input.outbound, idempotencyKey: `${eventId}:inbox` },
    });
    assert.equal(inbox.stateVersion, 9);
  } finally {
    await store.close();
  }
});

integration("PostgreSQL migration, Page mapping và inbound idempotency", async () => {
  const store = new PostgresStore(process.env.DATABASE_URL!);
  try {
    assert.equal(await store.ready(), true);
    const scope = await store.resolvePage("sandbox-page");
    assert.equal(scope?.tenantId, "00000000-0000-0000-0000-000000000001");
    const input = {
      tenantId: tenantId("00000000-0000-0000-0000-000000000001"),
      pageId: "00000000-0000-0000-0000-000000000011",
      externalEventId: `integration-${Date.now()}`,
      payload: { message: "hello" },
    };
    assert.equal(await store.persistInbound(input), true);
    assert.equal(await store.persistInbound(input), false);
  } finally {
    await store.close();
  }
});

integration("F01 raw inbound durable trong compose hủy đúng claim và gửi 0 Meta", async () => {
  const store = new PostgresStore(process.env.DATABASE_URL!);
  const scope = {
    tenantId: tenantId("00000000-0000-0000-0000-000000000001"),
    pageId: "00000000-0000-0000-0000-000000000011",
  };
  try {
    const externalCustomerId = `followup-ingress-${randomUUID()}`;
    const conversation = await store.ensureMessengerConversation({ ...scope, externalCustomerId });
    const now = new Date();
    const anchor = new Date(now.getTime() - 4 * 60 * 60 * 1_000);
    await store.pool.query(
      "UPDATE conversations SET state_version = 8, human_status = 'bot', pipeline_tag = '3.Đã báo giá' WHERE id = $1",
      [conversation.conversationId],
    );
    await store.persistConversationMessage({
      ...scope,
      conversationId: conversation.conversationId,
      direction: "inbound",
      kind: "text",
      text: "Giá bao nhiêu?",
      externalMessageId: randomUUID(),
    });
    await store.pool.query("UPDATE messages SET created_at = $2 WHERE conversation_id = $1", [
      conversation.conversationId,
      new Date(anchor.getTime() - 60_000),
    ]);
    const repository = new PgFollowupRepository(store.pool);
    const scheduled = await repository.scheduleCycle({
      ...scope,
      conversationId: conversation.conversationId,
      anchorOutboundMessageId: randomUUID(),
      anchorSentAt: anchor,
      stateVersion: 8,
    });
    const claimed = (await repository.claimDue(now, 100)).find(
      (candidate) => candidate.cycleId === scheduled.cycleId,
    );
    assert.ok(claimed);
    const sends: string[] = [];
    const dispatcher = new FollowupDispatcher({
      repository,
      messenger: {
        async sendTyping() {
          return { ok: true as const, value: undefined };
        },
        async sendText(input) {
          sends.push(input.text);
          return { ok: true as const, value: { messageId: `fake-${randomUUID()}` } };
        },
        async sendImage() {
          return { ok: true as const, value: { messageId: `fake-image-${randomUUID()}` } };
        },
      },
      logger: new StructuredLogger(() => undefined),
      mode: "enabled",
      outboundWindowHours: 24,
      maxAttempts: 3,
      composer: {
        async composeFollowup(input) {
          await store.persistInbound({
            ...scope,
            externalEventId: randomUUID(),
            payload: { sender: { id: externalCustomerId }, message: { text: "Thôi không mua nữa" } },
          });
          return {
            text: input.baseReply,
            status: "fallback" as const,
            latencyMs: 0,
            model: "none",
            provider: "openai" as const,
          };
        },
      },
      now: () => now,
    });

    assert.equal(await dispatcher.process(claimed), "cancelled");
    assert.deepEqual(sends, []);
    const row = (
      await store.pool.query("SELECT status, cancel_reason FROM followup_jobs WHERE id = $1", [claimed.id])
    ).rows[0];
    assert.equal(row.status, "cancelled");
    assert.equal(row.cancel_reason, "eligibility_changed_before_send");
  } finally {
    await store.close();
  }
});

integration("Redis readiness, lease và queue", async () => {
  const redis = new RedisRuntime(process.env.REDIS_URL!);
  try {
    assert.equal(await redis.ready(), true);
    const key = `integration:${Date.now()}`;
    assert.equal(await redis.acquireLease(key, "worker-1", 5_000), true);
    assert.equal(await redis.acquireLease(key, "worker-2", 5_000), false);
    assert.ok(await redis.enqueue("integration", { key }));

    const deadLetterTopic = `integration-dead-letter-${Date.now()}`;
    const sourceGroup = "source-group";
    await redis.ensureConsumerGroup(deadLetterTopic, sourceGroup);
    await redis.enqueue(deadLetterTopic, { key, attempt: 3 });
    const [source] = await redis.readGroup<{ key: string; attempt: number }>({
      topic: deadLetterTopic,
      group: sourceGroup,
      consumer: "source-consumer",
      count: 1,
      blockMs: 0,
    });
    assert.ok(source);
    await redis.deadLetter({
      topic: deadLetterTopic,
      group: sourceGroup,
      message: source,
      reason: "integration_failure",
    });
    assert.equal((await redis.queueSnapshot(deadLetterTopic, sourceGroup)).pending, 0);

    const dlqTopic = `${deadLetterTopic}:dead-letter`;
    const dlqGroup = "dlq-group";
    await redis.ensureConsumerGroup(dlqTopic, dlqGroup);
    const [deadLetter] = await redis.readGroup<RedisDeadLetter<{ key: string; attempt: number }>>({
      topic: dlqTopic,
      group: dlqGroup,
      consumer: "dlq-consumer",
      count: 1,
      blockMs: 0,
    });
    assert.ok(deadLetter);
    assert.equal(deadLetter.payload.reason, "integration_failure");
    assert.equal(deadLetter.payload.payload.attempt, 3);
  } finally {
    await redis.close();
  }
});

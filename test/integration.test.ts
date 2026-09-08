import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { PostgresStore } from "../src/infrastructure/postgres.js";
import { RedisRuntime, type RedisDeadLetter } from "../src/infrastructure/redis.js";
import { tenantId } from "../src/domain/types.js";

const enabled = process.env.INTEGRATION === "1";
const integration = enabled ? test : test.skip;

integration("comment outbox preserves the whole Messenger episode and rejects stale commits", async () => {
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
        texts: ["public", "private"],
      },
    };
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
    await assert.rejects(store.commitConversationTurn({ ...input, expectedStateVersion: 7 }), {
      name: "ConversationStateConflictError",
    });
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

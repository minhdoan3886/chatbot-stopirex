import assert from "node:assert/strict";
import test from "node:test";
import { PostgresStore } from "../src/infrastructure/postgres.js";
import { RedisRuntime, type RedisDeadLetter } from "../src/infrastructure/redis.js";
import { tenantId } from "../src/domain/types.js";

const enabled = process.env.INTEGRATION === "1";
const integration = enabled ? test : test.skip;

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

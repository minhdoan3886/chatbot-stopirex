import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createClient } from "redis";
import { RedisRuntime, type RedisDeadLetter } from "../src/infrastructure/redis.js";

const integration = process.env.INTEGRATION === "1" ? test : test.skip;

integration(
  "queue recovery preserves corrupt events, retries once and reclaims abandoned pending",
  async () => {
    const url = process.env.REDIS_URL!;
    const runtime = new RedisRuntime(url);
    const raw = createClient({ url });
    const topic = `recovery-${randomUUID()}`;
    const group = "recovery-test";
    const stream = `queue:${topic}`;
    try {
      await raw.connect();
      await runtime.ensureConsumerGroup(topic, group);
      const invalidId = await raw.xAdd(stream, "*", { payload: "{broken-json" });
      const missingId = await raw.xAdd(stream, "*", { unexpected: "original-fields" });
      const goodId = await runtime.enqueue(topic, { eventId: "customer-message", attempt: 0 });
      const messages = await runtime.readGroup({ topic, group, consumer: "dead-worker" });
      assert.deepEqual(
        messages.map((item) => item.id),
        [goodId],
      );
      const letters = (await raw.xRange(`${stream}:dead-letter`, "-", "+")).map(
        (entry) => JSON.parse(entry.message.payload!) as RedisDeadLetter<{ fields: Record<string, string> }>,
      );
      assert.deepEqual(
        letters.map((entry) => entry.originalId),
        [invalidId, missingId],
      );
      assert.equal(letters[0]?.payload.fields.payload, "{broken-json");
      assert.equal(letters[1]?.reason, "missing_queue_payload");
      assert.equal((await runtime.queueSnapshot(topic, group)).pending, 1);

      const fresh = await runtime.reclaimPending({ topic, group, consumer: "new-worker", minIdleMs: 60_000 });
      assert.equal(fresh.messages.length, 0);
      // Model a worker that died two minutes ago, without a wall-clock sleep.
      await raw.xClaim(stream, group, "dead-worker", 0, goodId, { IDLE: 120_000 });
      const recovered = await runtime.reclaimPending({
        topic,
        group,
        consumer: "new-worker",
        minIdleMs: 60_000,
      });
      assert.deepEqual(
        recovered.messages.map((item) => item.id),
        [goodId],
      );

      const retry = {
        topic,
        group,
        originalId: goodId,
        payload: { eventId: "customer-message", attempt: 1 },
      };
      const results = await Promise.all([runtime.retryPending(retry), runtime.retryPending(retry)]);
      assert.equal(results.filter(Boolean).length, 1);
      assert.equal((await runtime.queueSnapshot(topic, group)).pending, 0);
      const [retried] = await runtime.readGroup<{ attempt: number }>({
        topic,
        group,
        consumer: "new-worker",
      });
      assert.ok(retried);
      assert.equal(retried.payload.attempt, 1);
      const dlqInput = { topic, group, message: retried, reason: "retry_exhausted" };
      const dlqResults = await Promise.all([runtime.deadLetter(dlqInput), runtime.deadLetter(dlqInput)]);
      assert.equal(dlqResults.filter(Boolean).length, 1);
      assert.equal(await raw.xLen(`${stream}:dead-letter`), 3);
      const completed = await runtime.queueSnapshot(topic, group);
      assert.equal(completed.pending, 0);
      assert.equal(completed.deadLetter, 3);
    } finally {
      await raw.del([stream, `${stream}:dead-letter`]);
      await Promise.all([runtime.close(), raw.quit()]);
    }
  },
);

integration("failed dead-letter write keeps the source pending for recovery", async () => {
  const url = process.env.REDIS_URL!;
  const runtime = new RedisRuntime(url);
  const raw = createClient({ url });
  const topic = `recovery-write-failure-${randomUUID()}`;
  const group = "recovery-test";
  const stream = `queue:${topic}`;
  try {
    await raw.connect();
    await runtime.ensureConsumerGroup(topic, group);
    const id = await raw.xAdd(stream, "*", { payload: "not-json" });
    await raw.set(`${stream}:dead-letter`, "wrong-type");
    await assert.rejects(runtime.readGroup({ topic, group, consumer: "worker" }), /WRONGTYPE/);
    const corrupted = await runtime.queueSnapshot(topic, group);
    assert.equal(corrupted.pending, 1);
    assert.equal(corrupted.deadLetter, -1);
    await raw.del(`${stream}:dead-letter`);
    await runtime.readGroup({ topic, group, consumer: "worker", id: "0" });
    assert.equal((await runtime.queueSnapshot(topic, group)).pending, 0);
    const [letter] = await raw.xRange(`${stream}:dead-letter`, "-", "+");
    assert.equal(JSON.parse(letter!.message.payload!).originalId, id);
  } finally {
    await raw.del([stream, `${stream}:dead-letter`]);
    await Promise.all([runtime.close(), raw.quit()]);
  }
});

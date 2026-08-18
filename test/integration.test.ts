import assert from "node:assert/strict";
import test from "node:test";
import { PostgresStore } from "../src/infrastructure/postgres.js";
import { RedisRuntime } from "../src/infrastructure/redis.js";
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
  } finally {
    await redis.close();
  }
});

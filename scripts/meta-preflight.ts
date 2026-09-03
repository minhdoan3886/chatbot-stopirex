import { loadEnv } from "../src/config/env.js";
import { PostgresStore } from "../src/infrastructure/postgres.js";
import { RedisRuntime } from "../src/infrastructure/redis.js";

const env = loadEnv();
const checks: Array<{ name: string; ok: boolean; detail: string }> = [];

checks.push({
  name: "webhook_verify_token",
  ok: Boolean(env.metaVerifyToken),
  detail: env.metaVerifyToken ? "đã cấu hình" : "thiếu META_VERIFY_TOKEN",
});
checks.push({
  name: "webhook_signature",
  ok: Boolean(env.metaAppSecret),
  detail: env.metaAppSecret ? "đã cấu hình" : "thiếu META_APP_SECRET",
});
checks.push({
  name: "page_access_token",
  ok: Boolean(env.metaPageAccessToken),
  detail: env.metaPageAccessToken ? "đã cấu hình" : "thiếu META_PAGE_ACCESS_TOKEN",
});

let postgres: PostgresStore | undefined;
let redis: RedisRuntime | undefined;
try {
  if (env.databaseUrl) {
    postgres = new PostgresStore(env.databaseUrl);
    const ready = await postgres.ready();
    checks.push({
      name: "database",
      ok: ready,
      detail: ready ? "sẵn sàng" : "không kết nối được",
    });
    if (ready && env.metaPageId) {
      const mapping = await postgres.resolvePage(env.metaPageId);
      checks.push({
        name: "page_mapping",
        ok: Boolean(mapping),
        detail: mapping ? "đã đăng ký" : "chưa chạy npm run meta:register-page",
      });
    }
  } else {
    checks.push({ name: "database", ok: false, detail: "thiếu DATABASE_URL" });
  }

  if (env.redisUrl) {
    redis = new RedisRuntime(env.redisUrl);
    const ready = await redis.ready();
    checks.push({
      name: "redis",
      ok: ready,
      detail: ready ? "sẵn sàng" : "không kết nối được",
    });
  } else {
    checks.push({ name: "redis", ok: false, detail: "thiếu REDIS_URL" });
  }

  if (env.metaVerifyToken) {
    try {
      const url = new URL("http://127.0.0.1:8080/webhooks/meta");
      url.searchParams.set("hub.mode", "subscribe");
      url.searchParams.set("hub.verify_token", env.metaVerifyToken);
      url.searchParams.set("hub.challenge", "stopirex-preflight");
      const response = await fetch(url, { signal: AbortSignal.timeout(3_000) });
      checks.push({
        name: "local_webhook_get",
        ok: response.ok && (await response.text()) === "stopirex-preflight",
        detail: response.ok ? "callback GET hoạt động" : `HTTP ${response.status}`,
      });
    } catch {
      checks.push({
        name: "local_webhook_get",
        ok: false,
        detail: "API localhost chưa chạy hoặc chưa nạp .env",
      });
    }
  }
} finally {
  await Promise.allSettled([postgres?.close(), redis?.close()]);
}

console.table(checks);
console.log(
  JSON.stringify({
    event: "meta_preflight_complete",
    activePage: env.metaActivePage,
    activePageId: env.metaPageId ?? null,
    readyToVerifyWebhook: checks
      .filter((check) =>
        ["webhook_verify_token", "database", "redis", "page_mapping", "local_webhook_get"].includes(
          check.name,
        ),
      )
      .every((check) => check.ok),
    readyToReceiveSignedEvents: checks.every((check) => check.ok),
    liveSendEnabled: env.metaLiveSendEnabled,
  }),
);

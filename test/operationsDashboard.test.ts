import assert from "node:assert/strict";
import test from "node:test";

import { loadEnv } from "../src/config/env.js";
import type { LlmUsageSnapshot, PostgresOperationalSnapshot } from "../src/infrastructure/postgres.js";
import {
  diagnoseSession,
  OperationsDashboardService,
  type WorkerHeartbeat,
} from "../src/services/operationsDashboard.js";

const now = new Date("2026-08-12T03:00:00.000Z");

const databaseSnapshot: PostgresOperationalSnapshot = {
  totalSessions: 2,
  activeSessions24h: 2,
  botSessions: 1,
  humanSessions: 1,
  pausedSessions: 0,
  pendingInboundEvents: 1,
  oldestPendingInboundAt: "2026-08-12T02:58:00.000Z",
  lastWebhookAt: "2026-08-12T02:59:10.000Z",
  lastInboundAt: "2026-08-12T02:59:00.000Z",
  lastOutboundAt: "2026-08-12T02:57:00.000Z",
  pipelines: [{ name: "2.Đang tư vấn", count: 2 }],
  sessions: [
    {
      id: "conversation-1",
      channel: "facebook",
      pageLabel: "…123456",
      humanStatus: "bot",
      pipeline: "2.Đang tư vấn",
      stage: "S5.guidance",
      stateVersion: 3,
      updatedAt: "2026-08-12T02:59:00.000Z",
      lastInboundAt: "2026-08-12T02:59:00.000Z",
      lastOutboundAt: "2026-08-12T02:57:00.000Z",
      inboundMessages: 3,
      outboundMessages: 2,
    },
    {
      id: "conversation-2",
      channel: "facebook",
      pageLabel: "…123456",
      humanStatus: "human",
      pipeline: "C3.Chờ CSKH",
      stage: "C3.human",
      stateVersion: 2,
      updatedAt: "2026-08-12T02:58:00.000Z",
      inboundMessages: 1,
      outboundMessages: 1,
    },
  ],
};

const usageTotals = {
  calls: 2,
  successes: 1,
  failures: 1,
  pricedCalls: 1,
  unpricedCalls: 1,
  inputTokens: 100,
  cachedInputTokens: 20,
  outputTokens: 40,
  reasoningOutputTokens: 10,
  totalTokens: 140,
  costUsd: 0.0001025,
  averageLatencyMs: 820,
};

const llmUsageSnapshot: LlmUsageSnapshot = {
  summaries: {
    hours24: { ...usageTotals },
    days7: { ...usageTotals },
    days30: { ...usageTotals },
  },
  hourly24: [{ bucket: "2026-08-12T02:00:00.000Z", ...usageTotals }],
  daily30: [{ bucket: "2026-08-12T00:00:00.000Z", ...usageTotals }],
  models30: [{ provider: "openai", model: "gpt-5-mini", ...usageTotals }],
  recentFailures: [
    {
      occurredAt: "2026-08-12T02:59:00.000Z",
      provider: "openai",
      model: "gpt-5-mini",
      purpose: "interpret",
      latencyMs: 30_000,
      errorCode: "llm_timeout",
    },
  ],
  latestProviders: [
    {
      occurredAt: "2026-08-12T02:59:40.000Z",
      provider: "openai",
      model: "gpt-5-mini",
      purpose: "reply",
      status: "success",
      latencyMs: 820,
    },
  ],
};

test("dashboard tổng hợp healthcheck, queue, worker và phiên cần chú ý", async () => {
  const heartbeat: WorkerHeartbeat = {
    at: "2026-08-12T02:59:50.000Z",
    consumer: "worker-test",
    activePage: "test",
    liveSendEnabled: true,
    llmEnabled: true,
    llmProvider: "openai",
    llmModel: "gpt-test",
    llmLastRequestAt: "2026-08-12T02:59:45.000Z",
    llmLastSuccessAt: "2026-08-12T02:59:46.000Z",
    llmLastLatencyMs: 820,
    llmProviders: {
      openai: {
        enabled: true,
        model: "gpt-test",
        lastRequestAt: "2026-08-12T02:59:45.000Z",
        lastSuccessAt: "2026-08-12T02:59:46.000Z",
        lastLatencyMs: 820,
      },
    },
  };
  const service = new OperationsDashboardService({
    env: loadEnv({
      NODE_ENV: "development",
      DATABASE_URL: "postgresql://user:secret@127.0.0.1:15432/stopirex",
      REDIS_URL: "redis://127.0.0.1:6379",
      META_ACTIVE_PAGE: "test",
      META_TEST_PAGE_ID: "page-test",
      META_TEST_PAGE_ACCESS_TOKEN: "token-test",
      META_LIVE_SEND_ENABLED: "true",
    }),
    database: {
      async ready() {
        return true;
      },
      async operationalSnapshot() {
        return databaseSnapshot;
      },
      async llmUsageSnapshot() {
        return llmUsageSnapshot;
      },
    },
    redis: {
      async ready() {
        return true;
      },
      async getJson<T>() {
        return heartbeat as T;
      },
      async queueSnapshot() {
        return { streamLength: 12, pending: 1 };
      },
    },
    llm: { enabled: true, provider: "openai", model: "gpt-test" },
    now: () => now,
    async gatewayProbe() {
      return { ok: true, latencyMs: 7 };
    },
  });

  const result = await service.snapshot();
  assert.equal(result.metrics.activeSessions24h, 2);
  assert.equal(result.metrics.sessionsNeedAttention, 2);
  assert.equal(result.metrics.pendingInboundEvents, 1);
  assert.equal(result.connections.find((item) => item.id === "meta-worker")?.status, "healthy");
  assert.equal(result.connections.find((item) => item.id === "openai-llm")?.status, "healthy");
  assert.equal(result.connections.find((item) => item.id === "openai-llm")?.name, "OpenAI Responses API");
  assert.equal(result.connections.find((item) => item.id === "codex-cli")?.status, "disabled");
  assert.equal(result.connections.find((item) => item.id === "hybrid-router")?.status, "healthy");
  assert.equal(
    result.connections.find((item) => item.id === "postgres")?.endpoint,
    "postgresql://127.0.0.1:15432/stopirex",
  );
  assert.equal(
    result.connections.some((item) => item.endpoint.includes("secret")),
    false,
  );
  assert.equal(result.connections.find((item) => item.id === "meta-public-webhook")?.status, "down");
  assert.equal(result.sessions[0]?.health, "critical");
  assert.ok(result.alerts.some((alert) => /inbound chưa xử lý/u.test(alert.title)));
  assert.equal(result.llmUsage.summaries.hours24.totalTokens, 140);
  assert.equal(result.llmUsage.summaries.hours24.costUsd, 0.0001025);
  assert.equal(result.llmUsage.usdToVndRate, 26_000);
  assert.match(result.llmUsage.methodology, /Responses API/u);
});

test("dashboard không báo healthy khi kết nối xanh nhưng còn inbound chưa xử lý", async () => {
  const service = new OperationsDashboardService({
    env: loadEnv({
      NODE_ENV: "development",
      META_PUBLIC_WEBHOOK_URL: "https://bot.example.com/webhooks/meta",
      META_ACTIVE_PAGE: "test",
      META_TEST_PAGE_ID: "page-test",
      META_TEST_PAGE_ACCESS_TOKEN: "token-test",
      META_LIVE_SEND_ENABLED: "true",
    }),
    database: {
      async ready() {
        return true;
      },
      async operationalSnapshot() {
        return { ...databaseSnapshot, sessions: [] };
      },
    },
    redis: {
      async ready() {
        return true;
      },
      async getJson<T>() {
        return {
          at: "2026-08-12T02:59:50.000Z",
          consumer: "worker-test",
          activePage: "test",
          liveSendEnabled: true,
          llmEnabled: false,
          llmModel: "gpt-test",
        } as T;
      },
      async queueSnapshot() {
        return { streamLength: 12, pending: 0 };
      },
    },
    llm: { enabled: false, model: "gpt-test" },
    now: () => now,
    async gatewayProbe() {
      return { ok: true, latencyMs: 2 };
    },
    async publicWebhookProbe() {
      return { ok: true, latencyMs: 25 };
    },
  });

  const result = await service.snapshot();
  assert.equal(
    result.connections
      .filter((item) => item.status !== "disabled")
      .every((item) => item.status === "healthy"),
    true,
  );
  assert.equal(result.overall, "degraded");
});

test("public webhook chỉ xanh khi URL HTTPS cấu hình và probe thành công", async () => {
  const service = new OperationsDashboardService({
    env: loadEnv({
      NODE_ENV: "development",
      META_PUBLIC_WEBHOOK_URL: "https://bot.example.com/webhooks/meta",
    }),
    llm: { enabled: false, model: "gpt-test" },
    now: () => now,
    async gatewayProbe() {
      return { ok: true, latencyMs: 2 };
    },
    async publicWebhookProbe(url) {
      assert.equal(url, "https://bot.example.com/webhooks/meta");
      return { ok: true, latencyMs: 25 };
    },
  });

  const result = await service.snapshot();
  assert.equal(result.connections.find((item) => item.id === "meta-public-webhook")?.status, "healthy");
});

test("public webhook báo down khi callback sống nhưng Page chưa subscribe app", async () => {
  const service = new OperationsDashboardService({
    env: loadEnv({
      NODE_ENV: "development",
      REDIS_URL: "redis://127.0.0.1:6379",
      META_PUBLIC_WEBHOOK_URL: "https://bot.example.com/webhooks/meta",
    }),
    redis: {
      async ready() {
        return true;
      },
      async getJson<T>(key: string) {
        if (key === "health:meta:page-subscription") {
          return {
            status: "down",
            detail: "Trang chưa subscribe app; Page token thiếu quyền pages_manage_metadata",
          } as T;
        }
        return undefined;
      },
      async queueSnapshot() {
        return { streamLength: 0, pending: 0 };
      },
    },
    llm: { enabled: false, model: "gpt-test" },
    now: () => now,
    async gatewayProbe() {
      return { ok: true, latencyMs: 2 };
    },
    async publicWebhookProbe() {
      return { ok: true, latencyMs: 25 };
    },
  });

  const result = await service.snapshot();
  const webhook = result.connections.find((item) => item.id === "meta-public-webhook");
  assert.equal(webhook?.status, "down");
  assert.match(webhook?.detail ?? "", /pages_manage_metadata/u);
});

test("public webhook báo degraded khi token không đọc lại được subscription", async () => {
  const service = new OperationsDashboardService({
    env: loadEnv({
      NODE_ENV: "development",
      REDIS_URL: "redis://127.0.0.1:6379",
      META_PUBLIC_WEBHOOK_URL: "https://bot.example.com/webhooks/meta",
    }),
    redis: {
      async ready() {
        return true;
      },
      async getJson<T>(key: string) {
        if (key === "health:meta:page-subscription") {
          return {
            status: "degraded",
            detail: "Meta đã nhận subscribe nhưng token không đọc lại được",
          } as T;
        }
        return undefined;
      },
      async queueSnapshot() {
        return { streamLength: 0, pending: 0 };
      },
    },
    llm: { enabled: false, model: "gpt-test" },
    now: () => now,
    async gatewayProbe() {
      return { ok: true, latencyMs: 2 };
    },
    async publicWebhookProbe() {
      return { ok: true, latencyMs: 25 };
    },
  });

  const result = await service.snapshot();
  const webhook = result.connections.find((item) => item.id === "meta-public-webhook");
  assert.equal(webhook?.status, "degraded");
  assert.match(webhook?.detail ?? "", /không đọc lại được/u);
});

test("dashboard ưu tiên Public Webhook URL mới đã lưu trong Redis", async () => {
  const service = new OperationsDashboardService({
    env: loadEnv({
      NODE_ENV: "development",
      REDIS_URL: "redis://127.0.0.1:6379",
      META_PUBLIC_WEBHOOK_URL: "https://old.example.com/webhooks/meta",
    }),
    redis: {
      async ready() {
        return true;
      },
      async getJson<T>(key: string) {
        if (key === "health:meta:public-webhook") {
          return { url: "https://new.trycloudflare.com/webhooks/meta" } as T;
        }
        return undefined;
      },
      async queueSnapshot() {
        return { streamLength: 0, pending: 0 };
      },
    },
    llm: { enabled: false, model: "gpt-test" },
    now: () => now,
    async gatewayProbe() {
      return { ok: true, latencyMs: 2 };
    },
    async publicWebhookProbe(url) {
      assert.equal(url, "https://new.trycloudflare.com/webhooks/meta");
      return { ok: true, latencyMs: 20 };
    },
  });

  const result = await service.snapshot();
  assert.equal(
    result.connections.find((item) => item.id === "meta-public-webhook")?.endpoint,
    "https://new.trycloudflare.com/webhooks/meta",
  );
});

test("phiên bot có inbound mới hơn outbound quá 30 giây được đánh dấu lỗi", () => {
  const result = diagnoseSession(databaseSnapshot.sessions[0]!, now);
  assert.equal(result.health, "critical");
  assert.match(result.issue ?? "", /chưa được bot phản hồi/u);
});

test("phiên lịch sử không còn nằm trong queue được hạ khỏi cảnh báo critical", () => {
  const result = diagnoseSession(
    {
      ...databaseSnapshot.sessions[0]!,
      lastInboundAt: "2026-08-10T02:59:00.000Z",
      lastOutboundAt: "2026-08-10T02:57:00.000Z",
    },
    now,
  );
  assert.equal(result.health, "attention");
  assert.match(result.issue ?? "", /Phiên lịch sử/u);
});

test("worker heartbeat cũ được báo mất kết nối", async () => {
  const service = new OperationsDashboardService({
    env: loadEnv({ NODE_ENV: "development" }),
    redis: {
      async ready() {
        return true;
      },
      async getJson<T>() {
        return {
          at: "2026-08-12T02:55:00.000Z",
          consumer: "worker-old",
          activePage: "test",
          liveSendEnabled: true,
          llmEnabled: true,
          llmModel: "gpt-test",
        } as T;
      },
      async queueSnapshot() {
        return { streamLength: 0, pending: 0 };
      },
    },
    llm: { enabled: true, model: "gpt-test" },
    now: () => now,
    async gatewayProbe() {
      return { ok: false, latencyMs: 2_500 };
    },
  });

  const result = await service.snapshot();
  assert.equal(result.connections.find((item) => item.id === "meta-worker")?.status, "down");
  assert.equal(result.overall, "down");
});

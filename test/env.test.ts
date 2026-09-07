import assert from "node:assert/strict";
import test from "node:test";

import { loadEnv } from "../src/config/env.js";

test("development cho phép chạy khi chưa có credential bên ngoài", () => {
  assert.deepEqual(loadEnv({ NODE_ENV: "development", PORT: "8080" }), {
    nodeEnv: "development",
    port: 8080,
    metaGatewayEnabled: false,
    metaGatewayPort: 8081,
    metaActivePage: "primary",
    metaGraphVersion: "v25.0",
    metaLiveSendEnabled: false,
    metaStaffName: "Mai Lan",
    metaOpeningVariant: "AUTO.dynamic",
    metaWorkerConsumer: "worker-1",
    metaDebounceMs: 6000,
    dataRetentionDays: 90,
    outboundWindowHours: 24,
    conversationContextTtlHours: 24,
    metaInboundMaxAttempts: 3,
    metaConversationLeaseTtlMs: 120000,
    metaConversationLeaseRenewMs: 30000,
    followupMode: "shadow",
    followupWorkerConsumer: "followup-worker-1",
    followupPollMs: 1000,
    followupBatchSize: 50,
    followupMaxAttempts: 3,
    followupClaimTtlMs: 60000,
    followupPrimaryApproved: false,
    llmUsdToVndRate: 26000,
    multiActionRolloutMode: "shadow",
    multiActionCanaryPercent: 0,
    multiActionPrimaryApproved: false,
  });
});

test("follow-up enabled trên Page primary cần phê duyệt riêng", () => {
  assert.throws(
    () => loadEnv({ NODE_ENV: "development", FOLLOWUP_MODE: "enabled" }),
    /FOLLOWUP_PRIMARY_APPROVED=true/u,
  );
  assert.equal(
    loadEnv({
      NODE_ENV: "development",
      FOLLOWUP_MODE: "enabled",
      FOLLOWUP_PRIMARY_APPROVED: "true",
    }).followupMode,
    "enabled",
  );
});

test("Page primary bị chặn canary nếu chưa có phê duyệt riêng", () => {
  assert.throws(
    () =>
      loadEnv({
        NODE_ENV: "development",
        META_ACTIVE_PAGE: "primary",
        MULTI_ACTION_ROLLOUT_MODE: "canary",
        MULTI_ACTION_CANARY_PERCENT: "10",
      }),
    /MULTI_ACTION_PRIMARY_APPROVED=true/u,
  );

  const approved = loadEnv({
    NODE_ENV: "development",
    META_ACTIVE_PAGE: "primary",
    MULTI_ACTION_ROLLOUT_MODE: "canary",
    MULTI_ACTION_CANARY_PERCENT: "10",
    MULTI_ACTION_PRIMARY_APPROVED: "true",
  });
  assert.equal(approved.multiActionCanaryPercent, 10);
});

test("tỷ giá hiển thị chi phí LLM phải là số dương", () => {
  assert.equal(loadEnv({ NODE_ENV: "development", LLM_USD_TO_VND_RATE: "25500" }).llmUsdToVndRate, 25_500);
  assert.throws(
    () => loadEnv({ NODE_ENV: "development", LLM_USD_TO_VND_RATE: "0" }),
    /LLM_USD_TO_VND_RATE phải là số dương/u,
  );
});

test("TTL hội thoại độc lập với cửa sổ gửi Meta và lease phải được gia hạn trước khi hết hạn", () => {
  const env = loadEnv({
    NODE_ENV: "development",
    OUTBOUND_WINDOW_HOURS: "24",
    CONVERSATION_CONTEXT_TTL_HOURS: "12",
    META_INBOUND_MAX_ATTEMPTS: "5",
    META_CONVERSATION_LEASE_TTL_MS: "180000",
    META_CONVERSATION_LEASE_RENEW_MS: "45000",
  });
  assert.equal(env.outboundWindowHours, 24);
  assert.equal(env.conversationContextTtlHours, 12);
  assert.equal(env.metaInboundMaxAttempts, 5);
  assert.equal(env.metaConversationLeaseTtlMs, 180000);
  assert.equal(env.metaConversationLeaseRenewMs, 45000);

  assert.throws(
    () =>
      loadEnv({
        NODE_ENV: "development",
        META_CONVERSATION_LEASE_TTL_MS: "60000",
        META_CONVERSATION_LEASE_RENEW_MS: "60000",
      }),
    /phải nhỏ hơn/u,
  );
});

test("test profile dùng Page ID và token riêng, không ghi đè primary", () => {
  const env = loadEnv({
    NODE_ENV: "development",
    META_ACTIVE_PAGE: "test",
    META_PAGE_ID: "primary-page",
    META_PAGE_ACCESS_TOKEN: "primary-token",
    META_TEST_PAGE_ID: "test-page",
    META_TEST_PAGE_ACCESS_TOKEN: "test-token",
  });
  assert.equal(env.metaActivePage, "test");
  assert.equal(env.metaPageId, "test-page");
  assert.equal(env.metaPageAccessToken, "test-token");
});

test("production từ chối khởi động khi thiếu credential bắt buộc", () => {
  assert.throws(
    () => loadEnv({ NODE_ENV: "production" }),
    /META_VERIFY_TOKEN, META_APP_ID, META_APP_SECRET, DATABASE_URL, REDIS_URL, ADMIN_API_KEY, ENCRYPTION_KEY/,
  );
});

test("production chấp nhận bộ cấu hình đầy đủ", () => {
  const env = loadEnv({
    NODE_ENV: "production",
    PORT: "8080",
    META_VERIFY_TOKEN: "verify-token",
    META_APP_ID: "app-id",
    META_APP_SECRET: "app-secret",
    DATABASE_URL: "postgresql://localhost/stopirex",
    REDIS_URL: "redis://localhost:6379",
    ADMIN_API_KEY: "admin-key",
    ENCRYPTION_KEY: "encryption-key",
  });

  assert.equal(env.nodeEnv, "production");
  assert.equal(env.metaAppId, "app-id");
  assert.equal(env.metaAppSecret, "app-secret");
});

test("public webhook bắt buộc dùng HTTPS", () => {
  assert.throws(
    () =>
      loadEnv({
        NODE_ENV: "development",
        META_PUBLIC_WEBHOOK_URL: "http://localhost:8081/webhooks/meta",
      }),
    /phải dùng HTTPS/u,
  );
});

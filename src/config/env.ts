export type AppEnv = {
  nodeEnv: "development" | "test" | "production";
  port: number;
  metaGatewayEnabled: boolean;
  metaGatewayPort: number;
  metaVerifyToken?: string;
  metaAppId?: string;
  metaAppSecret?: string;
  metaPageAccessToken?: string;
  metaPageId?: string;
  metaPublicWebhookUrl?: string;
  metaOAuthRedirectUri?: string;
  metaActivePage: "primary" | "test";
  metaGraphVersion: string;
  metaLiveSendEnabled: boolean;
  metaStaffName: string;
  metaOpeningVariant: string;
  metaWorkerConsumer: string;
  metaDebounceMs: number;
  databaseUrl?: string;
  redisUrl?: string;
  adminApiKey?: string;
  encryptionKey?: string;
  dataRetentionDays: number;
  outboundWindowHours: number;
  followupMode: "disabled" | "shadow" | "enabled";
  followupWorkerConsumer: string;
  followupPollMs: number;
  followupBatchSize: number;
  followupMaxAttempts: number;
  followupClaimTtlMs: number;
  followupPrimaryApproved: boolean;
  llmUsdToVndRate: number;
  multiActionRolloutMode: "shadow" | "canary" | "enabled";
  multiActionCanaryPercent: number;
  multiActionPrimaryApproved: boolean;
};

export function loadEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  const nodeEnv = source.NODE_ENV ?? "development";
  if (!["development", "test", "production"].includes(nodeEnv)) {
    throw new Error(`NODE_ENV không hợp lệ: ${nodeEnv}`);
  }

  const port = Number(source.PORT ?? 8080);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT phải là số nguyên từ 1 đến 65535");
  }

  const dataRetentionDays = positiveInteger(source.DATA_RETENTION_DAYS ?? "90", "DATA_RETENTION_DAYS");
  const outboundWindowHours = positiveInteger(source.OUTBOUND_WINDOW_HOURS ?? "24", "OUTBOUND_WINDOW_HOURS");
  const metaActivePage = source.META_ACTIVE_PAGE ?? "primary";
  if (metaActivePage !== "primary" && metaActivePage !== "test") {
    throw new Error("META_ACTIVE_PAGE phải là primary hoặc test");
  }
  const multiActionRolloutMode = source.MULTI_ACTION_ROLLOUT_MODE ?? "shadow";
  if (!(["shadow", "canary", "enabled"] as const).includes(multiActionRolloutMode as never)) {
    throw new Error("MULTI_ACTION_ROLLOUT_MODE phải là shadow, canary hoặc enabled");
  }
  const multiActionCanaryPercent = percentage(
    source.MULTI_ACTION_CANARY_PERCENT ?? "0",
    "MULTI_ACTION_CANARY_PERCENT",
  );
  const followupMode = source.FOLLOWUP_MODE ?? "shadow";
  if (!(["disabled", "shadow", "enabled"] as const).includes(followupMode as never)) {
    throw new Error("FOLLOWUP_MODE phải là disabled, shadow hoặc enabled");
  }
  const env: AppEnv = {
    nodeEnv: nodeEnv as AppEnv["nodeEnv"],
    port,
    metaGatewayEnabled: source.META_GATEWAY_ENABLED === "true",
    metaGatewayPort: positivePort(source.META_GATEWAY_PORT ?? "8081", "META_GATEWAY_PORT"),
    metaActivePage,
    metaGraphVersion: source.META_GRAPH_VERSION ?? "v25.0",
    metaLiveSendEnabled: source.META_LIVE_SEND_ENABLED === "true",
    metaStaffName: source.META_STAFF_NAME?.trim() || "Mai Lan",
    metaOpeningVariant: source.META_OPENING_VARIANT?.trim() || "AUTO.dynamic",
    metaWorkerConsumer: source.META_WORKER_CONSUMER?.trim() || "worker-1",
    metaDebounceMs: positiveInteger(source.META_DEBOUNCE_MS ?? "6000", "META_DEBOUNCE_MS"),
    dataRetentionDays,
    outboundWindowHours,
    followupMode: followupMode as AppEnv["followupMode"],
    followupWorkerConsumer: source.FOLLOWUP_WORKER_CONSUMER?.trim() || "followup-worker-1",
    followupPollMs: positiveInteger(source.FOLLOWUP_POLL_MS ?? "1000", "FOLLOWUP_POLL_MS"),
    followupBatchSize: positiveInteger(source.FOLLOWUP_BATCH_SIZE ?? "50", "FOLLOWUP_BATCH_SIZE"),
    followupMaxAttempts: positiveInteger(source.FOLLOWUP_MAX_ATTEMPTS ?? "3", "FOLLOWUP_MAX_ATTEMPTS"),
    followupClaimTtlMs: positiveInteger(source.FOLLOWUP_CLAIM_TTL_MS ?? "60000", "FOLLOWUP_CLAIM_TTL_MS"),
    followupPrimaryApproved: source.FOLLOWUP_PRIMARY_APPROVED === "true",
    llmUsdToVndRate: positiveNumber(source.LLM_USD_TO_VND_RATE ?? "26000", "LLM_USD_TO_VND_RATE"),
    multiActionRolloutMode: multiActionRolloutMode as AppEnv["multiActionRolloutMode"],
    multiActionCanaryPercent,
    multiActionPrimaryApproved: source.MULTI_ACTION_PRIMARY_APPROVED === "true",
  };
  if (source.META_VERIFY_TOKEN) env.metaVerifyToken = source.META_VERIFY_TOKEN;
  if (source.META_APP_ID) env.metaAppId = source.META_APP_ID.trim();
  if (source.META_APP_SECRET) env.metaAppSecret = source.META_APP_SECRET;
  const activePageAccessToken =
    metaActivePage === "test" ? source.META_TEST_PAGE_ACCESS_TOKEN : source.META_PAGE_ACCESS_TOKEN;
  const activePageId = metaActivePage === "test" ? source.META_TEST_PAGE_ID : source.META_PAGE_ID;
  if (activePageAccessToken) env.metaPageAccessToken = activePageAccessToken;
  if (activePageId) env.metaPageId = activePageId;
  if (source.META_PUBLIC_WEBHOOK_URL) {
    const publicWebhookUrl = new URL(source.META_PUBLIC_WEBHOOK_URL);
    if (publicWebhookUrl.protocol !== "https:") {
      throw new Error("META_PUBLIC_WEBHOOK_URL phải dùng HTTPS");
    }
    env.metaPublicWebhookUrl = publicWebhookUrl.toString();
  }
  const oauthRedirectValue =
    source.META_OAUTH_REDIRECT_URI ||
    (env.metaPublicWebhookUrl
      ? new URL("/api/meta/oauth/callback", env.metaPublicWebhookUrl).toString()
      : undefined);
  if (oauthRedirectValue) {
    const oauthRedirectUri = new URL(oauthRedirectValue);
    if (oauthRedirectUri.protocol !== "https:") {
      throw new Error("META_OAUTH_REDIRECT_URI phải dùng HTTPS");
    }
    env.metaOAuthRedirectUri = oauthRedirectUri.toString();
  }
  if (source.DATABASE_URL) env.databaseUrl = source.DATABASE_URL;
  if (source.REDIS_URL) env.redisUrl = source.REDIS_URL;
  if (source.ADMIN_API_KEY) env.adminApiKey = source.ADMIN_API_KEY;
  if (source.ENCRYPTION_KEY) env.encryptionKey = source.ENCRYPTION_KEY;

  if (env.nodeEnv === "production") {
    const missing = [
      ["META_VERIFY_TOKEN", env.metaVerifyToken],
      ["META_APP_ID", env.metaAppId],
      ["META_APP_SECRET", env.metaAppSecret],
      ["DATABASE_URL", env.databaseUrl],
      ["REDIS_URL", env.redisUrl],
      ["ADMIN_API_KEY", env.adminApiKey],
      ["ENCRYPTION_KEY", env.encryptionKey],
      ...(env.metaLiveSendEnabled
        ? [
            ["META_PAGE_ACCESS_TOKEN", env.metaPageAccessToken],
            ["META_PAGE_ID", env.metaPageId],
          ]
        : []),
    ]
      .filter(([, value]) => !value)
      .map(([name]) => name);

    if (missing.length > 0) {
      throw new Error(`Thiếu biến môi trường production: ${missing.join(", ")}`);
    }
  }

  if (
    env.metaActivePage === "primary" &&
    env.multiActionRolloutMode !== "shadow" &&
    !env.multiActionPrimaryApproved
  ) {
    throw new Error("Page primary chỉ được chạy shadow cho tới khi MULTI_ACTION_PRIMARY_APPROVED=true");
  }

  if (env.metaActivePage === "primary" && env.followupMode === "enabled" && !env.followupPrimaryApproved) {
    throw new Error(
      "Follow-up trên Page primary chỉ được chạy shadow cho tới khi FOLLOWUP_PRIMARY_APPROVED=true",
    );
  }

  return env;
}

function positiveInteger(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${name} phải là số nguyên dương`);
  return parsed;
}

function positivePort(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error(`${name} phải là số nguyên từ 1 đến 65535`);
  }
  return parsed;
}

function positiveNumber(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} phải là số dương`);
  }
  return parsed;
}

function percentage(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
    throw new Error(`${name} phải nằm trong khoảng 0 đến 100`);
  }
  return parsed;
}

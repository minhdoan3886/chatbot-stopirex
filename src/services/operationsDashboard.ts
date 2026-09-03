import { Resolver } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import type { AppEnv } from "../config/env.js";
import type {
  LlmUsageSnapshot,
  ActionRolloutSnapshot,
  OperationalSessionRecord,
  PostgresOperationalSnapshot,
  FollowupOperationalSnapshot,
} from "../infrastructure/postgres.js";
import type { RedisQueueSnapshot } from "../infrastructure/redis.js";
import type { LlmProvider, LlmProviderHealthSnapshot } from "./codexLlm.js";

export type OperationalStatus = "healthy" | "degraded" | "down" | "disabled";

export type OperationalConnection = {
  id: string;
  name: string;
  endpoint: string;
  status: OperationalStatus;
  detail: string;
  latencyMs?: number;
  lastSeenAt?: string;
};

export type OperationalSession = OperationalSessionRecord & {
  health: "healthy" | "attention" | "critical";
  issue?: string;
};

export type WorkerHeartbeat = {
  at: string;
  consumer: string;
  activePage: "primary" | "test";
  liveSendEnabled: boolean;
  llmEnabled: boolean;
  llmProvider?: "openai" | "codex" | "hybrid";
  llmModel: string;
  llmLastRequestAt?: string;
  llmLastSuccessAt?: string;
  llmLastFailureAt?: string;
  llmLastLatencyMs?: number;
  llmLastError?: string;
  llmProviders?: Partial<Record<LlmProvider, LlmProviderHealthSnapshot>>;
  multiActionRolloutMode?: "shadow" | "canary" | "enabled";
  multiActionCanaryPercent?: number;
};

export type FollowupWorkerHeartbeat = FollowupOperationalSnapshot & {
  at: string;
  consumer: string;
  activePage: "primary" | "test";
  mode: "disabled" | "shadow" | "enabled";
};

type PublicWebhookRuntime = {
  url: string;
  at?: string;
};

type PageSubscriptionRuntime = {
  status?: "healthy" | "degraded" | "down";
  at?: string;
  detail?: string;
};

export type OperationsSnapshot = {
  generatedAt: string;
  overall: OperationalStatus;
  metrics: {
    connectionsHealthy: number;
    connectionsTotal: number;
    activeSessions24h: number;
    sessionsNeedAttention: number;
    pendingInboundEvents: number;
    queuePending: number;
    followupDue: number;
    followupFailed: number;
  };
  connections: OperationalConnection[];
  alerts: Array<{ severity: "warning" | "critical"; title: string; detail: string }>;
  sessionSummary: Omit<PostgresOperationalSnapshot, "sessions">;
  sessions: OperationalSession[];
  llmUsage: LlmUsageSnapshot & {
    usdToVndRate: number;
    pricingSource: string;
    pricingEffectiveAt: string;
    methodology: string;
  };
  actionRollout: ActionRolloutSnapshot & {
    mode: "shadow" | "canary" | "enabled";
    canaryPercent: number;
    gateStatus: "collecting" | "pass" | "blocked";
    gateReasons: string[];
  };
  followup: FollowupOperationalSnapshot & {
    mode: "disabled" | "shadow" | "enabled";
  };
};

type OperationsDatabase = {
  ready(): Promise<boolean>;
  operationalSnapshot(limit?: number): Promise<PostgresOperationalSnapshot>;
  llmUsageSnapshot?(): Promise<LlmUsageSnapshot>;
  actionRolloutSnapshot?(): Promise<ActionRolloutSnapshot>;
  followupOperationalSnapshot?(now?: Date): Promise<FollowupOperationalSnapshot>;
};

type OperationsRedis = {
  ready(): Promise<boolean>;
  getJson<T>(key: string): Promise<T | undefined>;
  queueSnapshot(topic: string, group: string): Promise<RedisQueueSnapshot>;
};

type DashboardDependencies = {
  env: AppEnv;
  database?: OperationsDatabase;
  redis?: OperationsRedis;
  llm: {
    enabled: boolean;
    model: string;
    provider?: "openai" | "codex" | "hybrid";
  };
  now?: () => Date;
  gatewayProbe?: (port: number) => Promise<{ ok: boolean; latencyMs: number }>;
  publicWebhookProbe?: (url: string) => Promise<{ ok: boolean; latencyMs: number }>;
};

const emptyDatabaseSnapshot: PostgresOperationalSnapshot = {
  totalSessions: 0,
  activeSessions24h: 0,
  botSessions: 0,
  humanSessions: 0,
  pausedSessions: 0,
  pendingInboundEvents: 0,
  pipelines: [],
  sessions: [],
};

const emptyLlmTotals = {
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

const emptyLlmUsageSnapshot: LlmUsageSnapshot = {
  summaries: {
    hours24: { ...emptyLlmTotals },
    days7: { ...emptyLlmTotals },
    days30: { ...emptyLlmTotals },
  },
  hourly24: [],
  daily30: [],
  models30: [],
  recentFailures: [],
  latestProviders: [],
};

const emptyActionRolloutSnapshot: ActionRolloutSnapshot = {
  sampleSize24h: 0,
  multiActionLive24h: 0,
  intentMismatchRate: 0,
  pipelineMismatchRate: 0,
  handoffMismatchRate: 0,
  clarificationMismatchRate: 0,
  replyMismatchRate: 0,
  rejectedActionRate: 0,
  conflictRate: 0,
  multiActionMessageRate: 0,
};

const emptyFollowupSnapshot: FollowupOperationalSnapshot = {
  scheduled: 0,
  claimed: 0,
  sent: 0,
  cancelled: 0,
  failed: 0,
  shadowed: 0,
  deliveryUnknown: 0,
  due: 0,
};

export class OperationsDashboardService {
  constructor(private readonly dependencies: DashboardDependencies) {}

  async snapshot(): Promise<OperationsSnapshot> {
    const now = (this.dependencies.now ?? (() => new Date()))();
    const databaseStartedAt = performance.now();
    const databaseReady = this.dependencies.database ? await this.dependencies.database.ready() : false;
    const databaseLatencyMs = Math.round(performance.now() - databaseStartedAt);
    const redisStartedAt = performance.now();
    const redisReady = this.dependencies.redis ? await this.dependencies.redis.ready() : false;
    const redisLatencyMs = Math.round(performance.now() - redisStartedAt);

    const [
      databaseSnapshot,
      llmUsage,
      actionRollout,
      followup,
      queue,
      worker,
      followupWorker,
      gateway,
      publicWebhookRuntime,
      pageSubscriptionRuntime,
    ] = await Promise.all([
      databaseReady && this.dependencies.database
        ? this.dependencies.database.operationalSnapshot(500)
        : Promise.resolve(emptyDatabaseSnapshot),
      databaseReady && this.dependencies.database?.llmUsageSnapshot
        ? this.dependencies.database.llmUsageSnapshot()
        : Promise.resolve(emptyLlmUsageSnapshot),
      databaseReady && this.dependencies.database?.actionRolloutSnapshot
        ? this.dependencies.database.actionRolloutSnapshot()
        : Promise.resolve(emptyActionRolloutSnapshot),
      databaseReady && this.dependencies.database?.followupOperationalSnapshot
        ? this.dependencies.database.followupOperationalSnapshot(now)
        : Promise.resolve(emptyFollowupSnapshot),
      redisReady && this.dependencies.redis
        ? this.dependencies.redis.queueSnapshot("inbound", "meta-inbound-v1")
        : Promise.resolve({ streamLength: 0, pending: 0 }),
      redisReady && this.dependencies.redis
        ? this.dependencies.redis.getJson<WorkerHeartbeat>("health:worker:meta")
        : Promise.resolve(undefined),
      redisReady && this.dependencies.redis
        ? this.dependencies.redis.getJson<FollowupWorkerHeartbeat>("health:worker:followup")
        : Promise.resolve(undefined),
      (this.dependencies.gatewayProbe ?? probeMetaGateway)(this.dependencies.env.metaGatewayPort),
      redisReady && this.dependencies.redis
        ? this.dependencies.redis.getJson<PublicWebhookRuntime>("health:meta:public-webhook")
        : Promise.resolve(undefined),
      redisReady && this.dependencies.redis
        ? this.dependencies.redis.getJson<PageSubscriptionRuntime>("health:meta:page-subscription")
        : Promise.resolve(undefined),
    ]);
    const publicWebhookUrl =
      publicWebhookRuntime &&
      typeof publicWebhookRuntime.url === "string" &&
      publicWebhookRuntime.url.startsWith("https://")
        ? publicWebhookRuntime.url
        : this.dependencies.env.metaPublicWebhookUrl;
    const publicWebhook = publicWebhookUrl
      ? await (this.dependencies.publicWebhookProbe ?? probePublicWebhook)(publicWebhookUrl)
      : { ok: false, latencyMs: 0 };

    const sessions = databaseSnapshot.sessions.map((session) => diagnoseSession(session, now));
    const rolloutMode = worker?.multiActionRolloutMode ?? this.dependencies.env.multiActionRolloutMode;
    const canaryPercent = worker?.multiActionCanaryPercent ?? this.dependencies.env.multiActionCanaryPercent;
    const rolloutGate = evaluateActionRolloutGate(actionRollout);
    const workerAgeMs = worker ? now.getTime() - new Date(worker.at).getTime() : Number.POSITIVE_INFINITY;
    // Dashboard và worker là hai process riêng. Cho phép heartbeat đi trước thời
    // điểm snapshot vài giây để tránh báo đỏ giả do lệch đồng hồ/lịch refresh.
    const workerHealthy = workerAgeMs >= -5_000 && workerAgeMs <= 45_000;
    const followupWorkerAgeMs = followupWorker
      ? now.getTime() - new Date(followupWorker.at).getTime()
      : Number.POSITIVE_INFINITY;
    const followupWorkerHealthy = followupWorkerAgeMs >= -5_000 && followupWorkerAgeMs <= 45_000;
    const lastMetaActivity = latestDate(databaseSnapshot.lastInboundAt, databaseSnapshot.lastOutboundAt);
    const metaConfigured = Boolean(
      this.dependencies.env.metaPageId && this.dependencies.env.metaPageAccessToken,
    );
    const llmEnabled = worker?.llmEnabled ?? this.dependencies.llm.enabled;
    const llmProvider = worker?.llmProvider ?? this.dependencies.llm.provider ?? "codex";
    const llmModel = worker?.llmModel ?? this.dependencies.llm.model;
    const llmFailureActive = isLaterThan(worker?.llmLastFailureAt, worker?.llmLastSuccessAt);
    let llmStatus: OperationalStatus = !llmEnabled
      ? "disabled"
      : !workerHealthy
        ? "degraded"
        : llmFailureActive
          ? worker?.llmLastError === "llm_auth_error"
            ? "down"
            : "degraded"
          : llmProvider === "openai" && !worker?.llmLastSuccessAt
            ? "degraded"
            : "healthy";
    const openAiHealth = providerHealthWithPersistedActivity(
      worker?.llmProviders?.openai,
      llmUsage.latestProviders.find((item) => item.provider === "openai"),
    );
    const codexHealth = providerHealthWithPersistedActivity(
      worker?.llmProviders?.codex,
      llmUsage.latestProviders.find((item) => item.provider === "codex"),
    );
    const openAiConnection = providerConnection({
      provider: "openai",
      configured: llmEnabled && (llmProvider === "openai" || llmProvider === "hybrid"),
      workerHealthy,
      ...(openAiHealth ? { health: openAiHealth } : {}),
      fallbackModel: llmProvider === "openai" ? llmModel : llmModel.split("→")[0]?.trim() || "OpenAI",
    });
    const codexConnection = providerConnection({
      provider: "codex",
      configured: llmEnabled && (llmProvider === "codex" || llmProvider === "hybrid"),
      workerHealthy,
      ...(codexHealth ? { health: codexHealth } : {}),
      fallbackModel: llmProvider === "codex" ? llmModel : llmModel.split("→")[1]?.trim() || "Codex CLI",
    });
    if (llmProvider === "hybrid" && llmEnabled && workerHealthy && !llmFailureActive) {
      llmStatus = hybridRouterStatus(openAiConnection, codexConnection);
    }

    const connections: OperationalConnection[] = [
      {
        id: "api",
        name: "API & Dashboard",
        endpoint: `http://127.0.0.1:${this.dependencies.env.port}`,
        status: "healthy",
        detail: `${this.dependencies.env.nodeEnv} · endpoint đang phản hồi`,
      },
      {
        id: "meta-gateway",
        name: "Meta Webhook Gateway",
        endpoint: `http://127.0.0.1:${this.dependencies.env.metaGatewayPort}`,
        status: gateway.ok ? "healthy" : "down",
        detail: gateway.ok
          ? `Gateway → API hoạt động · ${gateway.latencyMs} ms`
          : "Không kết nối được gateway hoặc upstream API",
        latencyMs: gateway.latencyMs,
      },
      {
        id: "meta-public-webhook",
        name: "Meta Public Webhook",
        endpoint: publicWebhookUrl ?? "https://chưa-cấu-hình/webhooks/meta",
        status: publicWebhookUrl
          ? !publicWebhook.ok || pageSubscriptionRuntime?.status === "down"
            ? "down"
            : pageSubscriptionRuntime?.status === "degraded"
              ? "degraded"
              : "healthy"
          : this.dependencies.env.metaLiveSendEnabled
            ? "down"
            : "degraded",
        detail: publicWebhookUrl
          ? publicWebhook.ok
            ? pageSubscriptionRuntime?.status === "down"
              ? (pageSubscriptionRuntime.detail ?? "Page chưa subscribe app nhận messages")
              : pageSubscriptionRuntime?.status === "degraded"
                ? (pageSubscriptionRuntime.detail ?? "Không đọc lại được trạng thái subscribed_apps")
                : `HTTPS công khai → gateway → API hoạt động · ${publicWebhook.latencyMs} ms${pageSubscriptionRuntime?.status === "healthy" ? " · Page đã subscribe app" : ""}`
            : "URL công khai không gọi được gateway/API"
          : "Chưa cấu hình URL HTTPS công khai; Meta chưa thể kết nối webhook",
        ...(databaseSnapshot.lastWebhookAt ? { lastSeenAt: databaseSnapshot.lastWebhookAt } : {}),
      },
      {
        id: "postgres",
        name: "PostgreSQL",
        endpoint: safeEndpoint(this.dependencies.env.databaseUrl, "postgresql"),
        status: databaseReady ? "healthy" : "down",
        detail: databaseReady
          ? `${databaseSnapshot.totalSessions} phiên đã lưu`
          : this.dependencies.database
            ? "Không truy vấn được database"
            : "Chưa cấu hình DATABASE_URL",
        latencyMs: databaseLatencyMs,
      },
      {
        id: "redis",
        name: "Redis Queue",
        endpoint: safeEndpoint(this.dependencies.env.redisUrl, "redis"),
        status: redisReady ? (queue.pending > 0 ? "degraded" : "healthy") : "down",
        detail: redisReady
          ? `${queue.pending} job đang chờ xử lý · ${queue.streamLength} event trong stream`
          : this.dependencies.redis
            ? "Không ping được Redis"
            : "Chưa cấu hình REDIS_URL",
        latencyMs: redisLatencyMs,
      },
      {
        id: "meta-worker",
        name: "Meta Worker",
        endpoint: `consumer://${worker?.consumer ?? this.dependencies.env.metaWorkerConsumer}`,
        status: workerHealthy ? "healthy" : "down",
        detail: workerHealthy
          ? `${worker?.activePage ?? this.dependencies.env.metaActivePage} page · gửi thật ${worker?.liveSendEnabled ? "bật" : "tắt"}`
          : worker
            ? `Heartbeat đã cũ ${formatDuration(workerAgeMs)}`
            : "Không tìm thấy heartbeat worker",
        ...(worker ? { lastSeenAt: worker.at } : {}),
      },
      {
        id: "followup-worker",
        name: "Follow-up Worker 3/6/9h",
        endpoint: `consumer://${followupWorker?.consumer ?? this.dependencies.env.followupWorkerConsumer}`,
        status:
          this.dependencies.env.followupMode === "disabled"
            ? "disabled"
            : followupWorkerHealthy
              ? followup.failed > 0 || followup.deliveryUnknown > 0 || followup.due > 0
                ? "degraded"
                : "healthy"
              : "down",
        detail:
          this.dependencies.env.followupMode === "disabled"
            ? "Automation 3/6/9 giờ đang tắt"
            : followupWorkerHealthy
              ? `${followupWorker?.mode ?? this.dependencies.env.followupMode} · ${followup.scheduled} chờ · ${followup.due} đến hạn · ${followup.sent} đã gửi · ${followup.failed} lỗi · ${followup.deliveryUnknown} chưa rõ kết quả`
              : followupWorker
                ? `Heartbeat đã cũ ${formatDuration(followupWorkerAgeMs)}`
                : "Không tìm thấy heartbeat follow-up worker",
        ...(followupWorker ? { lastSeenAt: followupWorker.at } : {}),
      },
      {
        id: "meta-graph",
        name: "Meta Graph API",
        endpoint: `https://graph.facebook.com/${this.dependencies.env.metaGraphVersion}`,
        status: metaConfigured
          ? this.dependencies.env.metaLiveSendEnabled
            ? lastMetaActivity
              ? "healthy"
              : "degraded"
            : "degraded"
          : "down",
        detail: metaConfigured
          ? `${this.dependencies.env.metaActivePage} page · cấu hình đủ · live send ${this.dependencies.env.metaLiveSendEnabled ? "bật" : "tắt"}`
          : "Thiếu Page ID hoặc Page Access Token",
        ...(lastMetaActivity ? { lastSeenAt: lastMetaActivity } : {}),
      },
      openAiConnection,
      codexConnection,
      {
        id: "hybrid-router",
        name: llmProvider === "hybrid" ? "Hybrid Router · OpenAI → Codex" : "LLM Router",
        endpoint: `${llmProvider}://${llmModel}`,
        status: llmStatus,
        detail:
          llmProvider === "hybrid" && llmEnabled && workerHealthy && !llmFailureActive
            ? hybridRouterDetail(openAiConnection, codexConnection)
            : llmConnectionDetail({
                enabled: llmEnabled,
                provider: llmProvider,
                workerHealthy,
                ...(worker?.llmLastSuccessAt ? { lastSuccessAt: worker.llmLastSuccessAt } : {}),
                ...(worker?.llmLastLatencyMs !== undefined ? { lastLatencyMs: worker.llmLastLatencyMs } : {}),
                ...(llmFailureActive && worker?.llmLastError ? { lastError: worker.llmLastError } : {}),
              }),
        ...(worker ? { lastSeenAt: worker.at } : {}),
      },
      ...disabledAdapters(),
    ];
    const alerts = buildAlerts({
      connections,
      databaseSnapshot,
      sessions,
      queue,
      now,
    });
    if (followup.deliveryUnknown > 0) {
      alerts.push({
        severity: "critical",
        title: `${followup.deliveryUnknown} follow-up chưa rõ đã gửi hay chưa`,
        detail: "Không tự retry để tránh gửi trùng; cần kiểm tra thủ công trên Meta.",
      });
    }
    if (followup.failed > 0) {
      alerts.push({
        severity: "warning",
        title: `${followup.failed} follow-up gửi thất bại`,
        detail: "Kiểm tra Page token, quyền gửi và mã lỗi gần nhất.",
      });
    }
    if (followup.due > 0 && followup.oldestDueAt) {
      alerts.push({
        severity: "warning",
        title: `${followup.due} follow-up đã đến hạn`,
        detail: `Job cũ nhất đang trễ ${formatDuration(now.getTime() - new Date(followup.oldestDueAt).getTime())}.`,
      });
    }
    const activeConnections = connections.filter((connection) => connection.status !== "disabled");
    const connectionsHealthy = activeConnections.filter(
      (connection) => connection.status === "healthy",
    ).length;
    const overall = connections.some((connection) => connection.status === "down")
      ? "down"
      : connections.some((connection) => connection.status === "degraded") || alerts.length > 0
        ? "degraded"
        : "healthy";

    return {
      generatedAt: now.toISOString(),
      overall,
      metrics: {
        connectionsHealthy,
        connectionsTotal: activeConnections.length,
        activeSessions24h: databaseSnapshot.activeSessions24h,
        sessionsNeedAttention: sessions.filter((session) => session.health !== "healthy").length,
        pendingInboundEvents: databaseSnapshot.pendingInboundEvents,
        queuePending: queue.pending,
        followupDue: followup.due,
        followupFailed: followup.failed + followup.deliveryUnknown,
      },
      connections,
      alerts,
      sessionSummary: withoutSessions(databaseSnapshot),
      sessions,
      llmUsage: {
        ...llmUsage,
        usdToVndRate: this.dependencies.env.llmUsdToVndRate,
        pricingSource: "OpenAI API Standard pricing",
        pricingEffectiveAt: "2026-08-12",
        methodology:
          "Ước tính từ usage của Responses API; cached input, input và output được tính theo đơn giá lưu tại thời điểm gọi. Lượt CLI và lượt lỗi không có usage không được cộng chi phí.",
      },
      actionRollout: {
        ...actionRollout,
        mode: rolloutMode,
        canaryPercent,
        ...rolloutGate,
      },
      followup: {
        ...followup,
        mode: followupWorker?.mode ?? this.dependencies.env.followupMode,
      },
    };
  }
}

export function evaluateActionRolloutGate(snapshot: ActionRolloutSnapshot): {
  gateStatus: "collecting" | "pass" | "blocked";
  gateReasons: string[];
} {
  if (snapshot.sampleSize24h < 100) {
    return {
      gateStatus: "collecting",
      gateReasons: [`Cần tối thiểu 100 mẫu; hiện có ${snapshot.sampleSize24h}.`],
    };
  }
  const reasons: string[] = [];
  if (snapshot.handoffMismatchRate > 0.01) reasons.push("Handoff lệch vượt 1%.");
  if (snapshot.clarificationMismatchRate > 0.05) reasons.push("Hỏi lại lệch vượt 5%.");
  if (snapshot.intentMismatchRate > 0.05) reasons.push("Ý định lệch vượt 5%.");
  if (snapshot.pipelineMismatchRate > 0.03) reasons.push("Pipeline lệch vượt 3%.");
  return reasons.length > 0
    ? { gateStatus: "blocked", gateReasons: reasons }
    : { gateStatus: "pass", gateReasons: [] };
}

export function diagnoseSession(session: OperationalSessionRecord, now = new Date()): OperationalSession {
  const inboundAt = session.lastInboundAt ? new Date(session.lastInboundAt).getTime() : undefined;
  const outboundAt = session.lastOutboundAt ? new Date(session.lastOutboundAt).getTime() : undefined;
  if (
    inboundAt !== undefined &&
    (outboundAt === undefined || inboundAt > outboundAt) &&
    now.getTime() - inboundAt > 30_000 &&
    session.humanStatus === "bot"
  ) {
    return {
      ...session,
      health: "critical",
      issue: "Có tin khách chưa được bot phản hồi sau 30 giây",
    };
  }
  if (session.humanStatus === "human") {
    return { ...session, health: "attention", issue: "Đang chờ nhân viên xử lý" };
  }
  if (session.humanStatus === "paused") {
    return { ...session, health: "attention", issue: "Bot đang tạm dừng" };
  }
  if (session.signal) {
    return {
      ...session,
      health: "attention",
      issue: `Có tín hiệu cần theo dõi: ${session.signal}`,
    };
  }
  return { ...session, health: "healthy" };
}

async function probeMetaGateway(port: number): Promise<{ ok: boolean; latencyMs: number }> {
  const startedAt = performance.now();
  try {
    const response = await fetch(`http://127.0.0.1:${port}/webhooks/meta`, {
      signal: AbortSignal.timeout(2_500),
    });
    return {
      ok: response.status === 403 || response.ok,
      latencyMs: Math.round(performance.now() - startedAt),
    };
  } catch {
    return {
      ok: false,
      latencyMs: Math.round(performance.now() - startedAt),
    };
  }
}

async function probePublicWebhook(url: string): Promise<{ ok: boolean; latencyMs: number }> {
  const startedAt = performance.now();
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
    return {
      ok: response.status === 403 || response.ok,
      latencyMs: Math.round(performance.now() - startedAt),
    };
  } catch {
    const target = new URL(url);
    if (requiresPublicDnsProbe(target.hostname)) {
      const ok = await probePublicWebhookWithPublicDns(target);
      return {
        ok,
        latencyMs: Math.round(performance.now() - startedAt),
      };
    }
    return {
      ok: false,
      latencyMs: Math.round(performance.now() - startedAt),
    };
  }
}

function requiresPublicDnsProbe(hostname: string): boolean {
  return hostname.endsWith(".trycloudflare.com") || hostname.endsWith(".ts.net");
}

async function probePublicWebhookWithPublicDns(target: URL): Promise<boolean> {
  try {
    const resolver = new Resolver();
    resolver.setServers(["1.1.1.1", "8.8.8.8"]);
    const addresses = await resolver.resolve4(target.hostname);
    const address = addresses[0];
    if (!address) return false;
    return await new Promise<boolean>((resolve) => {
      const request = httpsRequest(
        {
          protocol: "https:",
          hostname: address,
          port: 443,
          path: `${target.pathname}${target.search}`,
          method: "GET",
          servername: target.hostname,
          headers: { host: target.host },
          timeout: 5_000,
        },
        (response) => {
          response.resume();
          resolve(
            response.statusCode === 403 ||
              (response.statusCode !== undefined && response.statusCode >= 200 && response.statusCode < 300),
          );
        },
      );
      request.on("timeout", () => request.destroy(new Error("public_dns_probe_timeout")));
      request.on("error", () => resolve(false));
      request.end();
    });
  } catch {
    return false;
  }
}

function disabledAdapters(): OperationalConnection[] {
  return [
    ["pancake", "Pancake", "adapter://pancake"],
    ["sapo", "Sapo", "adapter://sapo"],
    ["omicall", "OmiCall", "adapter://omicall"],
  ].map(([id, name, endpoint]) => ({
    id: id!,
    name: name!,
    endpoint: endpoint!,
    status: "disabled" as const,
    detail: "Mới có contract, chưa cấu hình adapter chạy thật",
  }));
}

function buildAlerts(input: {
  connections: OperationalConnection[];
  databaseSnapshot: PostgresOperationalSnapshot;
  sessions: OperationalSession[];
  queue: RedisQueueSnapshot;
  now: Date;
}): OperationsSnapshot["alerts"] {
  const alerts: OperationsSnapshot["alerts"] = input.connections
    .filter((connection) => connection.status === "down")
    .map((connection) => ({
      severity: "critical" as const,
      title: `${connection.name} mất kết nối`,
      detail: connection.detail,
    }));
  if (input.databaseSnapshot.pendingInboundEvents > 0) {
    const age = input.databaseSnapshot.oldestPendingInboundAt
      ? formatDuration(
          input.now.getTime() - new Date(input.databaseSnapshot.oldestPendingInboundAt).getTime(),
        )
      : "không rõ";
    alerts.push({
      severity: "critical",
      title: `${input.databaseSnapshot.pendingInboundEvents} inbound chưa xử lý`,
      detail: `Event cũ nhất đã chờ ${age}`,
    });
  }
  if (input.queue.pending > 0) {
    alerts.push({
      severity: "warning",
      title: `${input.queue.pending} job đang pending trong Redis`,
      detail: "Kiểm tra worker, retry và consumer group meta-inbound-v1",
    });
  }
  const criticalSessions = input.sessions.filter((session) => session.health === "critical").length;
  if (criticalSessions > 0) {
    alerts.push({
      severity: "critical",
      title: `${criticalSessions} phiên có tin chưa được trả lời`,
      detail: "Mở bảng phiên và lọc trạng thái Lỗi để xác định pipeline bị kẹt",
    });
  }
  return alerts;
}

function isLaterThan(left: string | undefined, right: string | undefined): boolean {
  if (!left) return false;
  if (!right) return true;
  return new Date(left).getTime() > new Date(right).getTime();
}

function llmConnectionDetail(input: {
  enabled: boolean;
  provider: "openai" | "codex" | "hybrid";
  workerHealthy: boolean;
  lastSuccessAt?: string;
  lastLatencyMs?: number;
  lastError?: string;
}): string {
  if (!input.enabled) {
    return input.provider === "openai"
      ? "Thiếu OPENAI_API_KEY hoặc LLM_ENABLED đang tắt"
      : "CODEX_LLM_ENABLED đang tắt";
  }
  if (!input.workerHealthy) return "Đã cấu hình nhưng chưa xác nhận được worker";
  if (input.lastError) {
    const labels: Record<string, string> = {
      llm_auth_error: "API key không hợp lệ hoặc không có quyền dùng model",
      llm_timeout: "Lượt gọi LLM gần nhất bị timeout",
      llm_rate_limit: "OpenAI đang giới hạn tốc độ hoặc tài khoản hết hạn mức",
      llm_quota_exhausted: "OpenAI đã hết credit; hybrid sẽ chuyển sang Codex CLI",
      llm_hybrid_exhausted: "Cả OpenAI và Codex CLI đều không khả dụng",
      llm_provider_error: "OpenAI API gặp lỗi máy chủ",
      llm_empty_response: "OpenAI API trả về nhưng không có nội dung",
      llm_error: "Lượt gọi LLM gần nhất thất bại",
    };
    return labels[input.lastError] ?? `Lỗi LLM gần nhất: ${input.lastError}`;
  }
  if (input.provider === "openai" && !input.lastSuccessAt) {
    return "Đã cấu hình OpenAI API; chưa có lượt gọi thành công để xác nhận";
  }
  if (input.provider === "openai") {
    return `OpenAI API đã phản hồi${input.lastLatencyMs !== undefined ? ` · ${input.lastLatencyMs} ms` : ""}`;
  }
  if (input.provider === "hybrid") {
    return `Hybrid đã bật: OpenAI ưu tiên, Codex CLI dự phòng${input.lastLatencyMs !== undefined ? ` · ${input.lastLatencyMs} ms` : ""}`;
  }
  return "Codex CLI đã bật trong worker Meta";
}

function providerConnection(input: {
  provider: LlmProvider;
  configured: boolean;
  workerHealthy: boolean;
  health?: LlmProviderHealthSnapshot;
  fallbackModel: string;
}): OperationalConnection {
  const isOpenAi = input.provider === "openai";
  const name = isOpenAi ? "OpenAI Responses API" : "Codex CLI";
  const endpoint = `${input.provider}://${input.health?.model ?? input.fallbackModel}`;
  if (!input.configured) {
    return {
      id: isOpenAi ? "openai-llm" : "codex-cli",
      name,
      endpoint,
      status: "disabled",
      detail: `${name} không nằm trong tuyến LLM đang chọn`,
    };
  }
  if (!input.workerHealthy) {
    return {
      id: isOpenAi ? "openai-llm" : "codex-cli",
      name,
      endpoint,
      status: "down",
      detail: "Không có heartbeat worker để xác nhận provider",
    };
  }
  if (input.health?.enabled === false) {
    return {
      id: isOpenAi ? "openai-llm" : "codex-cli",
      name,
      endpoint,
      status: "disabled",
      detail: isOpenAi ? "Chưa có OPENAI_API_KEY khả dụng" : "Codex CLI đang tắt",
    };
  }
  const failureActive = isLaterThan(input.health?.lastFailureAt, input.health?.lastSuccessAt);
  const status: OperationalStatus = failureActive
    ? input.health?.lastError === "llm_auth_error" || input.health?.lastError === "llm_quota_exhausted"
      ? "down"
      : "degraded"
    : input.health?.lastSuccessAt
      ? "healthy"
      : "degraded";
  const detail = failureActive
    ? providerErrorDetail(input.health?.lastError)
    : input.health?.lastSuccessAt
      ? `Lượt gần nhất thành công${input.health.lastLatencyMs !== undefined ? ` · ${input.health.lastLatencyMs} ms` : ""}`
      : "Đã cấu hình; chưa có lượt gọi để xác nhận";
  const lastSeenAt = latestDate(input.health?.lastSuccessAt, input.health?.lastFailureAt);
  return {
    id: isOpenAi ? "openai-llm" : "codex-cli",
    name,
    endpoint,
    status,
    detail,
    ...(input.health?.lastLatencyMs !== undefined ? { latencyMs: input.health.lastLatencyMs } : {}),
    ...(lastSeenAt ? { lastSeenAt } : {}),
  };
}

function providerErrorDetail(error: string | undefined): string {
  const labels: Record<string, string> = {
    llm_auth_error: "Sai API key hoặc không có quyền dùng model",
    llm_timeout: "Lượt gọi gần nhất bị timeout",
    llm_rate_limit: "Provider đang giới hạn tốc độ",
    llm_quota_exhausted: "OpenAI đã hết credit hoặc quota",
    llm_provider_error: "Provider trả lỗi máy chủ",
    llm_empty_response: "Provider trả về nhưng không có nội dung",
    llm_error: "Lượt gọi gần nhất thất bại",
  };
  return labels[error ?? ""] ?? `Lỗi gần nhất: ${error ?? "unknown_error"}`;
}

function hybridRouterStatus(openAi: OperationalConnection, codex: OperationalConnection): OperationalStatus {
  const active = [openAi, codex].filter((item) => item.status !== "disabled");
  if (active.some((item) => item.status === "healthy")) return "healthy";
  if (active.length > 0 && active.every((item) => item.status === "down")) return "down";
  return "degraded";
}

function hybridRouterDetail(openAi: OperationalConnection, codex: OperationalConnection): string {
  const healthy = [openAi, codex].filter((item) => item.status === "healthy");
  if (healthy.length === 2) return "OpenAI và Codex đều sẵn sàng; OpenAI được ưu tiên";
  if (healthy.length === 1) {
    const fallback = healthy[0];
    const unavailable = fallback?.id === openAi.id ? codex : openAi;
    return `Đang phục vụ qua ${fallback?.name}; ${unavailable.name} ${statusLabel(unavailable.status)}`;
  }
  return `Chưa có provider healthy · OpenAI ${statusLabel(openAi.status)} · Codex ${statusLabel(codex.status)}`;
}

function statusLabel(status: OperationalStatus): string {
  const labels: Record<OperationalStatus, string> = {
    healthy: "hoạt động",
    degraded: "suy giảm",
    down: "mất kết nối",
    disabled: "đang tắt",
  };
  return labels[status];
}

function providerHealthWithPersistedActivity(
  health: LlmProviderHealthSnapshot | undefined,
  activity: LlmUsageSnapshot["latestProviders"][number] | undefined,
): LlmProviderHealthSnapshot | undefined {
  if (!activity) return health;
  if (health?.lastRequestAt && !isLaterThan(activity.occurredAt, health.lastRequestAt)) {
    return health;
  }
  const next: LlmProviderHealthSnapshot = {
    enabled: health?.enabled ?? true,
    model: health?.model ?? activity.model,
    ...health,
    lastRequestAt: activity.occurredAt,
    lastLatencyMs: activity.latencyMs,
    ...(activity.status === "success"
      ? { lastSuccessAt: activity.occurredAt }
      : {
          lastFailureAt: activity.occurredAt,
          lastError: activity.errorCode ?? "llm_error",
        }),
  };
  if (activity.status === "success") delete next.lastError;
  return next;
}

function safeEndpoint(value: string | undefined, fallback: string): string {
  if (!value) return `${fallback}://chưa-cấu-hình`;
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.hostname}${url.port ? `:${url.port}` : ""}${url.pathname}`;
  } catch {
    return `${fallback}://không-hợp-lệ`;
  }
}

function latestDate(...values: Array<string | undefined>): string | undefined {
  return values
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => new Date(right).getTime() - new Date(left).getTime())[0];
}

function formatDuration(milliseconds: number): string {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return "không rõ";
  if (milliseconds < 60_000) return `${Math.max(1, Math.round(milliseconds / 1_000))} giây`;
  if (milliseconds < 3_600_000) return `${Math.round(milliseconds / 60_000)} phút`;
  return `${Math.round(milliseconds / 3_600_000)} giờ`;
}

function withoutSessions(
  snapshot: PostgresOperationalSnapshot,
): Omit<PostgresOperationalSnapshot, "sessions"> {
  const { sessions, ...summary } = snapshot;
  void sessions;
  return summary;
}

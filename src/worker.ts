import { randomUUID } from "node:crypto";
import { GraphMetaMessenger } from "./adapters/metaMessenger.js";
import { loadEnv } from "./config/env.js";
import { openingVariants, type OpeningVariantId } from "./domain/sales.js";
import { tenantId } from "./domain/types.js";
import { PostgresStore } from "./infrastructure/postgres.js";
import { RedisRuntime, type RedisQueueMessage } from "./infrastructure/redis.js";
import { CodexLlmBridge, type LlmHealthSnapshot } from "./services/codexLlm.js";
import { DemoChatService } from "./services/demoChat.js";
import { StructuredLogger } from "./services/logger.js";
import { MetaChatBrain } from "./services/metaChatBrain.js";
import { MetaInboundProcessor, type MetaInboundJob } from "./services/metaInboundProcessor.js";
import { PgFollowupRepository } from "./services/followupRepository.js";
import { OrderInboxService } from "./services/orderInbox.js";

const queueTopic = "inbound";
const queueGroup = "meta-inbound-v1";
const maximumAttempts = 3;
const env = loadEnv();
const logger = new StructuredLogger();

if (!env.redisUrl || !env.databaseUrl) {
  logger.log("error", "worker_disabled", {
    reason: "DATABASE_URL and REDIS_URL are required",
  });
  process.exitCode = 1;
} else if (env.metaLiveSendEnabled && !env.metaPageAccessToken) {
  logger.log("error", "worker_disabled", {
    reason: "META_PAGE_ACCESS_TOKEN is required when live send is enabled",
  });
  process.exitCode = 1;
} else {
  const redis = new RedisRuntime(env.redisUrl);
  const postgres = new PostgresStore(env.databaseUrl);
  const followups = new PgFollowupRepository(postgres.pool);
  const orderInbox = new OrderInboxService(postgres.pool);
  const chat = new DemoChatService();
  const llm = CodexLlmBridge.fromEnvironment(
    process.env,
    (event) => postgres.recordLlmUsage(event),
  );
  const brain = new MetaChatBrain(chat, llm, logger, {
    mode: env.multiActionRolloutMode,
    canaryPercent: env.multiActionCanaryPercent,
    record: (comparison) => postgres.recordActionRollout(comparison),
  });
  const messenger = new GraphMetaMessenger({
    pageAccessToken: env.metaPageAccessToken ?? "",
    graphVersion: env.metaGraphVersion,
  });
  const processor = new MetaInboundProcessor({
    store: postgres,
    messenger,
    chat,
    brain,
    logger,
    liveSendEnabled: env.metaLiveSendEnabled,
    staffName: env.metaStaffName,
    openingVariantId: parseOpeningVariant(env.metaOpeningVariant),
    orderInbox,
    ...(env.followupMode !== "disabled" ? { followups } : {}),
  });

  let stopping = false;
  const workerLeaseKey = `worker:${queueGroup}:${env.metaWorkerConsumer}`;
  const workerLeaseOwner = `${process.pid}:${randomUUID()}`;
  const workerLeaseTtlMs = 15_000;
  let workerLeaseAcquired = false;
  let workerLeaseTimer: NodeJS.Timeout | undefined;
  const stop = (): void => {
    stopping = true;
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  try {
    const [redisReady, databaseReady] = await Promise.all([redis.ready(), postgres.ready()]);
    if (!redisReady || !databaseReady) {
      throw new Error("worker_dependencies_not_ready");
    }
    workerLeaseAcquired = await redis.acquireLease(
      workerLeaseKey,
      workerLeaseOwner,
      workerLeaseTtlMs,
    );
    if (!workerLeaseAcquired) {
      throw new Error(`worker_consumer_already_active:${env.metaWorkerConsumer}`);
    }
    workerLeaseTimer = setInterval(() => {
      void redis
        .renewLease(workerLeaseKey, workerLeaseOwner, workerLeaseTtlMs)
        .then((renewed) => {
          if (!renewed) {
            logger.log("error", "worker_lease_lost", {
              consumer: env.metaWorkerConsumer,
            });
            stopping = true;
          }
        })
        .catch((error: unknown) => {
          logger.log("error", "worker_lease_renew_failed", {
            consumer: env.metaWorkerConsumer,
            reason: error instanceof Error ? error.message : "unknown_error",
          });
          stopping = true;
        });
    }, 5_000);
    workerLeaseTimer.unref();
    await redis.ensureConsumerGroup(queueTopic, queueGroup);
    await publishWorkerHeartbeat(redis, llm.healthSnapshot());
    logger.log("info", "worker_started", {
      redisReady,
      databaseReady,
      queueGroup,
      consumer: env.metaWorkerConsumer,
      liveSendEnabled: env.metaLiveSendEnabled,
      activePage: env.metaActivePage,
      llmEnabled: llm.enabled,
      llmProvider: llm.provider,
      llmModel: llm.model,
      llmProviders: llm.healthSnapshot().providers,
      multiActionRolloutMode: env.multiActionRolloutMode,
      multiActionCanaryPercent: env.multiActionCanaryPercent,
      followupMode: env.followupMode,
    });

    while (!stopping) {
      await publishWorkerHeartbeat(redis, llm.healthSnapshot());
      const ownPending = await redis.readGroup<unknown>({
        topic: queueTopic,
        group: queueGroup,
        consumer: env.metaWorkerConsumer,
        count: 100,
        blockMs: 0,
        id: "0",
      });
      const firstRead =
        ownPending.length > 0
          ? ownPending
          : await redis.readGroup<unknown>({
              topic: queueTopic,
              group: queueGroup,
              consumer: env.metaWorkerConsumer,
              count: 100,
              blockMs: 1_000,
            });
      if (firstRead.length === 0) continue;

      const valid = firstRead
        .map(parseQueueMessage)
        .filter((item): item is RedisQueueMessage<MetaInboundJob> & { payload: MetaInboundJob } =>
          Boolean(item),
        );
      const validIds = new Set(valid.map((item) => item.id));
      const invalidIds = firstRead
        .filter((item) => !validIds.has(item.id))
        .map((item) => item.id);
      if (invalidIds.length > 0) {
        await redis.acknowledge(queueTopic, queueGroup, invalidIds);
        logger.log("warn", "meta_queue_invalid_jobs_acked", {
          count: invalidIds.length,
        });
      }

      const initialBatch = groupByConversation(valid)[0];
      if (!initialBatch) continue;
      const batch = await collectConversationBurst(redis, initialBatch);
      await publishWorkerHeartbeat(redis, llm.healthSnapshot());
      if (env.metaPageId && batch[0]?.payload.externalPageId !== env.metaPageId) {
        await redis.acknowledge(
          queueTopic,
          queueGroup,
          batch.map((item) => item.id),
        );
        logger.log("warn", "meta_queue_wrong_page_acked", {
          eventCount: batch.length,
        });
        continue;
      }
      const first = batch[0];
      if (!first) continue;
      const leaseKey = `meta:${first.payload.pageId}:${first.payload.senderId}`;
      const leaseOwner = `${env.metaWorkerConsumer}:${first.id}`;
      const acquired = await redis.acquireLease(leaseKey, leaseOwner, 60_000);
      if (!acquired) {
        await retryOrAcknowledge(redis, batch, "conversation_lease_busy");
        continue;
      }
      try {
        const result = await processor.processBatch(
          batch
            .map((item) => item.payload)
            .sort((left, right) => left.timestamp.localeCompare(right.timestamp)),
        );
        if (result.status !== "superseded") {
          await redis.acknowledge(
            queueTopic,
            queueGroup,
            batch.map((item) => item.id),
          );
        }
        logger.log("info", "meta_batch_processed", {
          traceId: first.payload.traceId,
          eventCount: batch.length,
          status: result.status,
          replyCount: result.replyCount,
        });
        await publishWorkerHeartbeat(redis, llm.healthSnapshot());
      } catch (error) {
        await retryOrAcknowledge(redis, batch, error instanceof Error ? error.name : "unknown_error");
      } finally {
        await redis.releaseLease(leaseKey, leaseOwner);
      }
    }
  } catch (error) {
    logger.log("error", "worker_crashed", {
      reason: error instanceof Error ? error.message : "unknown_error",
    });
    process.exitCode = 1;
  } finally {
    if (workerLeaseTimer) clearInterval(workerLeaseTimer);
    if (workerLeaseAcquired) {
      await redis.releaseLease(workerLeaseKey, workerLeaseOwner).catch(() => false);
    }
    await Promise.allSettled([redis.close(), postgres.close()]);
    logger.log("info", "worker_stopped");
  }
}

async function publishWorkerHeartbeat(
  redis: RedisRuntime,
  llm: LlmHealthSnapshot,
): Promise<void> {
  await redis.setJson(
    "health:worker:meta",
    {
      at: new Date().toISOString(),
      consumer: env.metaWorkerConsumer,
      activePage: env.metaActivePage,
      liveSendEnabled: env.metaLiveSendEnabled,
      llmEnabled: llm.enabled,
      llmProvider: llm.provider,
      llmModel: llm.model,
      llmProviders: llm.providers,
      multiActionRolloutMode: env.multiActionRolloutMode,
      multiActionCanaryPercent: env.multiActionCanaryPercent,
      ...(llm.lastRequestAt ? { llmLastRequestAt: llm.lastRequestAt } : {}),
      ...(llm.lastSuccessAt ? { llmLastSuccessAt: llm.lastSuccessAt } : {}),
      ...(llm.lastFailureAt ? { llmLastFailureAt: llm.lastFailureAt } : {}),
      ...(llm.lastLatencyMs !== undefined ? { llmLastLatencyMs: llm.lastLatencyMs } : {}),
      ...(llm.lastError ? { llmLastError: llm.lastError } : {}),
    },
    90,
  );
}

function parseOpeningVariant(value: string): OpeningVariantId {
  const found = openingVariants.find((variant) => variant.id === value);
  if (!found) throw new Error(`META_OPENING_VARIANT không hợp lệ: ${value}`);
  return found.id;
}

function parseQueueMessage(
  message: RedisQueueMessage<unknown>,
): RedisQueueMessage<MetaInboundJob> | undefined {
  if (!message.payload || typeof message.payload !== "object") return undefined;
  const value = message.payload as Record<string, unknown>;
  if (
    typeof value.traceId !== "string" ||
    typeof value.tenantId !== "string" ||
    typeof value.pageId !== "string" ||
    typeof value.externalPageId !== "string" ||
    typeof value.eventId !== "string" ||
    typeof value.senderId !== "string" ||
    typeof value.kind !== "string" ||
    !["text", "image", "postback", "referral", "delivery", "read"].includes(value.kind) ||
    typeof value.timestamp !== "string"
  ) {
    return undefined;
  }
  const parsed: MetaInboundJob = {
    traceId: value.traceId,
    tenantId: tenantId(value.tenantId),
    pageId: value.pageId,
    externalPageId: value.externalPageId,
    eventId: value.eventId,
    senderId: value.senderId,
    kind: value.kind as MetaInboundJob["kind"],
    timestamp: value.timestamp,
    payload: value.payload,
    attempt: typeof value.attempt === "number" && Number.isInteger(value.attempt) ? value.attempt : 0,
    ...(typeof value.text === "string" ? { text: value.text } : {}),
    ...(typeof value.attachmentUrl === "string" ? { attachmentUrl: value.attachmentUrl } : {}),
    ...(isMetaReferralAttribution(value.referral) ? { referral: value.referral } : {}),
  };
  return { id: message.id, payload: parsed };
}

function isMetaReferralAttribution(value: unknown): value is MetaInboundJob["referral"] & object {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const referral = value as Record<string, unknown>;
  return (
    referral.adsContextData !== null &&
    typeof referral.adsContextData === "object" &&
    !Array.isArray(referral.adsContextData) &&
    referral.raw !== null &&
    typeof referral.raw === "object" &&
    !Array.isArray(referral.raw)
  );
}

function groupByConversation(
  messages: readonly RedisQueueMessage<MetaInboundJob>[],
): Array<Array<RedisQueueMessage<MetaInboundJob>>> {
  const grouped = new Map<string, Array<RedisQueueMessage<MetaInboundJob>>>();
  for (const message of messages) {
    const key = `${message.payload.tenantId}:${message.payload.pageId}:${message.payload.senderId}`;
    const batch = grouped.get(key) ?? [];
    batch.push(message);
    grouped.set(key, batch);
  }
  return [...grouped.values()];
}

async function collectConversationBurst(
  redis: RedisRuntime,
  initialBatch: Array<RedisQueueMessage<MetaInboundJob>>,
): Promise<Array<RedisQueueMessage<MetaInboundJob>>> {
  if (!initialBatch.some((message) => isCustomerContent(message.payload))) {
    return initialBatch;
  }
  const first = initialBatch[0];
  if (!first) return initialBatch;
  const targetKey = conversationKey(first.payload);
  const batch = [...initialBatch];
  const seenIds = new Set(batch.map((message) => message.id));
  const startedAt = Date.now();
  const maximumBurstMs = Math.max(
    env.metaDebounceMs,
    Math.min(env.metaDebounceMs * 3, 12_000),
  );
  let quietUntil = startedAt + env.metaDebounceMs;
  const stopAt = startedAt + maximumBurstMs;

  while (Date.now() < quietUntil && Date.now() < stopAt) {
    const remaining = Math.min(quietUntil, stopAt) - Date.now();
    await delay(Math.max(1, Math.min(100, remaining)));
    const newlyRead = await redis.readGroup<unknown>({
      topic: queueTopic,
      group: queueGroup,
      consumer: env.metaWorkerConsumer,
      count: 100,
      // Poll non-blocking: một số Redis proxy giữ BLOCK lâu hơn giá trị yêu cầu.
      blockMs: 0,
    });
    if (newlyRead.length === 0) continue;
    const parsed = newlyRead
      .map(parseQueueMessage)
      .filter((item): item is RedisQueueMessage<MetaInboundJob> => Boolean(item));
    const parsedIds = new Set(parsed.map((message) => message.id));
    const invalidIds = newlyRead
      .filter((message) => !parsedIds.has(message.id))
      .map((message) => message.id);
    if (invalidIds.length > 0) {
      await redis.acknowledge(queueTopic, queueGroup, invalidIds);
      logger.log("warn", "meta_queue_invalid_jobs_acked", {
        count: invalidIds.length,
      });
    }
    for (const message of parsed) {
      if (
        conversationKey(message.payload) !== targetKey ||
        seenIds.has(message.id)
      ) {
        // Event của hội thoại khác vẫn ở pending và sẽ được xử lý ở vòng sau.
        continue;
      }
      seenIds.add(message.id);
      batch.push(message);
      if (isCustomerContent(message.payload)) {
        quietUntil = Date.now() + env.metaDebounceMs;
      }
    }
  }
  return batch;
}

function conversationKey(job: MetaInboundJob): string {
  return `${job.tenantId}:${job.pageId}:${job.senderId}`;
}

function isCustomerContent(job: MetaInboundJob): boolean {
  return job.kind === "text" || job.kind === "image" || job.kind === "postback";
}

async function retryOrAcknowledge(
  redis: RedisRuntime,
  batch: readonly RedisQueueMessage<MetaInboundJob>[],
  reason: string,
): Promise<void> {
  const first = batch[0];
  if (!first) return;
  const retryable = batch.filter((message) => message.payload.attempt + 1 < maximumAttempts);
  for (const message of retryable) {
    await redis.enqueue(queueTopic, {
      ...message.payload,
      attempt: message.payload.attempt + 1,
    });
  }
  await redis.acknowledge(
    queueTopic,
    queueGroup,
    batch.map((item) => item.id),
  );
  logger.log(retryable.length > 0 ? "warn" : "error", "meta_batch_failed", {
    traceId: first.payload.traceId,
    eventCount: batch.length,
    retryCount: retryable.length,
    reason,
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

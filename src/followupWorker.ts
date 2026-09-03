import { randomUUID } from "node:crypto";
import { GraphMetaMessenger } from "./adapters/metaMessenger.js";
import { loadEnv } from "./config/env.js";
import { PostgresStore } from "./infrastructure/postgres.js";
import { RedisRuntime } from "./infrastructure/redis.js";
import { FollowupDispatcher } from "./services/followupDispatcher.js";
import { PgFollowupRepository } from "./services/followupRepository.js";
import { CodexLlmBridge } from "./services/codexLlm.js";
import { StructuredLogger } from "./services/logger.js";

const env = loadEnv();
const logger = new StructuredLogger();

if (!env.redisUrl || !env.databaseUrl) {
  logger.log("error", "followup_worker_disabled", {
    reason: "DATABASE_URL and REDIS_URL are required",
  });
  process.exitCode = 1;
} else if (env.followupMode === "enabled" && (!env.metaLiveSendEnabled || !env.metaPageAccessToken)) {
  logger.log("error", "followup_worker_disabled", {
    reason: "META live send and Page token are required when follow-up is enabled",
  });
  process.exitCode = 1;
} else {
  const redis = new RedisRuntime(env.redisUrl);
  const postgres = new PostgresStore(env.databaseUrl);
  const repository = new PgFollowupRepository(postgres.pool);
  const llm = CodexLlmBridge.fromEnvironment(process.env, (event) => postgres.recordLlmUsage(event));
  const messenger = new GraphMetaMessenger({
    pageAccessToken: env.metaPageAccessToken ?? "",
    graphVersion: env.metaGraphVersion,
  });
  const dispatcher = new FollowupDispatcher({
    repository,
    messenger,
    logger,
    mode: env.followupMode,
    outboundWindowHours: env.outboundWindowHours,
    maxAttempts: env.followupMaxAttempts,
    composer: llm,
  });
  const workerLeaseKey = `worker:followup:${env.followupWorkerConsumer}`;
  const workerLeaseOwner = `${process.pid}:${randomUUID()}`;
  const workerLeaseTtlMs = 15_000;
  let stopping = false;
  let workerLeaseTimer: NodeJS.Timeout | undefined;
  let workerLeaseAcquired = false;
  let lastStaleRecoveryAt = 0;
  const stop = (): void => {
    stopping = true;
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  try {
    const [redisReady, databaseReady] = await Promise.all([redis.ready(), postgres.ready()]);
    if (!redisReady || !databaseReady) throw new Error("followup_worker_dependencies_not_ready");
    workerLeaseAcquired = await redis.acquireLease(workerLeaseKey, workerLeaseOwner, workerLeaseTtlMs);
    if (!workerLeaseAcquired) {
      throw new Error(`followup_worker_already_active:${env.followupWorkerConsumer}`);
    }
    workerLeaseTimer = setInterval(() => {
      void redis
        .renewLease(workerLeaseKey, workerLeaseOwner, workerLeaseTtlMs)
        .then((renewed) => {
          if (!renewed) stopping = true;
        })
        .catch(() => {
          stopping = true;
        });
    }, 5_000);
    workerLeaseTimer.unref();
    logger.log("info", "followup_worker_started", {
      consumer: env.followupWorkerConsumer,
      mode: env.followupMode,
      batchSize: env.followupBatchSize,
      activePage: env.metaActivePage,
      llmEnabled: llm.enabled,
      llmProvider: llm.provider,
      llmModel: llm.model,
    });

    while (!stopping) {
      const now = new Date();
      if (Date.now() - lastStaleRecoveryAt >= 60_000) {
        const recovered = await repository.releaseStaleClaims(new Date(Date.now() - env.followupClaimTtlMs));
        if (recovered > 0) logger.log("warn", "followup_stale_claims_recovered", { recovered });
        lastStaleRecoveryAt = Date.now();
      }
      const snapshot = await repository.runtimeSnapshot(now);
      await redis.setJson(
        "health:worker:followup",
        {
          at: now.toISOString(),
          consumer: env.followupWorkerConsumer,
          activePage: env.metaActivePage,
          mode: env.followupMode,
          ...snapshot,
        },
        90,
      );
      if (env.followupMode === "disabled") {
        await pause(env.followupPollMs);
        continue;
      }
      const jobs = await repository.claimDue(now, env.followupBatchSize);
      if (jobs.length === 0) {
        await pause(env.followupPollMs);
        continue;
      }
      for (const job of jobs) {
        const leaseKey = `meta:${job.pageId}:${job.externalCustomerId}`;
        const leaseOwner = `${env.followupWorkerConsumer}:${job.id}`;
        const acquired = await redis.acquireLease(leaseKey, leaseOwner, env.followupClaimTtlMs);
        if (!acquired) {
          await repository.releaseClaim(
            job.id,
            new Date(Date.now() + Math.min(5_000, env.followupPollMs)),
            "conversation_lease_busy",
          );
          continue;
        }
        try {
          await dispatcher.process(job);
        } catch (error) {
          logger.log("error", "followup_job_crashed", {
            jobId: job.id,
            cycleId: job.cycleId,
            reason: error instanceof Error ? error.message : "unknown_error",
          });
          await repository
            .releaseClaim(job.id, new Date(Date.now() + 30_000), "worker_processing_error")
            .catch(() => undefined);
        } finally {
          await redis.releaseLease(leaseKey, leaseOwner);
        }
      }
    }
  } catch (error) {
    logger.log("error", "followup_worker_crashed", {
      reason: error instanceof Error ? error.message : "unknown_error",
    });
    process.exitCode = 1;
  } finally {
    if (workerLeaseTimer) clearInterval(workerLeaseTimer);
    if (workerLeaseAcquired) {
      await redis.releaseLease(workerLeaseKey, workerLeaseOwner).catch(() => false);
    }
    await Promise.allSettled([redis.close(), postgres.close()]);
    logger.log("info", "followup_worker_stopped");
  }
}

function pause(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

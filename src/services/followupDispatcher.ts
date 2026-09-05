import type { MetaMessenger } from "../integrations/contracts.js";
import { followupMessage } from "../domain/sales.js";
import { questionTopic } from "../domain/responseGovernor.js";
import type { FollowupComposeResult } from "./codexLlm.js";
import type { ClaimedFollowupJob, PgFollowupRepository } from "./followupRepository.js";
import type { StructuredLogger } from "./logger.js";

export type FollowupMode = "disabled" | "shadow" | "enabled";

export type FollowupEligibility =
  | { eligible: true }
  | {
      eligible: false;
      reason:
        | "cycle_inactive"
        | "page_inactive"
        | "customer_deleted"
        | "human_or_paused"
        | "order_already_exists"
        | "pipeline_not_eligible"
        | "customer_replied"
        | "outside_messaging_window"
        | "missing_customer_activity";
    };

const ELIGIBLE_PIPELINES = new Set(["3.Đã báo giá", "4.XL băn khoăn", "7.Chờ followup"]);

export function evaluateFollowupEligibility(
  job: ClaimedFollowupJob,
  now: Date,
  outboundWindowHours: number,
): FollowupEligibility {
  if (job.cycleStatus !== "active") return { eligible: false, reason: "cycle_inactive" };
  if (!job.pageActive) return { eligible: false, reason: "page_inactive" };
  if (job.customerDeleted) return { eligible: false, reason: "customer_deleted" };
  if (job.humanStatus !== "bot") return { eligible: false, reason: "human_or_paused" };
  if (job.orderExists) return { eligible: false, reason: "order_already_exists" };
  if (!ELIGIBLE_PIPELINES.has(job.pipelineTag)) {
    return { eligible: false, reason: "pipeline_not_eligible" };
  }
  if (!job.lastCustomerActivityAt) {
    return { eligible: false, reason: "missing_customer_activity" };
  }
  if (job.lastCustomerActivityAt.getTime() > job.anchorSentAt.getTime()) {
    return { eligible: false, reason: "customer_replied" };
  }
  const windowMs = outboundWindowHours * 60 * 60 * 1_000;
  if (now.getTime() - job.lastCustomerActivityAt.getTime() >= windowMs) {
    return { eligible: false, reason: "outside_messaging_window" };
  }
  return { eligible: true };
}

export class FollowupDispatcher {
  constructor(
    private readonly options: {
      repository: PgFollowupRepository;
      messenger: MetaMessenger;
      messengerForPage?: (pageId: string) => Promise<MetaMessenger>;
      logger: StructuredLogger;
      mode: FollowupMode;
      outboundWindowHours: number;
      maxAttempts: number;
      composer?: {
        composeFollowup(input: {
          stage: ClaimedFollowupJob["stage"];
          baseReply: string;
          context: ClaimedFollowupJob["contextSnapshot"];
        }): Promise<FollowupComposeResult>;
      };
      now?: () => Date;
    },
  ) {}

  async process(
    job: ClaimedFollowupJob,
  ): Promise<"sent" | "shadowed" | "cancelled" | "scheduled" | "failed" | "delivery_unknown"> {
    const now = (this.options.now ?? (() => new Date()))();
    const eligibility = evaluateFollowupEligibility(job, now, this.options.outboundWindowHours);
    if (!eligibility.eligible) {
      await this.options.repository.markCancelled(job.id, eligibility.reason);
      this.options.logger.log("info", "followup_cancelled", {
        jobId: job.id,
        cycleId: job.cycleId,
        conversationId: job.conversationId,
        stage: job.stage,
        reason: eligibility.reason,
      });
      return "cancelled";
    }
    if (this.options.mode !== "enabled") {
      await this.options.repository.markShadowed(job.id);
      this.options.logger.log("info", "followup_shadowed", {
        jobId: job.id,
        cycleId: job.cycleId,
        conversationId: job.conversationId,
        stage: job.stage,
      });
      return "shadowed";
    }

    // Cancellation may race with an already claimed job. Recheck immediately
    // before the external side effect; the worker also shares the conversation
    // Redis lease with the inbound worker.
    if (!(await this.options.repository.isStillClaimed(job.id))) {
      return "cancelled";
    }
    const context = job.contextSnapshot;
    const baseReply = followupMessage(job.stage, {
      ...(context.lastIntent ? { lastIntent: context.lastIntent } : {}),
      ...(context.conversationMemory?.rejectedArguments
        ? { rejectedArguments: context.conversationMemory.rejectedArguments }
        : {}),
      ...(context.conversationMemory?.openQuestions
        ? { openQuestions: context.conversationMemory.openQuestions }
        : {}),
      ...(context.askedTopics ? { askedTopics: context.askedTopics } : {}),
    });
    const composed = this.options.composer
      ? await this.options.composer.composeFollowup({
          stage: job.stage,
          baseReply,
          context,
        })
      : {
          text: baseReply,
          status: "fallback" as const,
          latencyMs: 0,
          reason: "composer_not_configured",
          model: "none",
          provider: "openai" as const,
        };
    const text = composed.text;
    const pendingQuestionTopic = questionTopic(text);
    const messenger = this.options.messengerForPage
      ? await this.options.messengerForPage(job.pageId)
      : this.options.messenger;
    const result = await messenger.sendText({
      recipientId: job.externalCustomerId,
      text,
      idempotencyKey: job.idempotencyKey,
    });
    if (result.ok) {
      await this.options.repository.markSent({
        job,
        metaMessageId: result.value.messageId,
        text,
        sentAt: now,
        ...(pendingQuestionTopic ? { pendingQuestionTopic } : {}),
        composerStatus: composed.status,
      });
      this.options.logger.log("info", "followup_sent", {
        jobId: job.id,
        cycleId: job.cycleId,
        conversationId: job.conversationId,
        stage: job.stage,
        metaMessageId: result.value.messageId,
        composerStatus: composed.status,
        composerReason: composed.reason,
        composerModel: composed.model,
        composerProvider: composed.provider,
        composerLatencyMs: composed.latencyMs,
      });
      return "sent";
    }

    // A network timeout is ambiguous: Meta may have accepted the message even
    // though the response was lost. Never retry it automatically.
    const ambiguous = result.code === "network_error";
    const delayMinutes = Math.min(30, 2 ** Math.max(0, job.attemptCount - 1));
    const status = await this.options.repository.markSendFailure({
      job,
      code: result.code,
      message: result.message,
      retryable: result.retryable,
      ambiguous,
      maxAttempts: this.options.maxAttempts,
      retryAt: new Date(now.getTime() + delayMinutes * 60_000),
    });
    this.options.logger.log(status === "scheduled" ? "warn" : "error", "followup_send_failed", {
      jobId: job.id,
      cycleId: job.cycleId,
      conversationId: job.conversationId,
      stage: job.stage,
      code: result.code,
      status,
      attemptCount: job.attemptCount,
    });
    return status;
  }
}

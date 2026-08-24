import type { TenantId } from "../domain/types.js";
import type { OpeningVariantId } from "../domain/sales.js";
import type { MetaMessenger } from "../integrations/contracts.js";
import type {
  MessengerConversation,
  PostgresStore,
  ConversationOutboundPlan,
} from "../infrastructure/postgres.js";
import { batchMessages } from "./messageBatcher.js";
import type { DemoChatService } from "./demoChat.js";
import { MetaChatBrain } from "./metaChatBrain.js";
import type { StructuredLogger } from "./logger.js";
import type { FollowupCycleSchedule } from "./followupRepository.js";
import type { OrderDraft } from "../domain/orders.js";
import type { PushOrderInboxInput } from "./orderInbox.js";

export type FollowupCoordinator = {
  cancelConversation(input: {
    tenantId: string;
    conversationId: string;
    reason: string;
  }): Promise<number>;
  scheduleCycle(input: FollowupCycleSchedule): Promise<{ cycleId: string; created: boolean }>;
};

export type OrderInboxWriter = {
  push(input: PushOrderInboxInput): Promise<unknown>;
};

export type MetaInboundJob = {
  traceId: string;
  tenantId: TenantId;
  pageId: string;
  externalPageId: string;
  eventId: string;
  senderId: string;
  kind: "text" | "image" | "postback" | "delivery" | "read";
  text?: string;
  attachmentUrl?: string;
  timestamp: string;
  payload: unknown;
  attempt: number;
};

export type MetaInboundStore = Pick<
  PostgresStore,
  | "ensureMessengerConversation"
  | "persistConversationMessage"
  | "hasNewerInboundContent"
  | "updateConversationRuntime"
  | "commitConversationTurn"
  | "findConversationTurnOutbound"
  | "markConversationTurnOutboundSent"
  | "markInboundProcessed"
  | "canDispatchConversationOutbound"
>;

export class MetaInboundProcessor {
  constructor(
    private readonly options: {
      store: MetaInboundStore;
      messenger: MetaMessenger;
      chat: DemoChatService;
      brain: MetaChatBrain;
      logger: StructuredLogger;
      liveSendEnabled: boolean;
      staffName: string;
      openingVariantId: OpeningVariantId;
      orderInbox?: OrderInboxWriter;
      followups?: FollowupCoordinator;
    },
  ) {}

  async processBatch(jobs: readonly MetaInboundJob[]): Promise<{
    status: "ignored" | "ingested" | "replied" | "paused" | "superseded";
    replyCount: number;
  }> {
    if (jobs.length === 0) return { status: "ignored", replyCount: 0 };
    const first = jobs[0]!;
    if (
      jobs.some(
        (job) =>
          job.tenantId !== first.tenantId ||
          job.pageId !== first.pageId ||
          job.senderId !== first.senderId,
      )
    ) {
      throw new Error("meta_batch_scope_mismatch");
    }
    const conversation = await this.options.store.ensureMessengerConversation({
      tenantId: first.tenantId,
      pageId: first.pageId,
      externalCustomerId: first.senderId,
    });
    const sessionId = `${first.pageId}:${first.senderId}`;
    const contentJobs = jobs.filter(
      (job) => job.kind === "text" || job.kind === "image" || job.kind === "postback",
    );
    const turnIdempotencyKey = `${first.eventId}:reply:turn`;
    for (const job of contentJobs) {
      await this.options.store.persistConversationMessage({
        tenantId: job.tenantId,
        pageId: job.pageId,
        conversationId: conversation.conversationId,
        externalMessageId: job.eventId,
        direction: "inbound",
        kind: job.kind as "text" | "image" | "postback",
        ...(job.text ? { text: job.text } : {}),
        payload: job.payload,
      });
    }
    if (contentJobs.length > 0 && this.options.followups) {
      const cancelled = await this.options.followups.cancelConversation({
        tenantId: first.tenantId,
        conversationId: conversation.conversationId,
        reason: "customer_replied",
      });
      if (cancelled > 0) {
        this.options.logger.log("info", "followup_cycle_cancelled_by_inbound", {
          traceId: first.traceId,
          conversationId: conversation.conversationId,
          cancelledJobs: cancelled,
        });
      }
    }
    if (contentJobs.length === 0) {
      await this.markProcessed(jobs);
      return { status: "ignored", replyCount: 0 };
    }
    if (!this.options.liveSendEnabled) {
      await this.markProcessed(jobs);
      this.options.logger.log("info", "meta_inbound_ingested_send_disabled", {
        traceId: first.traceId,
        eventCount: jobs.length,
        externalPageId: first.externalPageId,
      });
      return { status: "ingested", replyCount: 0 };
    }
    if (conversation.humanStatus !== "bot") {
      await this.markProcessed(jobs);
      return { status: "paused", replyCount: 0 };
    }
    const existingOutbound = await this.options.store.findConversationTurnOutbound({
      tenantId: first.tenantId,
      idempotencyKey: turnIdempotencyKey,
    });
    if (existingOutbound) {
      let replyCount = 0;
      let lastMessageId = existingOutbound.lastMessageId;
      let suppressed = false;
      await this.pushCreatedOrder({
        sessionId,
        state: conversation.runtimeState,
      });
      if (existingOutbound.status !== "sent") {
        const dispatched = await this.dispatchOutbound(
          first,
          conversation,
          existingOutbound,
          conversation.stateVersion,
        );
        replyCount = dispatched.count;
        suppressed = dispatched.suppressed;
        lastMessageId = dispatched.lastMessageId ?? lastMessageId;
      }
      if (lastMessageId && isFollowupEligiblePipeline(conversation.pipelineTag)) {
        await this.scheduleFollowup({
          tenantId: first.tenantId,
          pageId: first.pageId,
          conversationId: conversation.conversationId,
          stateVersion: conversation.stateVersion,
          anchorOutboundMessageId: lastMessageId,
        });
      }
      await this.markProcessed(jobs);
      return {
        status: suppressed ? "paused" : "replied",
        replyCount,
      };
    }
    const imageJobs = contentJobs.filter((job) => job.kind === "image");
    if (imageJobs.length > 0) {
      const reply =
        "Dạ em đã nhận được hình ảnh của mình ạ. Em chuyển bộ phận liên quan kiểm tra nội dung ảnh và phản hồi lại mình sớm nhé.";
      void this.options.messenger.sendTyping(first.senderId).catch(() => undefined);
      const committed = await this.options.store.commitConversationTurn({
        tenantId: first.tenantId,
        pageId: first.pageId,
        conversationId: conversation.conversationId,
        expectedStateVersion: conversation.stateVersion,
        consultationStage: "human_review",
        pipelineTag: "2.Đang tư vấn",
        signalTag: "TH.Cần NV",
        humanStatus: "human",
        runtimeState: conversation.runtimeState,
        summary: "Khách gửi ảnh - chờ nhân viên kiểm tra",
        sourceEventIds: imageJobs.map((job) => job.eventId),
        outbound: {
          idempotencyKey: turnIdempotencyKey,
          recipientId: first.senderId,
          texts: [reply],
        },
      });
      const dispatched = await this.dispatchOutbound(
        first,
        conversation,
        committed.outbound,
        committed.stateVersion,
      );
      return { status: "paused", replyCount: dispatched.count };
    }

    this.options.chat.restoreSession(
      sessionId,
      conversation.runtimeState,
      this.context(),
    );
    const text = batchMessages(
      contentJobs.map((job) => ({
        id: job.eventId,
        sentAt: new Date(job.timestamp),
        ...(job.text ? { text: job.text } : {}),
      })),
    );
    if (!text) {
      await this.markProcessed(jobs);
      return { status: "ignored", replyCount: 0 };
    }

    void this.options.messenger.sendTyping(first.senderId).catch(() => undefined);
    const result = await this.options.brain.reply({
      sessionId,
      text,
      traceId: first.traceId,
      tenantId: first.tenantId,
      pageId: first.pageId,
      conversationId: conversation.conversationId,
      ...this.context(),
    });
    const hasNewerInbound = await this.options.store.hasNewerInboundContent({
      tenantId: first.tenantId,
      pageId: first.pageId,
      externalCustomerId: first.senderId,
      currentEventIds: contentJobs.map((job) => job.eventId),
    });
    if (hasNewerInbound) {
      this.options.chat.discardSession(sessionId);
      this.options.logger.log("info", "meta_reply_superseded", {
        traceId: first.traceId,
        eventCount: contentJobs.length,
        reason: "newer_customer_message_received",
      });
      return { status: "superseded", replyCount: 0 };
    }
    const committed = await this.options.store.commitConversationTurn({
      tenantId: first.tenantId,
      pageId: first.pageId,
      conversationId: conversation.conversationId,
      expectedStateVersion: conversation.stateVersion,
      consultationStage: result.state.consultationStage,
      pipelineTag: result.state.pipeline,
      ...(result.state.signal ? { signalTag: result.state.signal } : {}),
      humanStatus: result.state.botPaused ? "paused" : "bot",
      runtimeState: this.options.chat.exportSession(sessionId) ?? {},
      summary: `${result.state.pipeline} · ${result.state.breakpoint}`.slice(0, 800),
      sourceEventIds: contentJobs.map((job) => job.eventId),
      outbound: {
        idempotencyKey: turnIdempotencyKey,
        recipientId: first.senderId,
        texts: result.replies.slice(0, 2),
      },
    });
    await this.pushCreatedOrder({
      sessionId,
      state: result.state,
    });
    const dispatched = await this.dispatchOutbound(
      first,
      conversation,
      committed.outbound,
      committed.stateVersion,
    );
    if (result.state.botPaused) {
      this.options.logger.log("warn", "customer_automation_suppressed_for_human_review", {
        traceId: first.traceId,
        tenantId: first.tenantId,
        pageId: first.pageId,
        conversationId: conversation.conversationId,
        pipeline: result.state.pipeline,
        signal: result.state.signal,
        humanStatus: "paused",
      });
    }
    if (
      dispatched.lastMessageId &&
      isFollowupEligibleTurn(result.state.lastIntent, result.state.pipeline)
    ) {
      await this.scheduleFollowup({
        tenantId: first.tenantId,
        pageId: first.pageId,
        conversationId: conversation.conversationId,
        stateVersion: committed.stateVersion,
        anchorOutboundMessageId: dispatched.lastMessageId,
      });
    }
    return {
      status: result.state.botPaused || dispatched.suppressed ? "paused" : "replied",
      replyCount: dispatched.count,
    };
  }

  private context(): {
    identity: { salutation: "anh/chị"; staffFirstName: string };
    openingVariantId: OpeningVariantId;
    orderConfirmationMode: "inbox";
  } {
    return {
      identity: {
        salutation: "anh/chị",
        staffFirstName: this.options.staffName,
      },
      openingVariantId: this.options.openingVariantId,
      orderConfirmationMode: "inbox",
    };
  }

  private async pushCreatedOrder(input: { sessionId: string; state: unknown }): Promise<void> {
    if (!this.options.orderInbox || !input.state || typeof input.state !== "object") return;
    const state = input.state as {
      pipeline?: string;
      orderFlowStatus?: string;
      orderDraft?: OrderDraft;
      order?: OrderDraft;
    };
    const draft = state.orderDraft ?? state.order;
    const created = state.orderFlowStatus === "created" || state.pipeline === "6.Đã tạo đơn";
    if (!created || !draft?.customerConfirmedAt) return;
    const confirmedAt =
      draft.customerConfirmedAt instanceof Date
        ? draft.customerConfirmedAt
        : new Date(draft.customerConfirmedAt);
    if (Number.isNaN(confirmedAt.getTime())) throw new Error("invalid_order_confirmation_timestamp");
    await this.options.orderInbox.push({
      sessionId: input.sessionId,
      channel: "meta",
      draft,
      confirmedAt,
    });
    this.options.logger.log("info", "order_inbox_recorded", {
      sessionId: input.sessionId,
      confirmedAt: confirmedAt.toISOString(),
    });
  }

  private async dispatchOutbound(
    job: MetaInboundJob,
    conversation: MessengerConversation,
    plan: ConversationOutboundPlan,
    expectedStateVersion: number,
  ): Promise<{ count: number; lastMessageId?: string; suppressed: boolean }> {
    if (!plan) return { count: 0, suppressed: false };
    let sentThisAttempt = 0;
    let lastMessageId = plan.lastMessageId;
    let suppressed = false;
    for (let index = plan.sentCount; index < plan.texts.length; index += 1) {
      const dispatchCurrent = await this.options.store.canDispatchConversationOutbound({
        tenantId: job.tenantId,
        conversationId: conversation.conversationId,
        expectedStateVersion,
      });
      if (!dispatchCurrent) {
        suppressed = true;
        this.options.logger.log("info", "meta_outbound_suppressed_by_human_takeover", {
          traceId: job.traceId,
          conversationId: conversation.conversationId,
          remainingParts: plan.texts.length - index,
        });
        break;
      }
      const text = plan.texts[index]!;
      const outbound = await this.options.messenger.sendText({
        recipientId: plan.recipientId,
        text,
        idempotencyKey: `${plan.idempotencyKey}:part:${index + 1}`,
      });
      if (!outbound.ok) {
        const error = new Error(outbound.message);
        error.name = outbound.retryable ? "RetryableMetaSendError" : "MetaSendError";
        throw error;
      }
      await this.options.store.persistConversationMessage({
        tenantId: job.tenantId,
        pageId: job.pageId,
        conversationId: conversation.conversationId,
        externalMessageId: outbound.value.messageId,
        direction: "outbound",
        kind: "text",
        text,
        payload: {
          sourceEventIds: plan.sourceEventIds,
          part: index + 1,
          totalParts: plan.texts.length,
        },
      });
      sentThisAttempt += 1;
      lastMessageId = outbound.value.messageId;
      await this.options.store.markConversationTurnOutboundSent({
        tenantId: job.tenantId,
        outboxId: plan.outboxId,
        sentCount: index + 1,
        messageId: outbound.value.messageId,
      });
    }
    return {
      count: sentThisAttempt,
      suppressed,
      ...(lastMessageId ? { lastMessageId } : {}),
    };
  }

  private async scheduleFollowup(
    input: Omit<FollowupCycleSchedule, "anchorSentAt">,
  ): Promise<void> {
    if (!this.options.followups) return;
    const scheduled = await this.options.followups.scheduleCycle({
      ...input,
      anchorSentAt: new Date(),
    });
    this.options.logger.log("info", scheduled.created ? "followup_cycle_scheduled" : "followup_cycle_exists", {
      conversationId: input.conversationId,
      cycleId: scheduled.cycleId,
      anchorOutboundMessageId: input.anchorOutboundMessageId,
    });
  }

  private async markProcessed(jobs: readonly MetaInboundJob[]): Promise<void> {
    for (const job of jobs) {
      await this.options.store.markInboundProcessed({
        tenantId: job.tenantId,
        pageId: job.pageId,
        externalEventId: job.eventId,
      });
    }
  }
}

const FOLLOWUP_PRICE_INTENTS = new Set([
  "price_request",
  "price_change",
  "promotion_inquiry",
  "price_objection",
  "negotiation",
]);

function isFollowupEligiblePipeline(pipeline: string): boolean {
  return pipeline === "3.Đã báo giá" || pipeline === "4.XL băn khoăn";
}

function isFollowupEligibleTurn(intent: string | undefined, pipeline: string): boolean {
  return Boolean(intent && FOLLOWUP_PRICE_INTENTS.has(intent) && isFollowupEligiblePipeline(pipeline));
}

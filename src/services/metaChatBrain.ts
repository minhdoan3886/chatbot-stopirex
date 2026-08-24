import { retrieveKnowledgeMatches } from "../domain/knowledge.js";
import { governCustomerResponse } from "../domain/responseGovernor.js";
import {
  missingRequiredAnswerTopics,
  requiredAnswerTopics,
  type RequiredAnswerTopic,
} from "../domain/requiredAnswerTopics.js";
import { stopirexApprovedKnowledge } from "../domain/stopirexKnowledge.js";
import { tenantId, type TenantId } from "../domain/types.js";
import {
  compareActionRollout,
  selectActionExecutionMode,
  type ActionRolloutComparison,
  type MultiActionRolloutMode,
} from "../domain/actionRollout.js";
import type { SemanticUnderstanding } from "../domain/consultation.js";
import type { SupportedOrderQuantity } from "../domain/conversationActions.js";
import type { ConversationIdentity, OpeningVariantId } from "../domain/sales.js";
import {
  CodexLlmBridge,
  repairMissingKnowledgeCitations,
  requiresKnowledgeGrounding,
  type ApprovedKnowledgeContext,
} from "./codexLlm.js";
import type { StructuredLogger } from "./logger.js";
import {
  DemoChatService,
  isCompoundOrderUpdateQuestion,
  isDomesticDeliveryEtaQuestion,
  isInternalSystemProbe,
  isInternationalShippingQuestion,
  isLikelyAdministrativeFragment,
  isOutOfScopeAssistantProbe,
  isOrderCaptureMessage,
  isQuantityShippingPolicyQuestion,
  isWholesaleDealerInquiry,
  type DemoChatResponse,
  type DemoChatState,
} from "./demoChat.js";

const liveKnowledgeTenant = tenantId("stopirex-meta");
const liveKnowledge = stopirexApprovedKnowledge(liveKnowledgeTenant);

export class MetaChatBrain {
  constructor(
    private readonly chat: DemoChatService,
    private readonly llm: CodexLlmBridge,
    private readonly logger?: StructuredLogger,
    private readonly rollout: {
      mode: MultiActionRolloutMode;
      canaryPercent: number;
      record?: (
        comparison: ActionRolloutComparison & {
          traceId?: string;
          sessionId: string;
          tenantId: TenantId;
          pageId: string;
          conversationId: string;
        },
      ) => Promise<void> | void;
    } = { mode: "enabled", canaryPercent: 100 },
  ) {}

  async reply(input: {
    sessionId: string;
    text: string;
    traceId?: string;
    tenantId?: TenantId;
    pageId?: string;
    conversationId?: string;
    identity?: ConversationIdentity;
    openingVariantId?: OpeningVariantId;
  }): Promise<DemoChatResponse> {
    const context = {
      ...(input.identity ? { identity: input.identity } : {}),
      ...(input.openingVariantId ? { openingVariantId: input.openingVariantId } : {}),
    };
    const before = this.chat.peek(input.sessionId);
    const fastTransition = !this.llm.enabled || isFastTransition(input.text, before);
    let interpreted: SemanticUnderstanding = { slots: {} };
    let knowledge: ApprovedKnowledgeContext[] = [];
    let interpretationStatus: "not_run" | "interpreted" | "fallback" | "skipped" | "unavailable" = "not_run";
    let interpretationReason: string | undefined;
    if (!fastTransition) {
      const matches = retrieveKnowledgeMatches({
        tenantId: liveKnowledgeTenant,
        query: contextualKnowledgeQuery(input.text, before),
        entities: liveKnowledge,
        limit: 3,
      });
      knowledge = matches.map(({ entity: { id, title, content, responseGuidance } }) => ({
        id,
        title,
        content,
        ...(responseGuidance ? { responseGuidance } : {}),
      }));
      const rawLlmResult = await this.llm.interpret({
        customerMessage: input.text,
        state: before,
        knowledge,
      });
      const retrievedIds = new Set(knowledge.map((entity) => entity.id));
      const validCitations = (rawLlmResult.knowledgeIds ?? []).filter((id) => retrievedIds.has(id));
      const citationCandidates = rawLlmResult.draftReply
        ? retrieveKnowledgeMatches({
            tenantId: liveKnowledgeTenant,
            query: rawLlmResult.draftReply,
            entities: liveKnowledge,
            limit: 3,
          })
            .map((match) => match.entity.id)
            .filter((id) => retrievedIds.has(id))
        : [];
      const withoutRawCitations = { ...rawLlmResult };
      delete withoutRawCitations.knowledgeIds;
      const groundedLlmResult =
        validCitations.length > 0
          ? { ...rawLlmResult, knowledgeIds: validCitations }
          : repairMissingKnowledgeCitations(withoutRawCitations, citationCandidates);
      const llmResult = reconcileKnowledgeBackedPopulationSafety(
        groundedLlmResult,
        matches[0]?.entity.id,
      );
      interpreted = llmResult;
      interpretationStatus = llmResult.status;
      interpretationReason = llmResult.reason;
      this.logger?.log(llmResult.status === "interpreted" ? "debug" : "warn", "llm_interpretation", {
        ...(input.traceId ? { traceId: input.traceId } : {}),
        status: llmResult.status,
        reason: llmResult.reason,
        latencyMs: llmResult.latencyMs,
        provider: llmResult.provider,
        model: llmResult.model,
        intent: llmResult.intent,
        topic: llmResult.topic,
        confidence: llmResult.confidence,
        actionCount: llmResult.actions?.length ?? 0,
        actions: llmResult.actions?.map((action) => action.type) ?? [],
        uncertaintyCount: llmResult.uncertainties?.length ?? 0,
        retrievedKnowledge: matches.map((match) => ({
          id: match.entity.id,
          score: match.score,
          concepts: match.matchedConcepts,
        })),
        citedKnowledgeIds: llmResult.knowledgeIds ?? [],
        unsupportedQuestionCount: llmResult.unsupportedQuestions?.length ?? 0,
        groundingConfidence: llmResult.groundingConfidence,
      });
    }
    const liveVariant = selectActionExecutionMode({
      mode: this.rollout.mode,
      canaryPercent: this.rollout.canaryPercent,
      sessionId: input.sessionId,
    });
    const snapshotBefore = this.chat.exportSession(input.sessionId);
    const base = this.chat.chat(input.sessionId, input.text, interpreted, {
      ...context,
      actionExecutionMode: liveVariant,
    });
    if (this.rollout.mode !== "enabled") {
      const alternateVariant = liveVariant === "multi_action" ? "legacy" : "multi_action";
      const alternateChat = new DemoChatService();
      if (snapshotBefore) {
        alternateChat.restoreSession(input.sessionId, snapshotBefore, context);
      }
      const alternate = alternateChat.chat(input.sessionId, input.text, interpreted, {
        ...context,
        actionExecutionMode: alternateVariant,
      });
      const legacy = liveVariant === "legacy" ? base : alternate;
      const candidate = liveVariant === "multi_action" ? base : alternate;
      const comparison = compareActionRollout({
        mode: this.rollout.mode,
        liveVariant,
        legacy,
        candidate,
      });
      this.logger?.log("info", "multi_action_rollout_comparison", {
        ...(input.traceId ? { traceId: input.traceId } : {}),
        sessionId: input.sessionId,
        mode: comparison.mode,
        liveVariant,
        intentMismatch: comparison.intentMismatch,
        pipelineMismatch: comparison.pipelineMismatch,
        handoffMismatch: comparison.handoffMismatch,
        clarificationMismatch: comparison.clarificationMismatch,
        rejectedActionCount: comparison.rejectedActionCount,
        conflictCount: comparison.conflictCount,
      });
      if (input.tenantId && input.pageId && input.conversationId) {
        await this.rollout.record?.({
          ...comparison,
          ...(input.traceId ? { traceId: input.traceId } : {}),
          sessionId: input.sessionId,
          tenantId: input.tenantId,
          pageId: input.pageId,
          conversationId: input.conversationId,
        });
      }
    }
    if (fastTransition) return base;
    const composed = this.llm.adoptInterpretedDraft({
      customerMessage: input.text,
      ...(interpreted.draftReply ? { draftReply: interpreted.draftReply } : {}),
      baseReply: base.reply,
      baseReplies: base.replies,
      actions: interpreted.actions ?? [],
      state: base.state,
      ...(base.state.activeSkill ? { skillId: base.state.activeSkill } : {}),
      knowledge,
      ...(interpreted.knowledgeIds ? { knowledgeIds: interpreted.knowledgeIds } : {}),
      ...(interpreted.unsupportedQuestions ? { unsupportedQuestions: interpreted.unsupportedQuestions } : {}),
      ...(interpreted.groundingConfidence !== undefined
        ? { groundingConfidence: interpreted.groundingConfidence }
        : {}),
      knowledgeGroundingRequired:
        requiresKnowledgeGrounding(base.state.decisionTrace?.selectedIntent) ||
        Boolean(
          interpreted.knowledgeIds?.length &&
          interpreted.actions?.some((action) => action.type === "answer_question"),
        ),
    });
    this.logger?.log(composed.status === "enhanced" ? "debug" : "warn", "llm_composition", {
      ...(input.traceId ? { traceId: input.traceId } : {}),
      status: composed.status,
      reason: composed.reason,
      latencyMs: composed.latencyMs,
      provider: composed.provider,
      model: composed.model,
      selectedRoute: base.state.decisionTrace?.selectedRoute,
      selectedIntent: base.state.decisionTrace?.selectedIntent,
    });
    const coverage = assessQuestionCoverage({
      customerMessage: input.text,
      interpretationStatus,
      interpreted,
      compositionStatus: composed.status,
      base,
      orderSelectionChanged: before.selectedQuantity !== base.state.selectedQuantity,
      candidateReply: composed.status === "enhanced" ? composed.reply : base.reply,
    });
    if (!coverage.complete) {
      const groundedBaseCoverage = assessQuestionCoverage({
        customerMessage: input.text,
        interpretationStatus,
        interpreted,
        compositionStatus: composed.status,
        base,
        orderSelectionChanged: before.selectedQuantity !== base.state.selectedQuantity,
        candidateReply: base.reply,
      });
      if (groundedBaseCoverage.complete) {
        this.logger?.log("warn", "question_coverage_recovered_by_grounded_base", {
          ...(input.traceId ? { traceId: input.traceId } : {}),
          requiredTopics: coverage.requiredTopics,
          missingTopics: coverage.missingTopics,
          compositionStatus: composed.status,
        });
        return base;
      }
      const replies = questionCoverageFallbackReplies(base.state.selectedQuantity);
      const state = this.chat.replaceLatestAssistantTurnsAndPauseForCoverage(
        input.sessionId,
        base.replies,
        replies,
        `Còn ${coverage.missingCount} câu hỏi chưa được phản hồi (${coverage.reason})`,
      );
      this.logger?.log("warn", "question_coverage_blocked", {
        ...(input.traceId ? { traceId: input.traceId } : {}),
        questionCount: coverage.questionCount,
        coveredCount: coverage.coveredCount,
        missingCount: coverage.missingCount,
        reason: coverage.reason,
        requiredTopics: coverage.requiredTopics,
        missingTopics: coverage.missingTopics,
        interpretationStatus,
        interpretationReason,
        compositionStatus: composed.status,
        selectedQuantity: base.state.selectedQuantity,
      });
      return {
        ...base,
        reply: replies.join("\n\n"),
        replies,
        state,
      };
    }
    if (
      composed.status === "enhanced" &&
      interpreted.unsupportedQuestions?.length &&
      base.state.selectedQuantity
    ) {
      const replies = [
        interpreted.draftReply?.trim() || composed.reply,
        `Dạ em đã ghi nhận mình muốn lấy ${quantityLabel(base.state.selectedQuantity)} ạ.`,
      ];
      const state = this.chat.replaceLatestAssistantTurnsAndPauseForCoverage(
        input.sessionId,
        base.replies,
        replies,
        `Cần xác minh: ${interpreted.unsupportedQuestions.join(" | ")}`,
      );
      this.logger?.log("warn", "unsupported_question_handoff", {
        ...(input.traceId ? { traceId: input.traceId } : {}),
        unsupportedQuestionCount: interpreted.unsupportedQuestions.length,
        selectedQuantity: base.state.selectedQuantity,
      });
      return {
        ...base,
        reply: replies.join("\n\n"),
        replies,
        state,
      };
    }
    if (composed.status !== "enhanced" || composed.reply === base.reply) {
      return base;
    }
    if (base.state.decisionTrace && interpreted.knowledgeIds) {
      const retrievedIds = new Set(knowledge.map((entity) => entity.id));
      base.state.decisionTrace.knowledgeEntityIds = [
        ...new Set([
          ...base.state.decisionTrace.knowledgeEntityIds,
          ...interpreted.knowledgeIds.filter((id) => retrievedIds.has(id)),
        ]),
      ];
    }
    const governed = governCustomerResponse({
      replies: [composed.reply],
      answeredTopics: base.state.answeredTopics,
      previouslyAskedTopics: base.state.askedTopics,
      maxCharacters: 360,
      maxBubbles: 2,
      preserveFullText:
        base.state.mode === "care" || Boolean(base.state.selectedQuantity) || Boolean(base.state.orderId),
    });
    if (governed.replies.length === 0) return base;
    const state = this.chat.replaceLatestAssistantTurns(input.sessionId, base.replies, governed.replies);
    return {
      ...base,
      reply: governed.replies.join("\n\n"),
      replies: governed.replies,
      state,
    };
  }
}

export function reconcileKnowledgeBackedPopulationSafety<T extends SemanticUnderstanding>(
  semantic: T,
  primaryRetrievedKnowledgeId?: string,
): T {
  if (!semantic.actions?.some((action) => action.type === "answer_question")) {
    return semantic;
  }

  const citedPopulationTopics = [
    ["audience-pregnancy", "pregnancy"],
    ["audience-breastfeeding", "breastfeeding"],
  ] as const;
  const cited = citedPopulationTopics.filter(([knowledgeId]) =>
    semantic.knowledgeIds?.includes(knowledgeId),
  );
  // A citation has already been validated against the retrieved Knowledge set
  // (or repaired from the grounded draft). Prefer that explicit LLM choice over
  // the first retrieval match, which can be a nearby population policy because
  // the two approved answers intentionally share most of their wording.
  const supported =
    cited.length > 0
      ? cited
      : citedPopulationTopics.filter(
          ([knowledgeId]) => primaryRetrievedKnowledgeId === knowledgeId,
        );
  if (supported.length !== 1) return semantic;

  const topic = supported[0]?.[1];
  if (!topic) return semantic;
  const reconciled: T = { ...semantic };
  delete reconciled.draftReply;
  delete reconciled.replyTo;
  reconciled.skill = "safety-first";
  reconciled.intent = "safety";
  reconciled.topic = topic;
  reconciled.subject = "customer";
  reconciled.affirmation = false;
  // A grounded special-population safety question must be answered before any
  // order collection. Drop simultaneous handoff/order proposals; the state
  // planner will pause the existing order and leave it available to resume.
  reconciled.actions = semantic.actions
    .filter((action) => action.type === "answer_question")
    .map((action) =>
      action.type === "answer_question"
        ? { ...action, topic }
        : action,
    );
  reconciled.unsupportedQuestions = [];
  return reconciled;
}

type QuestionCoverageAssessment = {
  complete: boolean;
  questionCount: number;
  coveredCount: number;
  missingCount: number;
  reason: string;
  requiredTopics: RequiredAnswerTopic[];
  missingTopics: RequiredAnswerTopic[];
};

export function extractCustomerQuestionClauses(value: string): string[] {
  const parts = value.split(/[?？]+/u);
  if (parts.length <= 1) return [];
  return parts
    .slice(0, -1)
    .map((part) => {
      const sentences = part
        .split(/[.!。\n]+/u)
        .map((item) => item.trim())
        .filter(Boolean);
      return sentences.at(-1) ?? "";
    })
    .filter(Boolean)
    .slice(0, 6);
}

function assessQuestionCoverage(input: {
  customerMessage: string;
  interpretationStatus: "not_run" | "interpreted" | "fallback" | "skipped" | "unavailable";
  interpreted: SemanticUnderstanding;
  compositionStatus: "enhanced" | "fallback" | "skipped" | "unavailable";
  base: DemoChatResponse;
  orderSelectionChanged: boolean;
  candidateReply: string;
}): QuestionCoverageAssessment {
  const questionCount = extractCustomerQuestionClauses(input.customerMessage).length;
  const requiredTopics = requiredAnswerTopics(input.customerMessage);
  const missingTopics = missingRequiredAnswerTopics(input.customerMessage, input.candidateReply);
  const enforced = questionCount >= 1;
  if (!enforced) {
    return {
      complete: true,
      questionCount,
      coveredCount: questionCount,
      missingCount: 0,
      reason: "not_required",
      requiredTopics,
      missingTopics,
    };
  }

  if (missingTopics.length > 0) {
    return {
      complete: false,
      questionCount,
      coveredCount: Math.max(0, questionCount - missingTopics.length),
      missingCount: missingTopics.length,
      reason: "required_fact_topic_missing",
      requiredTopics,
      missingTopics,
    };
  }

  const clauses = extractCustomerQuestionClauses(input.customerMessage);
  const coverageUnits = [
    ...(input.interpreted.actions ?? [])
      .filter((action) => action.type === "answer_question")
      .map((action) => action.evidence.join(" ")),
    ...(input.interpreted.unsupportedQuestions ?? []),
  ].filter(Boolean);
  const actionCoveredCount =
    input.interpretationStatus === "interpreted" && input.compositionStatus === "enhanced"
      ? matchedQuestionClauseCount(clauses, coverageUnits)
      : 0;
  const responseCoveredCount = clauses.filter(
    (clause) => coverageOverlap(clause, input.candidateReply) >= 0.15,
  ).length;
  const groundedBaseCoveredCount = input.base.state.decisionTrace?.knowledgeEntityIds.length
    ? responseCoveredCount
    : 0;
  // The LLM is still called first for product questions. If it returns only a
  // semantic classification, a deterministic response grounded in approved KB
  // may pass — but only when the actual reply covers every customer question.
  // This keeps timeout/multi-intent omissions fail-closed.
  const coveredCount = Math.max(
    Math.min(actionCoveredCount, responseCoveredCount),
    groundedBaseCoveredCount,
  );
  const missingCount = Math.max(0, questionCount - coveredCount);
  return {
    complete: missingCount === 0,
    questionCount,
    coveredCount,
    missingCount,
    reason:
      input.interpretationStatus !== "interpreted"
        ? `interpretation_${input.interpretationStatus}`
        : input.compositionStatus !== "enhanced"
          ? `composition_${input.compositionStatus}`
          : "incomplete_action_coverage",
    requiredTopics,
    missingTopics,
  };
}

function coverageOverlap(question: string, reply: string): number {
  const questionTerms = meaningfulCoverageTerms(question);
  const replyTerms = meaningfulCoverageTerms(reply);
  if (questionTerms.size === 0) return 1;
  const overlap = [...questionTerms].filter((term) => replyTerms.has(term)).length;
  return overlap / questionTerms.size;
}

function matchedQuestionClauseCount(clauses: readonly string[], coverageUnits: readonly string[]): number {
  const remaining = new Set(coverageUnits.map((_, index) => index));
  let matched = 0;
  for (const clause of clauses) {
    const clauseTerms = meaningfulCoverageTerms(clause);
    let bestIndex: number | undefined;
    let bestScore = 0;
    for (const index of remaining) {
      const unitTerms = meaningfulCoverageTerms(coverageUnits[index] ?? "");
      const overlap = [...clauseTerms].filter((term) => unitTerms.has(term)).length;
      const score = clauseTerms.size > 0 ? overlap / clauseTerms.size : 0;
      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    }
    if (bestIndex !== undefined && bestScore >= 0.15) {
      remaining.delete(bestIndex);
      matched += 1;
    }
  }
  return matched;
}

function meaningfulCoverageTerms(value: string): Set<string> {
  const stop = new Set([
    "anh",
    "chi",
    "em",
    "minh",
    "shop",
    "cho",
    "hoi",
    "nay",
    "kia",
    "thi",
    "la",
    "co",
    "khong",
    "duoc",
    "luon",
    "vay",
    "nhe",
    "nha",
    "mot",
    "cai",
    "phan",
  ]);
  return new Set(
    value
      .toLocaleLowerCase("vi-VN")
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .replace(/đ/gu, "d")
      .replace(/[^a-z0-9]+/gu, " ")
      .trim()
      .split(" ")
      .filter((term) => term.length > 1 && !stop.has(term)),
  );
}

function questionCoverageFallbackReplies(quantity: SupportedOrderQuantity | undefined): string[] {
  return [
    ...(quantity ? [`Dạ em đã ghi nhận mình muốn lấy ${quantityLabel(quantity)} ạ.`] : []),
    "Em chưa có đủ thông tin đã được xác nhận để trả lời trọn các phần mình vừa hỏi. Em chuyển bộ phận liên quan kiểm tra rồi phản hồi mình ạ.",
  ].slice(0, 2);
}

function quantityLabel(quantity: SupportedOrderQuantity): string {
  return quantity === 1 ? "1 lọ" : `combo ${quantity} lọ`;
}

export function isFastTransition(customerMessage: string, state: DemoChatState): boolean {
  if (state.mode === "care") {
    // Flow CSKH có thể thu SĐT và thông tin nhận hoàn tiền; giữ dữ liệu
    // trong state machine nội bộ, không gửi các lượt này sang LLM.
    return true;
  }
  const text = customerMessage
    .toLocaleLowerCase("vi-VN")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/đ/g, "d")
    .replace(/\s+/gu, " ")
    .trim();
  if (
    isInternalSystemProbe(customerMessage) ||
    isInternationalShippingQuestion(customerMessage) ||
    isOutOfScopeAssistantProbe(customerMessage) ||
    isWholesaleDealerInquiry(customerMessage) ||
    isDomesticDeliveryEtaQuestion(customerMessage) ||
    isQuantityShippingPolicyQuestion(customerMessage) ||
    isOrderCaptureMessage(customerMessage) ||
    (Boolean(state.selectedQuantity) && isCompoundOrderUpdateQuestion(customerMessage))
  ) {
    return true;
  }
  if (
    state.pendingAction === "choose_quantity" &&
    /^(?:1|2|1 lo|2 lo|mot lo|hai lo|combo)(?: a| nhe| nha)?$/.test(text)
  ) {
    return true;
  }
  if (
    state.pendingAction === "confirm_order" &&
    /^(?:dung|dung roi|dong y|toi dong y|xac nhan dong y)$/.test(text)
  ) {
    return true;
  }
  if (
    state.selectedQuantity &&
    state.orderMissing.length > 0 &&
    !/[?？]/u.test(customerMessage) &&
    !/\b(?:gia|giam|khuyen mai|uu dai|ma giam|voucher|ship|freeship|free ship|phi giao)\b/.test(text) &&
    (/(?<!\d)0\d{9}(?!\d)/u.test(customerMessage) ||
      /\b(?:ten nguoi nhan|sdt|so dien thoai|dia chi|phuong|xa|thi tran|quan|huyen|thi xa|tinh|thanh pho)\b/.test(
        text,
      ) ||
      (/\d/u.test(customerMessage) && customerMessage.trim().length >= 5) ||
      isLikelyAdministrativeFragment(customerMessage))
  ) {
    // Dữ liệu tên/SĐT/địa chỉ đang thu đơn được xử lý bằng rule nội bộ;
    // không gửi PII lên LLM và không chờ model timeout.
    return true;
  }
  if (/^(?:gia|bao gia|xin gia|gia bao nhieu|bao nhieu tien)(?: a| nhe| nha)?[?？]?$/.test(text)) {
    return true;
  }
  if (
    /(?:chuong trinh|khuyen mai|uu dai|voucher|ma giam|coupon)/.test(text) &&
    /(?:giam|sale|discount)/.test(text)
  ) {
    return true;
  }
  return /^(?:stop|huy dang ky|khong nhan nua|dung nhan)$/.test(text);
}

function contextualKnowledgeQuery(customerMessage: string, state: DemoChatState): string {
  const normalized = customerMessage
    .toLocaleLowerCase("vi-VN")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/đ/gu, "d")
    .trim();
  const needsPriorContext =
    /^(?:the|vay|con|loai nay|cai nay|no|nhu tren|nhu vay)\b/.test(normalized) ||
    /^(?:da )?(?:ok|okay|oke|uh|u|duoc|dc|co|khong|ko|k|vang)(?: a| nhe)?$/.test(normalized);
  if (!needsPriorContext) return customerMessage;
  const priorCustomerTurns = state.recentTurns
    .filter((turn) => turn.role === "user")
    .slice(-2)
    .map((turn) => turn.text.replace(/(?<!\d)0\d{9}(?!\d)/gu, "[SĐT]"));
  return [...priorCustomerTurns, customerMessage].join("\n");
}

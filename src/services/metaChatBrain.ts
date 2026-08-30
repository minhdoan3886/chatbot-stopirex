import { retrieveKnowledgeMatches, type KnowledgeMatch } from "../domain/knowledge.js";
import { governCustomerResponse, inferAnsweredTopicFromMessage } from "../domain/responseGovernor.js";
import {
  missingRequiredAnswerTopics,
  replyCoversRequiredAnswerTopic,
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
import type { SemanticTopic, SemanticUnderstanding } from "../domain/consultation.js";
import type { SupportedOrderQuantity } from "../domain/conversationActions.js";
import { conversationSkills } from "../domain/chatSkills.js";
import { assertReplyMatchesConversationState } from "../domain/responseConsistency.js";
import type { ConversationIdentity, OpeningVariantId } from "../domain/sales.js";
import {
  CodexLlmBridge,
  isContentFreeCustomerMessage,
  repairMissingKnowledgeCitations,
  requiresKnowledgeGrounding,
  type ApprovedKnowledgeContext,
} from "./codexLlm.js";
import type { StructuredLogger } from "./logger.js";
import {
  DemoChatService,
  isCompoundOrderUpdateQuestion,
  isDomesticDeliveryEtaQuestion,
  isExpressDeliveryQuestion,
  isInternalSystemProbe,
  isInternationalShippingQuestion,
  isLikelyAdministrativeFragment,
  isOutOfScopeAssistantProbe,
  isOrderCaptureMessage,
  isOfflineStoreQuestion,
  isPriorAddressReference,
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
    orderConfirmationMode?: "sandbox" | "inbox";
  }): Promise<DemoChatResponse> {
    const context = {
      ...(input.identity ? { identity: input.identity } : {}),
      ...(input.openingVariantId ? { openingVariantId: input.openingVariantId } : {}),
      ...(input.orderConfirmationMode ? { orderConfirmationMode: input.orderConfirmationMode } : {}),
    };
    const before = this.chat.peek(input.sessionId);
    // Every customer message goes through semantic interpretation when the LLM
    // is available. Order data is still validated mechanically by DemoChat,
    // but it must not hide product questions carried in the same message.
    const fastTransition = !this.llm.enabled;
    let interpreted: SemanticUnderstanding = { slots: {} };
    let knowledge: ApprovedKnowledgeContext[] = [];
    let interpretationStatus: "not_run" | "interpreted" | "fallback" | "skipped" | "unavailable" = "not_run";
    let interpretationReason: string | undefined;
    const contentFreeMessage = isContentFreeCustomerMessage(input.text);
    if (!fastTransition) {
      let matches = contentFreeMessage
        ? []
        : retrieveKnowledgeMatches({
            tenantId: liveKnowledgeTenant,
            query: knowledgeSafeQuery(contextualKnowledgeQuery(input.text, before)),
            entities: liveKnowledge,
            // Compound customer messages need breadth. The retriever keeps a leader
            // for every detected concept, while the LLM remains the semantic owner.
            limit: 6,
          });
      knowledge = knowledgeContexts(matches);
      let rawLlmResult = await this.llm.interpret({
        customerMessage: input.text,
        state: before,
        knowledge,
      });
      let knowledgeRetry = false;
      const semanticQueries = semanticKnowledgeQueries(rawLlmResult);
      if (
        !contentFreeMessage &&
        semanticQueries.length > 0 &&
        needsSemanticKnowledgeExpansion(rawLlmResult)
      ) {
        const expandedMatches = semanticQueries.flatMap((query) =>
          retrieveKnowledgeMatches({
            tenantId: liveKnowledgeTenant,
            query,
            entities: liveKnowledge,
            limit: 3,
          }),
        );
        const mergedMatches = mergeKnowledgeMatches(matches, expandedMatches, 8);
        const previousIds = matches.map((match) => match.entity.id).join("|");
        const mergedIds = mergedMatches.map((match) => match.entity.id).join("|");
        if (mergedIds !== previousIds) {
          matches = mergedMatches;
          knowledge = knowledgeContexts(matches);
          rawLlmResult = await this.llm.interpret({
            customerMessage: input.text,
            state: before,
            knowledge,
          });
          knowledgeRetry = true;
        }
      }
      if (contentFreeMessage) {
        rawLlmResult = reconcileContentFreeInterpretation(rawLlmResult);
      }
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
      const llmResult = reconcilePendingConsultationAnswer(
        reconcileKnowledgeBackedPopulationSafety(groundedLlmResult, matches[0]?.entity.id),
        before,
        input.text,
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
        actionTopics:
          llmResult.actions
            ?.filter((action) => action.type === "answer_question")
            .map((action) => action.topic) ?? [],
        uncertaintyCount: llmResult.uncertainties?.length ?? 0,
        retrievedKnowledge: matches.map((match) => ({
          id: match.entity.id,
          score: match.score,
          concepts: match.matchedConcepts,
        })),
        citedKnowledgeIds: llmResult.knowledgeIds ?? [],
        unsupportedQuestionCount: llmResult.unsupportedQuestions?.length ?? 0,
        groundingConfidence: llmResult.groundingConfidence,
        knowledgeRetry,
        semanticKnowledgeQueryCount: semanticQueries.length,
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
    if (
      base.state.decisionTrace?.selectedRoute === "start_care" ||
      base.state.decisionTrace?.selectedRoute === "active_care"
    ) {
      // A reconciled CSKH transition is already the complete, safe response.
      // Composition and question-coverage recovery must not replace the
      // acknowledgement with a generic knowledge/handoff fallback.
      this.logger?.log("debug", "llm_composition", {
        ...(input.traceId ? { traceId: input.traceId } : {}),
        status: "skipped",
        reason: "customer_care_route_locked",
        selectedRoute: base.state.decisionTrace.selectedRoute,
        selectedCareIssue: base.state.decisionTrace.selectedCareIssue,
      });
      return base;
    }
    let composed = this.llm.adoptInterpretedDraft({
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
      softStylePolicy: "warn",
    });
    if (composed.status !== "enhanced" && interpreted.draftReply?.trim()) {
      composed = await this.llm.repairInterpretedDraft({
        customerMessage: input.text,
        rejectedDraft: interpreted.draftReply,
        violations: [composed.reason ?? "draft_validation_failed"],
        baseReply: base.reply,
        state: base.state,
        actions: base.state.decisionTrace?.actionPlan?.accepted ?? [],
        ...(base.state.activeSkill ? { skillId: base.state.activeSkill } : {}),
        knowledge,
        ...(interpreted.knowledgeIds ? { knowledgeIds: interpreted.knowledgeIds } : {}),
      });
    }
    if (contentFreeMessage && composed.status !== "enhanced") {
      const reply = contentFreeMessageFallbackReply();
      const replies = [reply];
      const state = this.chat.replaceLatestAssistantTurns(input.sessionId, base.replies, replies);
      this.logger?.log("warn", "content_free_message_fallback", {
        ...(input.traceId ? { traceId: input.traceId } : {}),
        interpretationStatus,
        compositionStatus: composed.status,
        compositionReason: composed.reason,
      });
      return { ...base, reply, replies, state };
    }
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
    let coverage = assessQuestionCoverage({
      customerMessage: input.text,
      interpretationStatus,
      interpreted,
      compositionStatus: composed.status,
      base,
      orderSelectionChanged: before.selectedQuantity !== base.state.selectedQuantity,
      candidateReply: composed.status === "enhanced" ? composed.reply : base.reply,
    });
    if (!coverage.complete && composed.status === "enhanced") {
      const repaired = await this.llm.repairInterpretedDraft({
        customerMessage: input.text,
        rejectedDraft: composed.reply,
        violations: [`missing_topics:${coverage.missingTopics.join(",")}`, coverage.reason],
        baseReply: base.reply,
        state: base.state,
        actions: base.state.decisionTrace?.actionPlan?.accepted ?? [],
        ...(base.state.activeSkill ? { skillId: base.state.activeSkill } : {}),
        knowledge,
        ...(interpreted.knowledgeIds ? { knowledgeIds: interpreted.knowledgeIds } : {}),
      });
      if (repaired.status === "enhanced") {
        const repairedCoverage = assessQuestionCoverage({
          customerMessage: input.text,
          interpretationStatus,
          interpreted,
          compositionStatus: repaired.status,
          base,
          orderSelectionChanged: before.selectedQuantity !== base.state.selectedQuantity,
          candidateReply: repaired.reply,
        });
        if (repairedCoverage.complete) {
          composed = repaired;
          coverage = repairedCoverage;
          this.logger?.log("debug", "llm_composition_repaired", {
            ...(input.traceId ? { traceId: input.traceId } : {}),
            requiredTopics: coverage.requiredTopics,
          });
        }
      }
    }
    if (!coverage.complete && composed.status === "enhanced") {
      // Coverage is advisory after the LLM has already passed all hard claim,
      // commerce, action and state guards. Do not replace a relevant answer
      // with a generic workflow sentence merely because a lexical topic check
      // could not prove every clause was covered.
      this.logger?.log("warn", "question_coverage_soft_warning", {
        ...(input.traceId ? { traceId: input.traceId } : {}),
        requiredTopics: coverage.requiredTopics,
        missingTopics: coverage.missingTopics,
        reason: coverage.reason,
      });
    }
    if (!coverage.complete && composed.status !== "enhanced") {
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
      const approvedRecovery = this.chat.approvedKnowledgeFallback(input.text, interpreted.slots);
      if (approvedRecovery) {
        const recoveryCoverage = assessQuestionCoverage({
          customerMessage: input.text,
          interpretationStatus,
          interpreted,
          compositionStatus: composed.status,
          base,
          orderSelectionChanged: before.selectedQuantity !== base.state.selectedQuantity,
          candidateReply: approvedRecovery.reply,
        });
        if (recoveryCoverage.complete) {
          const replies = [approvedRecovery.reply];
          const state = this.chat.replaceLatestAssistantTurns(input.sessionId, base.replies, replies);
          this.logger?.log("warn", "question_coverage_recovered_by_approved_knowledge", {
            ...(input.traceId ? { traceId: input.traceId } : {}),
            requiredTopics: coverage.requiredTopics,
            compositionStatus: composed.status,
            knowledgeIds: approvedRecovery.knowledgeIds,
          });
          return {
            ...base,
            reply: approvedRecovery.reply,
            replies,
            state,
          };
        }
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
    const activeSkill = base.state.activeSkill ? conversationSkills[base.state.activeSkill] : undefined;
    const responseCharacterBudget = activeSkill?.maxCharacters ?? 360;
    const responseBubbleBudget = activeSkill?.maxBubbles ?? 2;
    let governed = governCustomerResponse({
      replies: [composed.reply],
      answeredTopics: base.state.answeredTopics,
      previouslyAskedTopics: base.state.askedTopics,
      maxCharacters: responseCharacterBudget,
      maxBubbles: responseBubbleBudget,
      preserveFullText:
        responseCharacterBudget > 360 ||
        base.state.mode === "care" ||
        Boolean(base.state.selectedQuantity) ||
        Boolean(base.state.orderId) ||
        requiredAnswerTopics(input.text).length >= 2 ||
        semanticAnswerTopics(interpreted, input.text).length >= 3,
    });
    const governedCoverage = assessQuestionCoverage({
      customerMessage: input.text,
      interpretationStatus,
      interpreted,
      compositionStatus: composed.status,
      base,
      orderSelectionChanged: before.selectedQuantity !== base.state.selectedQuantity,
      candidateReply: governed.replies.join("\n\n"),
    });
    if (!governedCoverage.complete && governed.truncated) {
      // Never trade correctness for the character budget. If compaction drops
      // a customer topic, retain the full answer and only merge bubbles.
      const untruncated = governCustomerResponse({
        replies: [composed.reply],
        answeredTopics: base.state.answeredTopics,
        previouslyAskedTopics: base.state.askedTopics,
        maxBubbles: 2,
        preserveFullText: true,
      });
      const untruncatedCoverage = assessQuestionCoverage({
        customerMessage: input.text,
        interpretationStatus,
        interpreted,
        compositionStatus: composed.status,
        base,
        orderSelectionChanged: before.selectedQuantity !== base.state.selectedQuantity,
        candidateReply: untruncated.replies.join("\n\n"),
      });
      if (untruncatedCoverage.complete) governed = untruncated;
    }
    if (governed.replies.length === 0) return base;
    try {
      assertReplyMatchesConversationState({
        reply: governed.replies.join("\n\n"),
        ...(base.state.decisionTrace ? { trace: base.state.decisionTrace } : {}),
        ...(base.state.selectedQuantity ? { selectedQuantity: base.state.selectedQuantity } : {}),
        ...(base.state.orderId ? { orderId: base.state.orderId } : {}),
        botPaused: base.state.botPaused,
        freeShippingApproved: base.state.freeShippingApproved,
      });
    } catch (error) {
      this.logger?.log("warn", "llm_reply_state_mismatch", {
        ...(input.traceId ? { traceId: input.traceId } : {}),
        reason: error instanceof Error ? error.message : "response_state_mismatch",
      });
      return base;
    }
    const state = this.chat.replaceLatestAssistantTurns(input.sessionId, base.replies, governed.replies);
    return {
      ...base,
      reply: governed.replies.join("\n\n"),
      replies: governed.replies,
      state,
    };
  }
}

/**
 * A description supplied in response to the bot's latest discovery question is
 * customer data, not a new question. The model remains responsible for
 * extracting the consultation slots; this reconciliation only prevents a
 * mislabeled `answer_question` action from making the quality gate demand an
 * FAQ-style answer and halt an otherwise valid consultation.
 */
export function reconcilePendingConsultationAnswer<T extends SemanticUnderstanding>(
  semantic: T,
  state: Pick<DemoChatState, "pendingQuestionTopic">,
  customerMessage: string,
): T {
  const pendingTopic = state.pendingQuestionTopic;
  if (
    !pendingTopic ||
    !["work_context", "symptom", "prior_product", "usage", "child_age"].includes(pendingTopic) ||
    !inferAnsweredTopicFromMessage(customerMessage, pendingTopic).includes(pendingTopic) ||
    ![undefined, "consultation", "other"].includes(semantic.intent) ||
    /[?？]/u.test(customerMessage)
  ) {
    return semantic;
  }

  const reconciled: T = { ...semantic, asksDirectAnswer: false };
  const remainingActions = semantic.actions?.filter((action) => action.type !== "answer_question");
  if (remainingActions?.length) reconciled.actions = remainingActions;
  else delete reconciled.actions;
  delete reconciled.draftReply;
  delete reconciled.replyTo;
  delete reconciled.skill;
  return reconciled;
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
  const cited = citedPopulationTopics.filter(([knowledgeId]) => semantic.knowledgeIds?.includes(knowledgeId));
  // A citation has already been validated against the retrieved Knowledge set
  // (or repaired from the grounded draft). Prefer that explicit LLM choice over
  // the first retrieval match, which can be a nearby population policy because
  // the two approved answers intentionally share most of their wording.
  const supported =
    cited.length > 0
      ? cited
      : citedPopulationTopics.filter(([knowledgeId]) => primaryRetrievedKnowledgeId === knowledgeId);
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
    .map((action) => (action.type === "answer_question" ? { ...action, topic } : action));
  reconciled.unsupportedQuestions = [];
  return reconciled;
}

type QuestionCoverageAssessment = {
  complete: boolean;
  questionCount: number;
  coveredCount: number;
  missingCount: number;
  reason: string;
  requiredTopics: (RequiredAnswerTopic | SemanticTopic)[];
  missingTopics: (RequiredAnswerTopic | SemanticTopic)[];
};

export function extractCustomerQuestionClauses(value: string): string[] {
  const explicit = value
    .split(/[?？]+/u)
    .slice(0, -1)
    .map((part) => {
      const sentences = part
        .split(/[.!。\n]+/u)
        .map((item) => item.trim())
        .filter(Boolean);
      return sentences.at(-1) ?? "";
    })
    .filter(Boolean);
  const implicit = value
    .split(/(?:\r?\n|(?<=[.!;])\s+)/u)
    .map((part) => part.trim())
    .filter((part) => part && !/[?？]/u.test(part) && looksLikeImplicitQuestionOrConcern(part));
  return [...new Set([...explicit, ...implicit])].slice(0, 6);
}

function looksLikeImplicitQuestionOrConcern(value: string): boolean {
  const text = value
    .toLocaleLowerCase("vi-VN")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/đ/gu, "d")
    .replace(/[^a-z0-9]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  if (!text || /(?<!\d)0\d{9}(?!\d)/u.test(value)) return false;
  return (
    /\b(?:bao nhieu|the nao|lam sao|tai sao|vi sao|co duoc|duoc khong|dc k|co bi|co gay|co lam|co an toan|xai sao|dung sao|gia sao|ship sao)\b/.test(
      text,
    ) ||
    /\b(?:khong|ko|khum|k)\s*(?:a|ạ)?$/.test(text) ||
    /\b(?:hang gia|fake|lo hang gia|so hang gia|da nhay cam|lo kich ung|so kich ung)\b/.test(text)
  );
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
  const explicitQuestionCount = extractCustomerQuestionClauses(input.customerMessage).length;
  const requiredFactTopics = requiredAnswerTopics(input.customerMessage);
  const requiredSemanticTopics = semanticAnswerTopics(input.interpreted, input.customerMessage);
  const requiredTopics = [...new Set([...requiredFactTopics, ...requiredSemanticTopics])];
  const questionCount = Math.max(
    explicitQuestionCount,
    requiredSemanticTopics.length,
    requiredFactTopics.length,
    requiredTopics.length,
    // Model output alone is not evidence that the customer asked a question.
    // A short order-field answer such as "Tài" must not become a fake FAQ
    // question and pause an otherwise valid order update.
    explicitQuestionCount > 0 || requiredSemanticTopics.length > 0 || requiredFactTopics.length > 0
      ? (input.interpreted.unsupportedQuestions?.length ?? 0)
      : 0,
  );
  const missingTopics = [
    ...missingRequiredAnswerTopics(input.customerMessage, input.candidateReply),
    ...requiredSemanticTopics.filter((topic) => !replyCoversSemanticTopic(topic, input.candidateReply)),
  ].filter((topic, index, all) => all.indexOf(topic) === index);
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
  const groundedLlmCoveredCount =
    input.interpretationStatus === "interpreted" &&
    input.compositionStatus === "enhanced" &&
    (input.interpreted.knowledgeIds?.length ?? 0) > 0
      ? actionCoveredCount
      : 0;
  const semanticCoveredCount = requiredSemanticTopics.filter((topic) =>
    replyCoversSemanticTopic(topic, input.candidateReply),
  ).length;
  const factCoveredCount = requiredFactTopics.filter((topic) =>
    replyCoversRequiredAnswerTopic(topic, input.candidateReply),
  ).length;
  // The LLM is still called first for product questions. If it returns only a
  // semantic classification, a deterministic response grounded in approved KB
  // may pass — but only when the actual reply covers every customer question.
  // A grounded LLM draft may paraphrase the question without sharing literal
  // words (for example "bao lâu" -> "trong tuần đầu"). Its answer action can
  // satisfy coverage because the separate knowledge-grounding guard has already
  // verified the cited source and factual overlap. Timeouts and uncited drafts
  // still fail closed.
  const coveredCount = Math.max(
    Math.min(actionCoveredCount, responseCoveredCount),
    groundedBaseCoveredCount,
    groundedLlmCoveredCount,
    semanticCoveredCount + factCoveredCount,
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

function semanticAnswerTopics(semantic: SemanticUnderstanding, customerMessage: string): SemanticTopic[] {
  const normalizeTopic = (topic: SemanticTopic, evidence: string): SemanticTopic =>
    topic === "order" && isShippingDestinationEvidence(evidence) ? "shipping" : topic;
  const topics = [
    ...(semantic.asksDirectAnswer === true && semantic.topic
      ? [normalizeTopic(semantic.topic, customerMessage)]
      : []),
    ...(semantic.actions ?? [])
      .filter((action) => action.type === "answer_question")
      .map((action) => normalizeTopic(action.topic, action.evidence.join(" "))),
  ];
  return topics.filter((topic, index, all) => topic !== "other" && all.indexOf(topic) === index);
}

function isShippingDestinationEvidence(value: string): boolean {
  const text = value
    .toLocaleLowerCase("vi-VN")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/đ/gu, "d")
    .replace(/[^a-z0-9]+/gu, " ")
    .trim();
  return (
    /\b(?:ship|giao|van chuyen)\b/.test(text) &&
    !/\b(?:don|don hang|ma van don|trang thai don|xac nhan don|len don)\b/.test(text)
  );
}

function replyCoversSemanticTopic(topic: SemanticTopic, reply: string): boolean {
  const text = reply.toLocaleLowerCase("vi-VN").normalize("NFD").replace(/\p{M}/gu, "").replace(/đ/gu, "d");
  switch (topic) {
    case "price":
      return /\b(?:gia|combo)\b|\b\d{2,3}(?:[. ]\d{3})+(?:d|đ)?\b/u.test(text);
    case "promotion":
      return /\b(?:qua tang|tang|uu dai|khuyen mai|giam|tiet kiem)\b/u.test(text);
    case "shipping":
    case "delivery":
      return /\b(?:giao|ship|van chuyen|mien phi giao|sai gon|tp hcm|thanh pho ho chi minh)\b/u.test(text);
    case "comparison":
      return /\b(?:khac|giong|so voi|lan thuong|khu mui|ngan tiet|chinh hang|hang that|hang gia|bao bi|tem|nguoi gui)\b/u.test(
        text,
      );
    case "effectiveness":
    case "sweat":
      return /\b(?:mo hoi|kho thoang|ngan tiet|hieu qua|tham|o ao|bet)\b/u.test(text);
    case "odor":
      return /\b(?:mui|hoi nach|khu mui|kiem soat mui)\b/u.test(text);
    case "usage":
      return /\b(?:dung|boi|lan|buoi toi|tan suat|lan mong)\b/u.test(text);
    case "pregnancy":
      return /\b(?:mang thai|me bau|phu nu dang mang thai|hoi bac si)\b/u.test(text);
    case "breastfeeding":
      return /\b(?:cho con bu|nuoi con bang sua me|hoi bac si)\b/u.test(text);
    case "child_age":
      return /\b(?:tre|tuoi|duoi 12|tu 12)\b/u.test(text);
    case "sensitive_skin":
    case "irritation":
      return /\b(?:nhay cam|kich ung|ngua|rat|do da|thu tren vung nho)\b/u.test(text);
    case "damaged_goods":
      return /\b(?:vo|hong|be|ro ri|mop|doi hang|kiem tra)\b/u.test(text);
    case "negative_review":
      return /\b(?:ghi nhan|kiem tra|phan hoi|bo phan)\b/u.test(text);
    case "order":
      return /\b(?:don|nguoi nhan|so dien thoai|dia chi|xac nhan)\b/u.test(text);
    case "other":
      return true;
  }
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
    isExpressDeliveryQuestion(customerMessage) ||
    isOfflineStoreQuestion(customerMessage) ||
    isDomesticDeliveryEtaQuestion(customerMessage) ||
    isQuantityShippingPolicyQuestion(customerMessage) ||
    isOrderCaptureMessage(customerMessage) ||
    (Boolean(state.selectedQuantity) && isCompoundOrderUpdateQuestion(customerMessage))
  ) {
    return true;
  }
  if (
    state.pendingAction === "send_authenticity_legal_summary" &&
    /^(?:da )?(?:ok|okay|oke|duoc|dc|co|gui (?:di|minh|em|chi|anh)|vang|uh|u)(?: a| nhe)?$/.test(text)
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
    !isPriorAddressReference(customerMessage) &&
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

function reconcileContentFreeInterpretation<T extends SemanticUnderstanding>(semantic: T): T {
  return {
    ...semantic,
    skill: "need-discovery",
    intent: "other",
    topic: "other",
    subject: "customer",
    scenario: "unknown",
    slots: {},
    actions: [],
    uncertainties: [],
    knowledgeIds: [],
    knowledgeQueries: [],
    unsupportedQuestions: [],
    answeredQuestions: [],
    nextStep: "ask_discovery",
    groundingConfidence: 1,
    confidence: 1,
    needsClarification: false,
    asksDirectAnswer: false,
    evidence: [],
  };
}

function contentFreeMessageFallbackReply(): string {
  return "Dạ em chào mình ạ. Mình đang cần hỗ trợ về mồ hôi, mùi cơ thể, cách dùng, giá hay đơn hàng ạ?";
}

function knowledgeContexts(matches: readonly KnowledgeMatch[]): ApprovedKnowledgeContext[] {
  return matches.map(({ entity: { id, title, content, responseGuidance } }) => ({
    id,
    title,
    content,
    ...(responseGuidance ? { responseGuidance } : {}),
  }));
}

function semanticKnowledgeQueries(semantic: SemanticUnderstanding): string[] {
  const topics = new Set([
    semantic.topic,
    ...(semantic.actions ?? [])
      .filter((action) => action.type === "answer_question")
      .map((action) => action.topic),
  ]);
  const queries = new Set<string>([
    ...(semantic.knowledgeQueries ?? []),
    ...(semantic.unsupportedQuestions ?? []),
  ]);
  if (
    ["price_change", "price_request", "promotion_inquiry", "price_objection", "negotiation"].includes(
      semantic.intent ?? "",
    ) ||
    topics.has("price") ||
    topics.has("promotion") ||
    topics.has("shipping")
  ) {
    queries.add("giá bao nhiêu combo 2 lọ phí giao miễn phí giao quà tặng");
  }
  if (topics.has("effectiveness") || topics.has("sweat") || topics.has("odor")) {
    queries.add("hiệu quả giảm mồ hôi mùi cơ thể thâm nách bết dính ố áo");
  }
  if (topics.has("usage")) queries.add("cách dùng thời điểm tần suất lăn Stopirex");
  if (topics.has("order")) queries.add("không đỡ không hiệu quả hoàn tiền đổi trả điều kiện 2 tuần");
  if (topics.has("pregnancy")) queries.add("phụ nữ mang thai mẹ bầu dùng Stopirex");
  if (topics.has("breastfeeding")) queries.add("phụ nữ cho con bú dùng Stopirex");
  if (topics.has("child_age")) queries.add("trẻ em độ tuổi dùng Stopirex");
  if (topics.has("irritation") || topics.has("sensitive_skin")) {
    queries.add("da nhạy cảm kích ứng ngứa rát dùng Stopirex");
  }
  return [...queries].filter(Boolean).slice(0, 6);
}

function needsSemanticKnowledgeExpansion(semantic: SemanticUnderstanding): boolean {
  return Boolean(
    semantic.knowledgeQueries?.length ||
    semantic.unsupportedQuestions?.length ||
    semantic.actions?.some(
      (action) =>
        action.type === "handoff_to_human" &&
        /knowledge|du lieu|dữ liệu|chua co|chưa có/iu.test(action.reason ?? ""),
    ),
  );
}

function knowledgeSafeQuery(value: string): string {
  return value
    .replace(/(?<!\d)0\d{9}(?!\d)/gu, " ")
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function mergeKnowledgeMatches(
  primary: readonly KnowledgeMatch[],
  expanded: readonly KnowledgeMatch[],
  limit: number,
): KnowledgeMatch[] {
  return [...primary, ...expanded]
    .filter(
      (match, index, all) => all.findIndex((candidate) => candidate.entity.id === match.entity.id) === index,
    )
    .slice(0, limit);
}

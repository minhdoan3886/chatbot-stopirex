import { createHash, randomUUID } from "node:crypto";
import {
  initialConsultation,
  mergeConfirmedSlots,
  nextConsultationAction,
  type ConsultationSlots,
  type ConsultationState,
  type CustomerIntent,
  type NextAction,
  type PrimarySymptom,
  type SemanticTopic,
  type SemanticUnderstanding,
  type SemanticNewAngle,
  type SemanticNextStep,
  type BeneficiaryAgeGroup,
  type BeneficiaryType,
  type SemanticBeneficiaryUpdate,
  type ConversationCtaId,
} from "../domain/consultation.js";
import {
  resolveConversationDecision,
  type DecisionTrace,
  type PendingAction,
} from "../domain/conversationDecision.js";
import {
  reconcileConversationActions,
  type ConversationAction,
  type SupportedOrderQuantity,
} from "../domain/conversationActions.js";
import { reduceOrderTransaction, type OrderMutationAction } from "../domain/conversationTransaction.js";
import {
  formatVietnameseAddress,
  mergeDeliveryNotes,
  normalizeDeliveryNotes,
  normalizeVietnameseAddress,
  normalizeVietnamesePhone,
  resolveDeliveryContext,
  type VietnameseAddress,
} from "../domain/orderNormalization.js";
import { planNextBestAction, type PlannedNextBestAction } from "../domain/nextBestAction.js";
import type { ActionExecutionMode } from "../domain/actionRollout.js";
import { assertReplyMatchesConversationState } from "../domain/responseConsistency.js";
import { ClaimRegistry, defaultBlockedClaims } from "../domain/claims.js";
import {
  conversationSkills,
  resolveConversationSkill,
  type ConversationSkillId,
} from "../domain/chatSkills.js";
import {
  assertOrderReady,
  formatOrderConfirmation,
  missingLegacyAddressComponents,
  missingOrderFields,
  type OrderDraft,
  type OrderPriceBreakdown,
} from "../domain/orders.js";
import {
  transitionPipeline,
  type PipelineEvent,
  type PipelineTag,
  type SignalTag,
} from "../domain/pipeline.js";
import {
  formatPriceOffer,
  followupMessage,
  greetingMessage,
  openingMessage,
  personalizeCustomerAddress,
  stopirexGiftForQuantity,
  type ConversationIdentity,
  type OpeningVariantId,
} from "../domain/sales.js";
import { tenantId } from "../domain/types.js";
import { retrieveKnowledge } from "../domain/knowledge.js";
import { stopirexApprovedKnowledge } from "../domain/stopirexKnowledge.js";
import {
  advanceCareFlow,
  resumeAfterHuman,
  startCareFlow,
  type CareFlowState,
  type IssueType,
} from "../domain/customerCare.js";
import {
  governCustomerResponse,
  inferAnsweredTopicFromMessage,
  questionTopic,
  type ConversationTopic,
} from "../domain/responseGovernor.js";
import { extractRequiredResponseFacts } from "../domain/responseContract.js";
import {
  dialogueModeFor,
  initialDialogueState,
  reduceDialogueState,
  type DialogueState,
} from "../domain/dialogueState.js";
import type { ResponseGuardVerdict } from "../domain/responseGuard.js";
import {
  deriveOrderLifecycle,
  initialWorkflowStateMeta,
  reduceWorkflowStateMeta,
  type OrderLifecycle,
  type WorkflowStateEventReceipt,
  type WorkflowStateMeta,
} from "../domain/workflowState.js";
import { InMemoryCareCaseRepository } from "./careCaseRepository.js";
import { createDemoProductCatalog, demoCommerceEffectiveAt } from "../config/demoCommerce.js";
import type { FollowupStage } from "../domain/followup.js";

const demoTenant = tenantId("local-demo");
const demoCatalog = createDemoProductCatalog(demoTenant);
const demoKnowledge = stopirexApprovedKnowledge(demoTenant);

type DemoSession = {
  id: string;
  mode: "sales" | "care";
  customerType: "new" | "returning";
  consultation: ConsultationState;
  care?: CareFlowState;
  previousSalesPipeline?: PipelineTag;
  previousSalesStage?: ConsultationState["stage"];
  pipeline: PipelineTag;
  signal: SignalTag | undefined;
  order: OrderDraft;
  selectedQuantity?: SupportedOrderQuantity;
  orderCollectionPaused: boolean;
  freeShippingApproved: boolean;
  optedOut: boolean;
  messages: number;
  history: Array<{ role: "user" | "assistant"; text: string }>;
  lastIntent?: CustomerIntent;
  activeSkill?: ConversationSkillId;
  skillReason?: string;
  orderId?: string;
  trackingNumber?: string;
  orderConfirmationMode: "sandbox" | "inbox";
  orderEditable?: boolean;
  identity: ConversationIdentity;
  openingVariantId: OpeningVariantId;
  openingSelectionMode: "auto" | "manual";
  openingStrategyReason?: string;
  greeted: boolean;
  openingSent: boolean;
  pendingAction?: PendingAction;
  pendingUsageAudience?: "child" | "general";
  pendingPolicyContext?: "refund_used_ineffective";
  manualHandoffReason?: string;
  lastDecision?: DecisionTrace;
  orderTransactionTrace?: OrderTransactionTrace;
  lastNextBestAction?: PlannedNextBestAction;
  answeredTopics: ConversationTopic[];
  askedTopics: ConversationTopic[];
  pendingQuestionTopic?: ConversationTopic;
  responseGovernorTruncated: boolean;
  customerProfile: CustomerProfileMemory;
  locationMemory: LocationMemory;
  conversationMemory: ConversationMemory;
  dialogueState: DialogueState;
  workflowState: WorkflowStateMeta;
};

export type ConversationMemory = {
  currentGoal?: string;
  activeSubject?: "customer" | "child" | "product" | "order";
  beneficiaries: ConversationBeneficiary[];
  activeBeneficiaryId?: string;
  usedArguments: SemanticNewAngle[];
  rejectedArguments: SemanticNewAngle[];
  answeredQuestions: string[];
  openQuestions: string[];
  nextStep?: SemanticNextStep;
  phoneHistory: ConversationPhoneMemory[];
  consultationFacts: ConversationConsultationFacts;
  salesContext?: {
    objections: ConversationSalesObjection[];
  };
};

export type ConversationSalesObjection = {
  type: "price" | "effectiveness";
  comparedWith?: string;
  status: "open" | "resolved";
  evidence: string;
  sourceTurn: number;
};

export type ConversationPhoneMemory = {
  value: string;
  status: "current" | "historical";
  evidence: string;
  sourceTurn: number;
};

export type ConversationConsultationFacts = {
  sweatConcern?: boolean;
  odorSeverity?: "none" | "mild" | "strong";
  triggers: Array<"stress" | "meeting" | "exercise" | "heat">;
  sensitiveSkin?: boolean;
  recommendedQuantity?: SupportedOrderQuantity;
};

export type ConversationBeneficiary = {
  id: string;
  type: BeneficiaryType;
  label: string;
  age?: number;
  ageGroup: BeneficiaryAgeGroup;
  confirmed: boolean;
  evidence: string;
  sourceTurn: number;
};

export type CustomerProfileMemory = {
  gender?: "male" | "female";
  age?: number;
};

export type LocationMemory = {
  legacyAddress?: string;
  addressContext?: VietnameseAddress;
  evidence?: string;
  sourceTurn?: number;
  history?: Array<{
    legacyAddress: string;
    evidence: string;
    sourceTurn: number;
  }>;
};

type ObservedEntityChanges = {
  recipientName?: string;
  phone?: string;
  deliveryNote?: string;
  address?: string;
  location?: string;
};

type QuantityOperation = {
  operation: "replace" | "add" | "subtract";
  operand: number;
};

export type OrderTransactionTrace = {
  acceptedActions: Array<{ type: OrderMutationAction["type"]; evidence: string }>;
  acceptedMutations?: Array<{
    type: OrderMutationAction["type"];
    propositionId?: string;
    evidenceRef: string;
    source: NonNullable<OrderMutationAction["source"]>;
    confidence: number;
    from?: unknown;
    toMasked?: unknown;
  }>;
  changedFields: string[];
  rejectedMutations?: Array<{
    type: OrderMutationAction["type"];
    propositionId?: string;
    evidenceRef: string;
    reason: string;
  }>;
  unchangedFields?: string[];
  missingFields?: string[];
  conflicts: string[];
};

export type DemoChatState = {
  mode: "sales" | "care";
  customerType: "new" | "returning";
  consultationStage: ConsultationState["stage"];
  journeyStage: string;
  breakpoint: string;
  careIssue?: IssueType;
  careFacts?: Record<string, unknown>;
  careCaseId?: string;
  careOwner?: string;
  careDueAt?: string;
  careStatus?: CareFlowState["case"]["status"];
  carePriority?: CareFlowState["case"]["priority"];
  previousSalesPipeline?: PipelineTag;
  botPaused: boolean;
  recentTurns: Array<{ role: "user" | "assistant"; text: string }>;
  lastIntent?: CustomerIntent;
  activeSkill?: ConversationSkillId;
  skillReason?: string;
  slots: ConsultationState["slots"];
  pipeline: PipelineTag;
  signal?: SignalTag;
  selectedQuantity?: SupportedOrderQuantity;
  orderDraft?: OrderDraft;
  orderFlowStatus?: "idle" | "collecting" | "paused" | "awaiting_confirmation" | "created";
  orderReceived?: boolean;
  freeShippingApproved: boolean;
  orderMissing: string[];
  optedOut: boolean;
  orderId?: string;
  trackingNumber?: string;
  openingVariantId: OpeningVariantId;
  openingSelectionMode: "auto" | "manual";
  openingStrategyReason?: string;
  pendingAction?: PendingAction;
  handoffReason?: string;
  decisionTrace?: DecisionTrace;
  orderTransactionTrace?: OrderTransactionTrace;
  nextBestAction?: PlannedNextBestAction;
  answeredTopics: ConversationTopic[];
  askedTopics: ConversationTopic[];
  pendingQuestionTopic?: ConversationTopic;
  responseGovernorTruncated: boolean;
  customerProfile?: CustomerProfileMemory;
  locationMemory?: LocationMemory;
  conversationMemory?: ConversationMemory;
  dialogueState?: DialogueState;
  stateVersion?: number;
  orderRevision?: number;
  orderLifecycle?: OrderLifecycle;
  recentStateEvents?: WorkflowStateEventReceipt[];
  responseDecision?: ResponseGuardVerdict;
};

export type DemoChatResponse = {
  sessionId: string;
  reply: string;
  replies: string[];
  state: DemoChatState;
  sandbox: true;
  productionData: false;
};

export type DemoChatContext = {
  identity?: ConversationIdentity;
  openingVariantId?: OpeningVariantId;
  actionExecutionMode?: ActionExecutionMode;
  orderConfirmationMode?: "sandbox" | "inbox";
  /** Giá trị authoritative từ order_inbox; false khi đã có mã vận đơn. */
  orderEditable?: boolean;
};

export class DemoChatService {
  private readonly sessions = new Map<string, DemoSession>();
  private readonly claims = new ClaimRegistry(defaultBlockedClaims);
  private readonly careCases = new InMemoryCareCaseRepository();

  chat(
    sessionId: string | undefined,
    input: string,
    semanticInput: ConsultationSlots | SemanticUnderstanding = {},
    context: DemoChatContext = {},
  ): DemoChatResponse {
    const session = this.getOrCreate(sessionId, context);
    applyChatContext(session, context);
    delete session.orderTransactionTrace;
    delete session.lastNextBestAction;
    if (session.pipeline === "7.Chờ followup") session.freeShippingApproved = true;
    const raw = input.trim();
    const text = normalize(raw);
    // Order lifecycle and conversational focus are independent. An inbox
    // order remains editable until a real tracking code is attached even when
    // the customer temporarily asks a product question and the sales pipeline
    // moves away from `6.Đã tạo đơn`.
    const canEditCreatedInboxOrder =
      session.orderConfirmationMode === "inbox" &&
      session.orderEditable === true &&
      Boolean(session.order.customerConfirmedAt);
    const orderMutationAllowed = session.pipeline !== "6.Đã tạo đơn" || canEditCreatedInboxOrder;
    // Observation runs on an isolated projection. It may propose entities but
    // cannot mutate the authoritative session before the LLM action plan has
    // been reconciled.
    const observationProjection = structuredClone(session);
    const observedEntityCandidates = observeGlobalEntities(
      observationProjection,
      raw,
      orderMutationAllowed,
    );
    const requestedQuantity = extractRequestedQuantity(text);
    const committedRequestedQuantity = extractExplicitOrderQuantity(text);
    const quantityOperation = extractQuantityOperation(text);
    const compoundFinalQuantity = extractCompoundFinalQuantity(text);
    const retailEscapeFromWholesale = isRetailEscapeFromWholesaleHandoff(
      session,
      text,
      raw,
      requestedQuantity,
    );
    const semantic = resolveContextualSemantic(session, raw, normalizeSemanticInput(semanticInput));
    const multiActionEnabled = context.actionExecutionMode !== "legacy";
    const semanticHasMultipleAnswerTopics =
      new Set(
        (semantic.actions ?? [])
          .filter((action) => action.type === "answer_question")
          .map((action) => action.topic),
      ).size > 1;
    let semanticSlots = semantic.slots;
    const bottleLongevityConcern =
      isBottleLongevityQuestion(text) || semantic.knowledgeIds?.includes("usage-bottle-duration") === true;

    if (isReset(text)) return this.reset(session.id);
    rememberMentionedDeliveryContext(session, raw);
    rememberTurn(session, { role: "user", text: raw });
    rememberSemanticPlan(session, semantic, raw);
    rememberCustomerConsultationFacts(session, raw);
    session.answeredTopics = [
      ...new Set([
        ...session.answeredTopics,
        ...inferAnsweredTopicFromMessage(raw, session.pendingQuestionTopic),
      ]),
    ];
    semanticSlots = groundSemanticSlots(session, semanticSlots);
    semanticSlots = {
      ...semanticSlots,
      ...contextualSlotsFromSemanticAnswer(semantic, session.consultation, text),
    };
    semantic.slots = semanticSlots;
    if (isStateRequest(text)) return this.respond(session, "Dạ đây là trạng thái hội thoại hiện tại ạ.");

    session.messages += 1;
    if (session.messages === 1) this.move(session, "first_reply");

    const dynamicOpeningChoice =
      session.openingSelectionMode === "auto" &&
      session.openingVariantId === "AUTO.dynamic" &&
      session.consultation.stage === "S0.new" &&
      /^[123]$/u.test(text)
        ? (text as "1" | "2" | "3")
        : undefined;

    const exactIntent = detectDirectIntent(text);
    // Intent routing and factual grounding are separate responsibilities.
    // A strong LLM interpretation may own what the customer is asking before
    // retrieval attaches Knowledge IDs. Knowledge still validates factual
    // claims before delivery; it must not replace the current-turn intent.
    const semanticRoutingReady = Boolean(
      semantic.intent &&
      semantic.intent !== "other" &&
      (semantic.confidence ?? 0.82) >= 0.65 &&
      semantic.needsClarification !== true,
    );
    const semanticAuthorityReady = Boolean(
      semanticRoutingReady &&
      (semantic.confidence ?? 0) >= 0.85 &&
      hasGroundedSemanticEvidence(raw, semantic),
    );
    const protectedApplicationConcern =
      isApplicationFeelOrClothingConcern(text) && !isPriceAndShippingPolicyQuestion(text);
    const priorOtherProductAdverseExperience = isPriorOtherProductAdverseExperience(text);
    const citationProtectedConcern = semantic.knowledgeIds?.includes("usage-bottle-duration") === true;
    const protectedKnownAnswerConcern =
      citationProtectedConcern ||
      protectedApplicationConcern ||
      isNamedCompetitorPriceObjection(text) ||
      isPriceAndShippingPolicyQuestion(text) ||
      isDeliveryInspectionQuestion(text) ||
      isDomesticDeliveryInspectionQuestion(text) ||
      isReturnsPolicyQuestion(text) ||
      isOrderRecapRequest(text) ||
      isConditionalEfficacyObjection(text) ||
      priorOtherProductAdverseExperience ||
      isAlcoholAndScentPremiseQuestion(text) ||
      isHairRemovalSafetyQuestion(text) ||
      (!semanticRoutingReady &&
        (isPermanentControlQuestion(text) ||
          isSweatWashOffConcern(text) ||
          isMissedEveningApplicationQuestion(text) ||
          isUsageDurationOrFrequencyQuestion(text) ||
          isMorningFragranceLayeringQuestion(text) ||
          bottleLongevityConcern ||
          isBulkPurchaseBenefitQuestion(text)));
    const detectedCareIssue = detectCareIssue(text);
    const detectedCareScenario = detectCareScenario(text, detectedCareIssue);
    const conditionalNoIrritationPurchase = isConditionalNoIrritationPurchase(text);
    if (session.care && priorOtherProductAdverseExperience) {
      dismissMisattributedCare(session);
    }
    if (conditionalNoIrritationPurchase) {
      clearOrderDraft(session);
      mergeOrderData(session, raw);
      const destination = extractDeliveryDestination(raw);
      if (destination) commitLegacyAddress(session, destination, "append", raw);
      session.orderCollectionPaused = true;
      session.pipeline = "4.XL băn khoăn";
      session.consultation = { ...session.consultation, stage: "S5.guidance" };
    }
    // LLM-first routing: a strong, verbatim-grounded interpretation owns the
    // customer's linguistic intent. Keyword detectors remain fallback signals
    // and hard system/security guards; they must not silently replace a
    // different intent already understood by the model.
    const reconcilerExactIntent =
      semanticAuthorityReady &&
      exactIntent &&
      semantic.intent &&
      exactIntent !== semantic.intent &&
      !isNamedCompetitorPriceObjection(text) &&
      !isInternalSystemProbe(text) &&
      !isOutOfScopeAssistantProbe(text)
        ? undefined
        : exactIntent;
    const actionPlan = reconcileConversationActions({
      customerMessage: raw,
      semantic,
      ...(reconcilerExactIntent ? { exactIntent: reconcilerExactIntent } : {}),
      ...(!(multiActionEnabled && semanticHasMultipleAnswerTopics) && protectedApplicationConcern
        ? { exactAnswerTopic: "effectiveness" as const }
        : {}),
      ...(detectedCareIssue ? { detectedCareIssue } : {}),
      ...(detectedCareScenario ? { careScenario: detectedCareScenario } : {}),
      priorOtherProductAdverseExperience,
      conditionalNoIrritationPurchase,
      optOut: isOptOut(text),
      collectingOrder: orderMutationAllowed && Boolean(session.selectedQuantity),
    });
    const deterministicDeliveryNoteReady = Boolean(
      session.selectedQuantity &&
        normalizeDeliveryNotes(raw).valid &&
        normalizeDeliveryNotes(raw).normalized?.length,
    );
    session.dialogueState = reduceDialogueState(session.dialogueState, {
      type: "user_acts_observed",
      acts: actionPlan.accepted,
      mode: dialogueModeFor({
        actions: actionPlan.accepted,
        ...(session.selectedQuantity ? { selectedQuantity: session.selectedQuantity } : {}),
        botPaused: session.care?.case.botPaused ?? false,
      }),
    });
    const observedEntities = commitReconciledObservations({
      session,
      projection: observationProjection,
      candidates: observedEntityCandidates,
      raw,
      semanticOwnedFields: actionPlan.accepted.flatMap((action) =>
        action.type === "update_order"
          ? Object.keys(action.fields)
              .filter(isOrderObservationField)
              // A valid deterministic phone is already canonical and safe to
              // commit before semantic mutations. Keeping it out of the
              // ownership filter prevents a malformed/partial LLM phone
              // proposition from suppressing the verified number entirely.
              .filter(
                (field) => field !== "phone" || !normalizeVietnamesePhone(raw).valid,
              )
              .filter((field) => field !== "deliveryNote" || !deterministicDeliveryNoteReady)
          : [],
      ),
      acceptOrderChanges:
        orderMutationAllowed &&
        Boolean(
          actionPlan.accepted.some((action) => action.type === "update_order") ||
            deterministicDeliveryNoteReady ||
            (!semanticAuthorityReady && (session.selectedQuantity || isOrderCaptureMessage(raw))),
        ),
    });
    const quantityBlockedByConditionalRefund = actionPlan.conflicts.some((conflict) =>
      conflict.includes("giả định hoàn tiền"),
    );
    const semanticOrderDataRecorded =
      orderMutationAllowed &&
      Boolean(
        session.selectedQuantity ||
        (!quantityBlockedByConditionalRefund &&
          semantic.intent === "buying" &&
          requestedQuantity &&
          requestedQuantity <= 5),
      ) &&
      applySemanticOrderUpdates(session, actionPlan.accepted, raw);
    const exactRouteIsHardGuard = Boolean(
      reconcilerExactIntent &&
      (isInternalSystemProbe(text) ||
        isOutOfScopeAssistantProbe(text) ||
        isNamedCompetitorPriceObjection(text) ||
        (!semanticAuthorityReady && protectedKnownAnswerConcern)),
    );
    const effectiveExactIntent = multiActionEnabled
      ? exactRouteIsHardGuard
        ? reconcilerExactIntent
        : (actionPlan.primaryIntent ?? reconcilerExactIntent)
      : reconcilerExactIntent;
    // In multi-action mode the Reconciler owns scope: a keyword detector may
    // propose a care issue, but only a reconciled current-customer incident is
    // allowed to open a real CSKH case.
    const effectiveCareIssue = multiActionEnabled ? actionPlan.careIssue : detectedCareIssue;
    const interruptActiveCare = Boolean(
      session.care &&
      exactIntent &&
      !detectedCareIssue &&
      isExplicitCustomerQuestion(raw) &&
      canInterruptActiveCare(exactIntent),
    );
    if (session.openingSelectionMode === "auto" && session.openingVariantId === "AUTO.dynamic") {
      const selected = dynamicOpeningChoice
        ? dynamicOpeningStrategyForMenuChoice(dynamicOpeningChoice)
        : selectDynamicOpeningStrategy({
            sessionId: session.id,
            text,
            semantic,
            ...(effectiveExactIntent ? { exactIntent: effectiveExactIntent } : {}),
            ...(effectiveCareIssue ? { careIssue: effectiveCareIssue } : {}),
          });
      session.openingVariantId = selected.variantId;
      session.openingStrategyReason = selected.reason;
      session.consultation = {
        ...session.consultation,
        stage: openingStage(selected.variantId),
      };
      session.openingSent = !isGenericOpening(text);
    }
    const decision = resolveConversationDecision({
      semantic,
      ...(session.pendingAction ? { pendingAction: session.pendingAction } : {}),
      ...(effectiveExactIntent ? { exactIntent: effectiveExactIntent } : {}),
      ...(exactRouteIsHardGuard ? { exactIntentKind: "hard" as const } : {}),
      ...(effectiveCareIssue ? { careIssue: effectiveCareIssue } : {}),
      ...(detectedCareScenario ? { careScenario: detectedCareScenario } : {}),
      optOut: isOptOut(text),
      activeCare: Boolean(session.care),
      interruptActiveCare,
      orderConfirmation:
        session.pipeline !== "6.Đã tạo đơn" &&
        isCorrectConfirmation(text) &&
        orderHasAllFields(session.order),
      collectingOrder: orderMutationAllowed && Boolean(session.selectedQuantity),
      orderDataCandidate:
        orderMutationAllowed &&
        Boolean(session.selectedQuantity) &&
        !effectiveExactIntent &&
        !effectiveCareIssue &&
        (semanticOrderDataRecorded ||
          Boolean(
            observedEntities.recipientName || observedEntities.deliveryNote || observedEntities.address,
          ) ||
          isLikelyOrderData(raw, session.order)),
      explicitPurchaseSelection: Boolean(extractExplicitOrderQuantity(text) || actionPlan.quantity),
      affirmativeFollowup:
        isAffirmativeFollowup(text) ||
        semantic.affirmation === true ||
        (session.pendingAction === "send_price" && isGuidancePriceChoice(text)),
    });
    decision.trace.actionPlan = actionPlan;
    decision.trace.actionExecutionMode = multiActionEnabled ? "multi_action" : "legacy";
    decision.trace.ruleMatches.push(
      ...actionPlan.accepted.map((action) => ({
        id: `action_${action.type}`,
        kind: action.source === "guardrail" ? ("hard" as const) : ("soft" as const),
        confidence: action.confidence,
      })),
    );
    decision.trace.conflicts = [...new Set([...decision.trace.conflicts, ...actionPlan.conflicts])];
    session.lastDecision = decision.trace;
    if (
      session.selectedQuantity &&
      decision.route === "direct_intent" &&
      decision.intent &&
      !["buying", "order_support", "decline_purchase"].includes(decision.intent)
    ) {
      session.orderCollectionPaused = true;
    }
    const discoveryCtaSelected = [
      "ask_primary_symptom",
      "ask_work_context",
      "ask_care_symptom",
      "ask_clarification",
    ].includes(semantic.selectedCtaId ?? "none");
    const resolvedSkill = resolveConversationSkill({
      ...(discoveryCtaSelected
        ? { suggestedSkill: "need-discovery" as const }
        : semantic.skill
          ? { suggestedSkill: semantic.skill }
          : {}),
      route: decision.route,
      ...(decision.intent ? { intent: decision.intent } : {}),
      ...(semantic.topic ? { topic: semantic.topic } : {}),
      ...(semantic.scenario ? { scenario: semantic.scenario } : {}),
      ...(decision.careIssue ? { careIssue: decision.careIssue } : {}),
      pipeline: session.pipeline,
    });
    session.activeSkill = resolvedSkill.skill.id;
    session.skillReason = resolvedSkill.reason;
    if (
      multiActionEnabled &&
      semantic.skill === "direct-answer" &&
      !discoveryCtaSelected &&
      semantic.needsClarification !== true &&
      actionPlan.answerTopics.length > 0 &&
      session.activeSkill === "need-discovery"
    ) {
      session.activeSkill = "direct-answer";
      session.skillReason =
        "LLM đã xác định câu hỏi cần trả lời trực tiếp và Reconciler đã chấp nhận answer action.";
    }

    // A reconciled CSKH route must run before deterministic product/logistics
    // helpers. Otherwise one phrase such as "giao lâu" can answer only the ETA
    // clause and discard an LLM-confirmed cancellation or urgent complaint.
    if (decision.route === "active_care" && session.care) {
      const turn = advanceCareFlow(session.care, raw);
      session.care = turn.state;
      this.careCases.save(turn.state.case);
      session.pipeline = turn.pipeline;
      session.mode = "care";
      session.customerType = "returning";
      return this.respond(session, turn.reply);
    }

    if (decision.route === "start_care" && decision.careIssue) {
      const careIssue = decision.careIssue;
      const turn = startCareFlow(
        `CARE-${randomUUID().slice(0, 8).toUpperCase()}`,
        careIssue,
        new Date(),
        raw,
      );
      const safety = detectSafety(text);
      session.previousSalesPipeline = session.pipeline;
      session.care = turn.state;
      this.careCases.save(turn.state.case);
      session.pipeline = turn.pipeline;
      session.mode = "care";
      session.customerType = "returning";
      session.signal = signalForIssue(careIssue);
      if (careIssue === "complaint") {
        session.orderCollectionPaused = true;
        delete session.pendingAction;
      }
      if (safety.redFlag) {
        session.consultation = mergeConfirmedSlots(session.consultation, safety.slots);
      }
      if (careIssue === "irritation" && isSevereAllergicReaction(text)) {
        recordKnowledge(session, ["care-suspected-allergic-reaction"]);
        return this.respond(
          session,
          "Dạ mình ngưng dùng ngay và không lăn lại ạ. Nếu đang khó thở, khò khè, choáng, khó nuốt hoặc sưng môi/mặt/lưỡi, mình cần đi cấp cứu ngay; bên em đã chuyển bộ phận liên quan ghi nhận trường hợp này.",
        );
      }
      // Complaint responses must acknowledge and pause automation first. Do
      // not replace them with a product fact merely because the same message
      // also contains a resolvable product question.
      if (careIssue === "complaint") {
        return this.respond(session, turn.reply);
      }
      const careHandoff = actionPlan.accepted.find((action) => action.type === "handoff_to_human");
      if (
        multiActionEnabled &&
        actionPlan.answerTopics.length > 0 &&
        (careHandoff || (semantic.unsupportedQuestions?.length ?? 0) > 0)
      ) {
        pauseForHumanReview(session, careHandoff?.reason ?? "Có phần câu hỏi chưa có dữ liệu được duyệt");
        session.orderCollectionPaused = true;
        session.activeSkill = "knowledge-handoff";
        session.skillReason =
          "Trả lời chính sách có nguồn trước, rồi chuyển người xử lý phần nghiệp vụ còn thiếu.";
        recordKnowledge(session, [...knowledgeForActionTopics(actionPlan.answerTopics, text)]);
        return this.respond(session, [
          multiActionAnswer(actionPlan.answerTopics, raw, semanticSlots),
          unsupportedQuestionHandoffReply(raw, semantic.unsupportedQuestions ?? []),
        ]);
      }
      return this.respond(session, turn.reply);
    }

    if (
      isExplicitOrderCancellation(text) &&
      (!semanticAuthorityReady || semantic.intent === "decline_purchase")
    ) {
      clearOrderDraft(session);
      session.lastIntent = "decline_purchase";
      session.pipeline = "N.Nuôi dưỡng";
      session.signal = undefined;
      session.activeSkill = "direct-answer";
      session.skillReason = "Lệnh hủy đơn có ưu tiên cao hơn câu hỏi sản phẩm đi kèm.";
      recordKnowledge(session, [
        "business-approved-alcohol-odor-guidance-2026-08",
        "audience-sensitive-skin",
      ]);
      overrideDecisionClassification(
        session,
        "decline_purchase",
        "other",
        [],
        "Hủy toàn bộ OrderDraft trước, sau đó trả lời ngắn gọn lo ngại về Alcohol.",
      );
      return this.respond(
        session,
        "Dạ em đã hủy toàn bộ đơn và không giữ thông tin đặt hàng nữa ạ. Stopirex có Alcohol làm dung môi trong ngưỡng an toàn của công thức, giúp sản phẩm khô nhanh. Nếu mình có tiền sử dị ứng hoặc da đang khó chịu thì chưa nên dùng; khi cần kiểm tra thêm thành phần, mình cứ nhắn bên em hỗ trợ ạ.",
      );
    }

    if (decision.route === "opt_out") {
      session.optedOut = true;
      session.pipeline = "R.Đã rớt";
      clearOrderDraft(session);
      return this.respond(
        session,
        "Dạ em đã ghi nhận yêu cầu dừng tin nhắn tự động. Khi cần hỗ trợ lại, anh/chị chủ động nhắn cho bên em ạ.",
      );
    }
    if (session.optedOut) {
      session.optedOut = false;
      session.pipeline = "1.Phân loại";
    }
    resumeAfterSoftHandoff(session);

    if (
      compoundFinalQuantity &&
      orderMutationAllowed &&
      (!semanticAuthorityReady || semantic.intent === "buying" || semantic.intent === "order_support")
    ) {
      selectQuantity(session, compoundFinalQuantity);
      session.pipeline = "5.Chờ TT KH";
      session.consultation = { ...session.consultation, stage: "S8.order" };
      session.orderCollectionPaused = false;
      session.lastIntent = "buying";
      session.activeSkill = "order-closing";
      session.skillReason =
        "Quantity reducer đã thực thi chuỗi thay đổi và phép trừ người dùng trong cùng lượt.";
      recordKnowledge(session, ["pricing-approved-options-2026-08"]);
      overrideDecisionClassification(
        session,
        "buying",
        "order",
        [],
        "Chuỗi 3 lọ → 4 lọ → bớt một người được tính thành 3 lọ trước khi báo tổng.",
      );
      const selected = quote(compoundFinalQuantity);
      if (canEditCreatedInboxOrder) {
        session.pipeline = "6.Đã tạo đơn";
        return this.respond(session, orderUpdatedReply(session));
      }
      return this.respond(
        session,
        `Dạ chốt lại đơn là ${compoundFinalQuantity} lọ: ${formatVnd(selected.total.amount)}, được miễn phí giao ạ. Em đã lưu đúng số lượng ${compoundFinalQuantity} lọ cho mình.`,
      );
    }

    // State commands are executed before any free-form response planning. The
    // router may classify the surrounding question, but it cannot override a
    // committed quantity/address/name/note transaction.
    if (
      quantityOperation &&
      session.selectedQuantity &&
      orderMutationAllowed &&
      (!semanticAuthorityReady || semantic.intent === "buying" || semantic.intent === "order_support") &&
      !isWholesaleDealerInquiry(text) &&
      !isQuantityShippingPolicyQuestion(text) &&
      !isPriceAndShippingPolicyQuestion(text)
    ) {
      const nextQuantity = applyQuantityOperation(session.selectedQuantity, quantityOperation);
      if (nextQuantity) {
        selectQuantity(session, nextQuantity);
        session.pipeline = canEditCreatedInboxOrder ? "6.Đã tạo đơn" : "5.Chờ TT KH";
        session.consultation = { ...session.consultation, stage: "S8.order" };
        session.orderCollectionPaused = false;
        session.lastIntent = "buying";
        session.activeSkill = "order-closing";
        session.skillReason = `State Reducer đã thực thi quantity_${quantityOperation.operation} trước Response Planner.`;
        overrideDecisionClassification(
          session,
          "buying",
          "order",
          [],
          `Quantity operation ${quantityOperation.operation} đã được reducer áp dụng xác định.`,
        );
        if (isPriceRequest(text)) {
          recordKnowledge(session, ["pricing-approved-options-2026-08"]);
          return this.respond(session, quantityUpdatePriceReply(nextQuantity));
        }
        return this.respond(session, orderCollectionReply(session));
      }
    }

    if (
      isOrderRecapRequest(text) &&
      session.selectedQuantity &&
      orderMutationAllowed &&
      (!semanticAuthorityReady || semantic.intent === "buying" || semantic.intent === "order_support")
    ) {
      // A recap may also contain the customer's final correction (for example
      // “thôi lấy 1 lọ ... đọc lại đơn”). Commit the trusted LLM action first,
      // then render the recap from the updated OrderDraft.
      if (actionPlan.quantity && actionPlan.quantity !== session.selectedQuantity) {
        selectQuantity(
          session,
          actionPlan.quantity,
          actionPlan.accepted.find((action) => action.type === "select_quantity"),
        );
      }
      mergeOrderData(session, raw);
      session.lastIntent = "order_support";
      session.activeSkill = "order-closing";
      session.skillReason = "Order recap đọc trực tiếp OrderDraft đã commit, không gọi bảng giá hoặc LLM.";
      session.orderCollectionPaused = false;
      if (orderHasAllFields(session.order)) session.pendingAction = "confirm_order";
      overrideDecisionClassification(
        session,
        "order_support",
        "order",
        [],
        "Yêu cầu nhắc lại đơn được tách khỏi price_request.",
      );
      return this.respond(session, orderCollectionReply(session, raw));
    }

    if (isRefundPolicyFollowup(session, text)) {
      session.pendingPolicyContext = "refund_used_ineffective";
      session.lastIntent = "order_support";
      session.activeSkill = "direct-answer";
      session.skillReason = "Giữ chủ đề hoàn tiền ở lượt nối tiếp và không làm thay đổi OrderDraft.";
      recordKnowledge(session, ["refund-used-ineffective"]);
      overrideDecisionClassification(
        session,
        "order_support",
        "other",
        [],
        "Coreference của lượt hiện tại được neo vào chính sách hoàn tiền do chưa hiệu quả.",
      );
      return this.respond(session, refundFollowupReply(text));
    }

    if (
      session.selectedQuantity &&
      orderMutationAllowed &&
      isPriorAddressReference(raw) &&
      (!semanticAuthorityReady || semantic.intent === "buying" || semantic.intent === "order_support")
    ) {
      const restoredAddress = resolveRememberedAddress(session, raw);
      if (restoredAddress) {
        if (session.order.legacyAddress) {
          rememberLocation(session, session.order.legacyAddress, session.order.legacyAddress);
        }
        commitOrderMutations(session, [
          {
            type: "set_address",
            address: canonicalizeLegacyAddress(restoredAddress),
            operation: "replace",
            evidence: raw,
          },
        ]);
        if (session.order.legacyAddress) {
          rememberLocation(session, session.order.legacyAddress, restoredAddress);
        }
        session.pipeline = canEditCreatedInboxOrder ? "6.Đã tạo đơn" : "5.Chờ TT KH";
        session.orderCollectionPaused = false;
        session.lastIntent = "order_support";
        session.activeSkill = "order-closing";
        session.skillReason = "Address history resolver đã khôi phục địa chỉ được khách tham chiếu.";
        if (orderHasAllFields(session.order)) session.pendingAction = "confirm_order";
        overrideDecisionClassification(
          session,
          "order_support",
          "order",
          [],
          "LLM đọc ý định dùng lại địa chỉ; State Reducer khôi phục dữ liệu đã lưu mà không yêu cầu khách nhập lại.",
        );
        if (session.lastDecision) session.lastDecision.selectedRoute = "order_collection";
        return this.respond(session, orderCollectionReply(session));
      }
    }

    const pureCommittedOrderEntity =
      session.selectedQuantity &&
      (!semanticAuthorityReady || semantic.intent === "buying" || semantic.intent === "order_support") &&
      !isExplicitCustomerQuestion(raw) &&
      !isPriceRequest(text) &&
      (observedEntities.recipientName ||
        observedEntities.deliveryNote ||
        observedEntities.address ||
        semanticOrderDataRecorded);
    if (pureCommittedOrderEntity) {
      session.pipeline = canEditCreatedInboxOrder ? "6.Đã tạo đơn" : "5.Chờ TT KH";
      session.consultation = { ...session.consultation, stage: "S8.order" };
      session.orderCollectionPaused = false;
      session.lastIntent = "order_support";
      session.activeSkill = "order-closing";
      session.skillReason = "Response Planner phản hồi từ entity transaction vừa commit.";
      if (orderHasAllFields(session.order)) session.pendingAction = "confirm_order";
      return this.respond(session, orderCollectionReply(session, raw));
    }

    if (isResumeExistingRetailOrder(session, text) && orderHasAllFields(session.order)) {
      session.orderCollectionPaused = false;
      delete session.pendingAction;
      commitOrderMutations(session, [{ type: "confirm_order", confirmedAt: new Date(), evidence: raw }]);
      assertOrderReady(session.order);
      this.move(session, "order_created");
      session.signal = undefined;
      session.lastIntent = "buying";
      return this.respond(session, [orderCreatingReply(session), orderCreatedReply(session)]);
    }

    if (retailEscapeFromWholesale) {
      const quantity = requestedQuantity ?? 1;
      clearOrderDraft(session);
      selectQuantity(session, quantity);
      mergeRetailEscapeOrderData(session, raw);
      const destination = extractRetailEscapeDestination(raw) ?? extractDeliveryDestination(raw);
      if (destination) commitLegacyAddress(session, destination, "append", raw);
      session.pipeline = "5.Chờ TT KH";
      session.consultation = { ...session.consultation, stage: "S8.order" };
      session.orderCollectionPaused = false;
      session.lastIntent = "buying";
      session.activeSkill = "order-closing";
      session.skillReason =
        "Khách hủy nhu cầu sỉ và chốt đơn lẻ mới; xóa handoff cũ rồi lưu toàn bộ entity trước khi phản hồi.";
      session.signal = undefined;
      overrideDecisionClassification(
        session,
        "buying",
        "order",
        [],
        "Escape Hatch đã thay thế handoff sỉ bằng đơn lẻ rõ ràng ở lượt hiện tại.",
      );
      const weather = containsWeatherQuestion(raw)
        ? " Em không theo dõi thời tiết theo thời gian thực ạ."
        : "";
      return this.respond(session, `${orderCollectionReply(session)}${weather}`);
    }

    if (isExpressDeliveryQuestion(text) || isOfflineStoreQuestion(text)) {
      session.lastIntent = "order_support";
      session.activeSkill = "direct-answer";
      session.skillReason =
        "Chính sách vận hành cố định: chỉ bán online, không có cửa hàng offline và không giao hỏa tốc.";
      overrideDecisionClassification(
        session,
        "order_support",
        "delivery",
        [],
        "Trả lời chính sách kênh bán và phương thức giao đã được duyệt.",
      );
      recordKnowledge(session, [
        "online-only-standard-carrier-policy",
        ...(isExpressDeliveryQuestion(text) ? ["domestic-delivery-inspection-policy"] : []),
      ]);
      return this.respond(session, onlineOnlyDeliveryPolicyReply(text));
    }

    if (isInternationalShippingQuestion(text)) {
      const quantity = detectQuantity(text);
      if (quantity) {
        selectQuantity(session, quantity);
        this.move(session, "agreed_to_buy");
      }
      pauseForHumanReview(session, "international_shipping_requires_review", "CT.Giá/Ship");
      session.orderCollectionPaused = true;
      overrideDecisionClassification(
        session,
        "order_support",
        "shipping",
        [],
        "Phí và điều kiện vận chuyển quốc tế cần nhân viên vận hành xác nhận.",
      );
      session.activeSkill = "knowledge-handoff";
      session.skillReason =
        "Phí và điều kiện vận chuyển quốc tế phải được vận hành xác nhận; không tự cam kết hoặc thu tiếp đơn.";
      recordKnowledge(session, ["international-shipping-compensation-handoff"]);
      return this.respond(session, [
        quantity
          ? `Dạ em đã ghi nhận nhu cầu ${quantity} lọ gửi sang Nhật Bản ạ.`
          : "Dạ em đã ghi nhận nhu cầu gửi hàng ra nước ngoài ạ.",
        "Phí gửi, khả năng giao và điều kiện bồi thường cần nhân viên vận hành kiểm tra; em chưa thể tự xác nhận các yêu cầu này ạ.",
      ]);
    }

    const llmInterpretationFailed = Boolean(semantic.status && semantic.status !== "interpreted");
    if (multiActionEnabled && llmInterpretationFailed && isExplicitCustomerQuestion(raw)) {
      const fallback = llmFailureKnowledgeAnswer(raw, semanticSlots);
      if (
        !quantityBlockedByConditionalRefund &&
        committedRequestedQuantity &&
        committedRequestedQuantity <= 5
      ) {
        selectQuantity(session, committedRequestedQuantity as SupportedOrderQuantity);
        this.move(session, "agreed_to_buy");
      }
      session.orderCollectionPaused = Boolean(session.selectedQuantity);
      session.lastIntent = fallback?.intent ?? "knowledge_unknown";
      session.activeSkill = fallback ? "direct-answer" : "knowledge-handoff";
      session.skillReason = fallback
        ? "LLM lỗi; chỉ dùng câu trả lời backup có Knowledge đã duyệt và không tiếp tục thu đơn."
        : "LLM lỗi và chưa có backup chắc chắn; fail-closed sang nhân viên, không tiếp tục thu đơn.";
      if (fallback) recordKnowledge(session, fallback.knowledgeIds);
      if (fallback && session.pipeline === "1.Phân loại") this.move(session, "classified");
      const needsHuman = !fallback || /vat|hoa don/.test(text);
      if (needsHuman) {
        pauseForHumanReview(session, "llm_unavailable_question_requires_review");
        if (/vat|hoa don/.test(text)) recordKnowledge(session, ["policy-vat-invoice-handoff"]);
      }
      const replies = [
        ...(fallback ? [fallback.reply] : []),
        ...(needsHuman ? [unsupportedQuestionHandoffReply(raw, [raw])] : []),
        ...(!quantityBlockedByConditionalRefund && committedRequestedQuantity && session.selectedQuantity
          ? [`Dạ em đã ghi nhận mình muốn lấy ${session.selectedQuantity} lọ ạ.`]
          : []),
      ];
      return this.respond(
        session,
        replies.length > 0
          ? replies
          : ["Dạ em chuyển bộ phận liên quan kiểm tra đúng câu hỏi này rồi phản hồi mình ạ."],
      );
    }

    if (requestedQuantity && requestedQuantity > 5) {
      pauseForHumanReview(session, "bulk_quantity_over_5", "CT.Giá/Ship");
      session.lastIntent = "buying";
      session.activeSkill = "order-closing";
      session.skillReason = "Số lượng từ 6 lọ trở lên bắt buộc chuyển tư vấn viên hỗ trợ riêng.";
      recordKnowledge(session, ["wholesale-dealer-handoff"]);
      return this.respond(session, wholesaleDealerHandoffReply(raw, requestedQuantity));
    }

    if (isQuantityShippingPolicyQuestion(text) || isPriceAndShippingPolicyQuestion(text)) {
      showPrice(session);
      session.lastIntent = "price_request";
      session.activeSkill = "direct-answer";
      session.skillReason =
        "Khách đang so sánh phí giao theo số lượng; trả chính sách xác định và không đổi đơn theo mệnh đề nếu.";
      overrideDecisionClassification(
        session,
        "price_request",
        "price",
        [],
        "Số lượng nằm trong câu hỏi giá/ship; không mở luồng thu đơn.",
      );
      recordKnowledge(session, ["pricing-approved-options-2026-08"]);
      return this.respond(
        session,
        isQuantityShippingPolicyQuestion(text)
          ? "Dạ 1 lọ giá 285.000đ + 30.000đ phí giao; 2 lọ 510.000đ, miễn phí giao ạ. Em chưa đổi số lượng theo câu điều kiện của mình nhé."
          : "Dạ 1 lọ giá 285.000đ + 30.000đ phí giao; combo 2 lọ 510.000đ, miễn phí giao ạ.",
      );
    }

    if (isPermanentControlQuestion(text) && isPriceRequest(text)) {
      showPrice(session);
      session.lastIntent = "product_effect";
      session.activeSkill = "direct-answer";
      session.skillReason = "Trả đủ hai ý công dụng lâu dài và giá trong cùng một lượt.";
      recordKnowledge(session, ["mechanism-control-not-permanent", "pricing-approved-options-2026-08"]);
      overrideDecisionClassification(
        session,
        "product_effect",
        "effectiveness",
        [],
        "Câu đa ý phải trả công dụng trước rồi mới báo giá.",
      );
      return this.respond(session, [
        "Dạ Stopirex hỗ trợ kiểm soát mồ hôi trong quá trình sử dụng và cần duy trì, không phải sản phẩm chữa khỏi vĩnh viễn ạ.",
        "1 lọ giá 285.000đ + 30.000đ phí giao; combo 2 lọ 510.000đ và được miễn phí giao ạ.",
      ]);
    }

    if (
      isDomesticDeliveryInspectionQuestion(text) &&
      !(session.selectedQuantity && isCompoundOrderUpdateQuestion(raw))
    ) {
      session.lastIntent = "order_support";
      session.activeSkill = "direct-answer";
      session.skillReason =
        "Trả lời riêng hai ý thời gian giao nội địa và kiểm hàng; không fallback sang bảng giá.";
      overrideDecisionClassification(
        session,
        "order_support",
        "delivery",
        [],
        "Câu hỏi logistics nội địa có Knowledge riêng cho ETA và kiểm hàng.",
      );
      recordKnowledge(session, ["domestic-delivery-inspection-policy"]);
      return this.respond(session, domesticDeliveryInspectionReply(text));
    }

    if (
      isDeliveryInspectionQuestion(text) &&
      !(session.selectedQuantity && isCompoundOrderUpdateQuestion(raw))
    ) {
      session.lastIntent = "order_support";
      session.activeSkill = "direct-answer";
      session.skillReason =
        "Câu hỏi kiểm hàng có chính sách đã duyệt; giữ mọi cập nhật đơn trong cùng lượt và trả lời trực tiếp.";
      overrideDecisionClassification(
        session,
        "order_support",
        "delivery",
        [],
        "Câu hỏi kiểm hàng phải dùng Knowledge nội địa thay vì fallback handoff.",
      );
      recordKnowledge(session, ["domestic-delivery-inspection-policy"]);
      const inspectionReply =
        "Dạ khi nhận hàng, mình được kiểm tra bao bì ngoài, tem và đúng lọ Stopirex; mình không mở seal sản phẩm trước khi xác nhận nhận hàng nhé ạ.";
      const deliveryNoteChanged = normalizeDeliveryNotes(raw).valid;
      return this.respond(
        session,
        deliveryNoteChanged && session.order.deliveryNote
          ? [
              `Dạ em đã cập nhật ghi chú giao hàng: “${session.order.deliveryNote}” ạ.`,
              inspectionReply,
            ]
          : inspectionReply,
      );
    }

    if (
      isDomesticDeliveryEtaQuestion(text) &&
      !(session.selectedQuantity && isCompoundOrderUpdateQuestion(raw))
    ) {
      session.lastIntent = "order_support";
      session.activeSkill = "direct-answer";
      session.skillReason =
        "Câu hỏi thời gian giao nội địa có Knowledge xác định; không chờ LLM và không làm gãy đơn.";
      overrideDecisionClassification(
        session,
        "order_support",
        "delivery",
        [],
        "Trả lời ETA theo chính sách nội địa và giữ nguyên state đơn hiện tại.",
      );
      recordKnowledge(session, ["domestic-delivery-inspection-policy"]);
      return this.respond(session, domesticDeliveryEtaPolicyReply());
    }

    if (!semanticRoutingReady && isHouseholdSharedUseQuestion(text)) {
      session.lastIntent = "product_effect";
      session.activeSkill = "direct-answer";
      session.skillReason = "Trả lời khả năng dùng chung cho người thân từ Knowledge đã duyệt.";
      session.orderCollectionPaused = Boolean(session.selectedQuantity);
      if (session.pipeline === "1.Phân loại") this.move(session, "classified");
      recordKnowledge(session, ["household-shared-use"]);
      overrideDecisionClassification(
        session,
        "product_effect",
        "effectiveness",
        [],
        "Câu hỏi về người thân dùng chung được trả lời trực tiếp, không mở handoff.",
      );
      return this.respond(
        session,
        "Dạ vợ mình dùng chung Stopirex được, không cần mua loại khác ạ. Sản phẩm hỗ trợ kiểm soát cả mồ hôi và mùi; mỗi người chỉ cần lăn một lớp mỏng buổi tối trên da sạch, khô và không dùng khi da đang trầy hoặc rát nhé.",
      );
    }

    if (isProductNatureAndScentQuestion(text)) {
      session.lastIntent = "product_comparison";
      session.activeSkill = "direct-answer";
      session.skillReason = "Định vị đúng bản chất sản phẩm và trả lời mùi theo Knowledge đã duyệt.";
      overrideDecisionClassification(
        session,
        "product_comparison",
        "comparison",
        [],
        "Câu hỏi phân biệt lăn tạo hương, thuốc và sản phẩm ngăn tiết mồ hôi.",
      );
      recordKnowledge(session, [
        "product-comparison-traditional-rollon",
        "business-approved-alcohol-odor-guidance-2026-08",
        "regulatory-product-notification-2022",
      ]);
      return this.respond(
        session,
        "Dạ Stopirex là dược mỹ phẩm ngăn tiết mồ hôi chuyên sâu, không phải lăn tạo hương hay thuốc điều trị ạ. Sản phẩm có mùi đặc trưng nhẹ, bay nhanh và không dùng hương thơm để che mùi.",
      );
    }

    if (isAlcoholAndPermanentPremiseQuestion(text)) {
      session.lastIntent = "product_effect";
      session.activeSkill = "direct-answer";
      session.skillReason =
        "Giữ đúng hai fact bắt buộc khi khách đối chiếu thông tin cồn và hiệu quả lâu dài.";
      if (session.pipeline === "1.Phân loại") this.move(session, "classified");
      recordKnowledge(session, [
        "business-approved-alcohol-odor-guidance-2026-08",
        "product-official-ingredient-list-2022",
        "mechanism-control-not-permanent",
      ]);
      return this.respond(session, alcoholAndPermanentReply());
    }

    if (isAlcoholAndScentPremiseQuestion(text)) {
      session.lastIntent = "product_comparison";
      session.activeSkill = "direct-answer";
      session.skillReason =
        "Bác bỏ riêng hai tiền đề phủ định về Alcohol và mùi bằng nội dung doanh nghiệp đã duyệt.";
      if (session.pipeline === "1.Phân loại") this.move(session, "classified");
      recordKnowledge(session, [
        "business-approved-alcohol-odor-guidance-2026-08",
        "product-official-ingredient-list-2022",
        "usage-morning-fragrance-layering",
      ]);
      return this.respond(
        session,
        "Dạ em xin thông tin chính xác đến mình ạ: Stopirex vẫn có chứa cồn (Alcohol) đóng vai trò làm dung môi trong ngưỡng an toàn, giúp da nhanh khô ráo. Sản phẩm có mùi dược tính đặc trưng nhẹ chứ không hoàn toàn không mùi như nước lọc, nhưng mùi sẽ bay hơi rất nhanh. Mình hoàn toàn yên tâm dùng chung với nước hoa mà không sợ bị lộn mùi đâu ạ.",
      );
    }

    if (isClothingCompensationQuestion(text)) {
      session.orderCollectionPaused = Boolean(session.selectedQuantity);
      session.lastIntent = "product_effect";
      session.activeSkill = "knowledge-handoff";
      session.skillReason =
        "Trả lời tính năng quần áo nhưng không tự cam kết bồi thường tài sản ngoài chính sách.";
      session.pipeline = "2.Đang tư vấn";
      recordKnowledge(session, [
        "usage-application-feel-clothing",
        "policy-clothing-damage-compensation-review",
        "refund-used-ineffective",
      ]);
      overrideDecisionClassification(
        session,
        "product_effect",
        "effectiveness",
        [],
        "Tách claim không ố áo khỏi yêu cầu bồi thường tài sản chưa được duyệt.",
      );
      return this.respond(
        session,
        "Dạ dùng đúng hướng dẫn, Stopirex không bám hay gây ố vàng áo: mình lăn mỏng trên da khô và chờ khô hẳn rồi mặc áo. Bên em không tự cam kết bồi thường áo trước; nếu thực tế phát sinh, mình gửi ảnh và thông tin đơn để bộ phận liên quan kiểm tra. Chính sách hoàn tiền áp dụng cho sản phẩm khi dùng đúng đủ 2 tuần mà chưa hiệu quả, không phải bồi thường áo ạ.",
      );
    }

    if (isHairRemovalSafetyQuestion(text)) {
      session.lastIntent = "usage_guidance";
      session.activeSkill = "solution-guidance";
      session.skillReason = "Safety rule độc lập cho thao tác nhổ/cạo/wax/triệt trước khi dùng.";
      session.pipeline = "2.Đang tư vấn";
      session.consultation = { ...session.consultation, stage: "S5.guidance" };
      recordKnowledge(session, ["usage-after-hair-removal"]);
      return this.respond(
        session,
        isHairRemovalMorningClothingQuestion(text)
          ? "Dạ mình chưa bôi ngay ạ. Sau nhổ, cạo, wax hoặc triệt lông, mình chờ 24–48 giờ và chỉ dùng khi da đã ổn. Stopirex dùng buổi tối trên da sạch, khô, lăn mỏng; chờ khô rồi mặc áo. Dùng đúng hướng dẫn, sản phẩm không bết và không gây ố vàng nách áo."
          : "Dạ mình không bôi ngay sau khi nhổ hoặc wax ạ. Mình chờ 24–48 giờ, đến khi da phục hồi hoàn toàn, không còn trầy, đỏ hoặc rát rồi mới lăn một lớp mỏng vào buổi tối để tránh xót và kích ứng nhé.",
      );
    }

    if (isUnderarmDarkeningObjection(text) && !(multiActionEnabled && semanticHasMultipleAnswerTopics)) {
      session.lastIntent = "product_effect";
      session.activeSkill = "solution-guidance";
      session.skillReason =
        "Giải đáp lo ngại thâm nách bằng điều kiện sử dụng đã được duyệt, không mở handoff.";
      overrideDecisionClassification(
        session,
        "product_effect",
        "effectiveness",
        [],
        "Lo ngại thâm nách được trả lời bằng hướng dẫn dùng trên da sạch, khô và lành.",
      );
      recordKnowledge(session, [
        "usage-underarm-darkening-prevention",
        "usage-after-hair-removal",
        ...(isDarkeningAndClothingQuestion(text) ? ["usage-application-feel-clothing"] : []),
      ]);
      const clothing = isDarkeningAndClothingQuestion(text)
        ? " Dùng đúng cách, sản phẩm cũng không bết và không gây ố vàng nách áo."
        : "";
      return this.respond(
        session,
        `Dạ Stopirex tập trung hỗ trợ kiểm soát mồ hôi và mùi, không phải sản phẩm trị thâm ạ. Thâm nách còn có thể liên quan đến ma sát, cạo nhổ hoặc kích ứng; mình nên lăn mỏng vào buổi tối khi da sạch, khô hoàn toàn và không dùng trên vùng đang trầy, đỏ, rát hoặc ngay sau cạo, nhổ hay wax.${clothing}`,
      );
    }

    if (isCombinedPregnancyAndChildQuestion(text)) {
      session.lastIntent = "safety";
      session.activeSkill = "direct-answer";
      session.skillReason = "Câu hỏi ghép hai đối tượng được trả lời đủ từng đối tượng trong cùng lượt.";
      session.pipeline = "2.Đang tư vấn";
      overrideDecisionClassification(
        session,
        "safety",
        "child_age",
        [],
        "Tách riêng phụ nữ mang thai và trẻ từ đủ 12 tuổi.",
      );
      recordKnowledge(session, ["audience-pregnancy", "audience-child-12-plus", "usage-child-12-plus"]);
      const age = extractAgeMention(text) ?? 12;
      return this.respond(
        session,
        `Dạ với phụ nữ đang mang thai, mình nên tham khảo ý kiến bác sĩ trước khi dùng Stopirex ạ. Bé ${age} tuổi đã từ đủ 12 tuổi nên có thể dùng theo đúng hướng dẫn, dưới sự hướng dẫn của người lớn: lăn mỏng vào buổi tối khi da lành, sạch và khô; không dùng khi da đang trầy, đỏ hoặc rát.`,
      );
    }

    if (isMorningWashAndFragranceQuestion(text)) {
      session.lastIntent = "usage_guidance";
      session.activeSkill = "solution-guidance";
      session.skillReason = "Trả lời đủ routine vệ sinh sáng và dùng sản phẩm tạo mùi ban ngày.";
      session.pipeline = "2.Đang tư vấn";
      recordKnowledge(session, ["usage-morning-wash-with-soap", "usage-morning-fragrance-layering"]);
      return this.respond(
        session,
        "Dạ sáng hôm sau mình tắm và rửa vùng nách bằng xà phòng bình thường, không cần chà mạnh và không làm mất tác dụng của lần dùng tối trước ạ. Mình không cần lăn lại buổi sáng; khi nách khô, mình có thể dùng nước hoa hoặc lăn tạo mùi ban ngày mà không ảnh hưởng.",
      );
    }

    if (isHandsOrFeetApplicationQuestion(text)) {
      session.lastIntent = "usage_guidance";
      session.activeSkill = "solution-guidance";
      session.skillReason = "Giữ đúng phạm vi vùng sử dụng đã được duyệt của sản phẩm.";
      session.pipeline = "2.Đang tư vấn";
      recordKnowledge(session, ["usage-approved-area-underarms-only"]);
      return this.respond(
        session,
        "Dạ Stopirex hiện được hướng dẫn dùng cho vùng nách, bên em không hướng dẫn lăn lên lòng bàn tay hoặc lòng bàn chân ạ. Mồ hôi tay/chân cần sản phẩm hoặc hướng dẫn phù hợp riêng; nếu ra nhiều và ảnh hưởng sinh hoạt, mình nên hỏi bác sĩ da liễu nhé.",
      );
    }

    if (isEligibleChildAgeQuestion(text)) {
      session.lastIntent = "safety";
      session.activeSkill = "direct-answer";
      session.skillReason = "Độ tuổi khách nêu đã có chính sách rõ, không handoff thêm.";
      overrideDecisionClassification(
        session,
        "safety",
        "child_age",
        [],
        "Trẻ từ đủ 12 tuổi đã có Knowledge sử dụng được theo đúng hướng dẫn.",
      );
      recordKnowledge(session, ["audience-child-12-plus"]);
      const age = extractAgeMention(text) ?? 12;
      session.pendingAction = "send_usage_guidance";
      session.pendingUsageAudience = "child";
      session.lastDecision.pendingActionAfter = "send_usage_guidance";
      return this.respond(
        session,
        `Dạ bé ${age} tuổi dùng được rồi ạ 😊\n\nNếu mình cần, em gửi thêm cách dùng phù hợp để bé sử dụng đúng ngay từ đầu nhé ạ.`,
      );
    }

    if (dynamicOpeningChoice === "1") {
      session.lastIntent = "consultation";
      session.activeSkill = "need-discovery";
      session.skillReason = "Khách chọn tư vấn tình trạng từ menu mở đầu đã hiển thị.";
      if (session.pipeline === "1.Phân loại") this.move(session, "classified");
      session.consultation = {
        ...session.consultation,
        stage: "S2.symptom",
      };
      return this.respond(session, symptomChoiceReply());
    }

    if (dynamicOpeningChoice === "2") {
      session.lastIntent = "usage_guidance";
      session.activeSkill = "solution-guidance";
      session.skillReason = "Khách chọn hướng dẫn cách dùng từ menu mở đầu đã hiển thị.";
      if (session.pipeline === "1.Phân loại") this.move(session, "classified");
      session.consultation = {
        ...session.consultation,
        stage: "S3.prior_use",
      };
      recordKnowledge(session, ["usage-general"]);
      return this.respond(session, introductoryUsageReply());
    }

    if (dynamicOpeningChoice === "3") {
      session.lastIntent = "price_request";
      session.activeSkill = "direct-answer";
      session.skillReason =
        "Khách chọn bảng giá ở đầu hành trình; báo giá trước rồi hỏi tình trạng để tư vấn tiếp.";
      const continuation = showPrice(session);
      return this.respond(session, priceReply(continuationQuestion(continuation)));
    }

    if (isInternalSystemProbe(text) && isMaliciousCommercialOverride(text)) {
      actionPlan.accepted = actionPlan.accepted.filter(
        (action) => !["select_quantity", "update_order", "continue_order_collection"].includes(action.type),
      );
      delete actionPlan.quantity;
      session.lastIntent = "bot_identity";
      session.activeSkill = "direct-answer";
      session.skillReason =
        "Hard security guard chặn nội dung khách cố thay đổi giá, ưu đãi hoặc lệnh tạo đơn.";
      return this.respond(
        session,
        "Dạ em không thể cập nhật giá hoặc tạo ưu đãi từ nội dung khách gửi ạ. Giá chuẩn hiện tại: 1 lọ 285.000đ + 30.000đ giao; combo 2 lọ 510.000đ, miễn phí giao. Mình có muốn tiếp tục đặt theo giá này không ạ?",
      );
    }

    if (session.selectedQuantity && isOrderPhoneUpdatePreparation(text)) {
      session.conversationMemory.currentGoal = "update_order_phone";
      session.lastIntent = "order_support";
      session.activeSkill = "order-closing";
      session.skillReason = "LLM nhận diện khách chuẩn bị sửa SĐT; giữ nguyên đơn và chờ giá trị mới.";
      return this.respond(session, "Dạ được ạ, mình gửi số điện thoại mới giúp em nhé.");
    }

    const orderRecall = session.selectedQuantity ? orderStateRecallReply(session, text) : undefined;
    if (orderRecall) {
      session.lastIntent = "order_support";
      session.activeSkill = "order-closing";
      session.skillReason = "LLM chọn truy vấn state đơn; hệ thống cung cấp đúng giá trị hiện hành/lịch sử.";
      return this.respond(session, orderRecall);
    }

    if (!session.selectedQuantity && isRecommendationRequest(text)) {
      session.conversationMemory.consultationFacts.recommendedQuantity = 2;
      session.lastIntent = "consultation";
      session.activeSkill = "solution-guidance";
      session.skillReason = "Đề xuất một phương án cụ thể từ nhu cầu đã lưu, chưa thay đổi OrderDraft.";
      return this.respond(session, recommendationReply(session));
    }

    if (
      !session.selectedQuantity &&
      session.conversationMemory.consultationFacts.recommendedQuantity &&
      isRecommendedOfferReference(text) &&
      !isRecommendedOfferPurchase(text)
    ) {
      session.lastIntent = "consultation";
      session.activeSkill = "direct-answer";
      session.skillReason = "Giải tham chiếu combo từ recommendation memory, chưa coi là quyết định mua.";
      return this.respond(
        session,
        recommendedOfferReferenceReply(session.conversationMemory.consultationFacts.recommendedQuantity),
      );
    }

    if (
      !session.selectedQuantity &&
      session.conversationMemory.consultationFacts.recommendedQuantity &&
      isRecommendationSuitabilityQuestion(text)
    ) {
      session.lastIntent = "consultation";
      session.activeSkill = "solution-guidance";
      session.skillReason = "Đối chiếu sản phẩm với structured consultation memory thay vì hỏi lại khách.";
      return this.respond(session, recommendationSuitabilityReply(session));
    }

    if (
      !session.selectedQuantity &&
      session.conversationMemory.consultationFacts.recommendedQuantity &&
      isRecommendedOfferPurchase(text)
    ) {
      const recommendation = session.conversationMemory.consultationFacts.recommendedQuantity;
      selectQuantity(session, recommendation);
      this.move(session, "agreed_to_buy");
      session.lastIntent = "buying";
      session.activeSkill = "order-closing";
      session.skillReason = "Khách chấp nhận chính phương án đã lưu trong recommendation memory.";
      return this.respond(session, orderCollectionReply(session));
    }

    if (isBeneficiaryUsageResolution(text)) {
      session.lastIntent = "consultation";
      session.activeSkill = "direct-answer";
      session.skillReason = "Khách xác nhận lại người dùng sản phẩm; giữ beneficiary đang hoạt động.";
      return this.respond(session, beneficiaryUsageResolutionReply(session));
    }

    const knowledgeFullyCoversQuestion = isKnowledgeFullyCoveredQuestion(text, semantic);
    const humanHandoff =
      multiActionEnabled && !knowledgeFullyCoversQuestion
        ? actionPlan.accepted.find((action) => action.type === "handoff_to_human")
        : undefined;
    const hasUnsupportedQuestions =
      !knowledgeFullyCoversQuestion && (semantic.unsupportedQuestions?.length ?? 0) > 0;
    if (
      multiActionEnabled &&
      actionPlan.shouldClarify &&
      semantic.intent === "knowledge_unknown" &&
      semantic.subject === "product" &&
      !protectedKnownAnswerConcern
    ) {
      session.orderCollectionPaused = Boolean(session.selectedQuantity);
      session.lastIntent = "knowledge_unknown";
      session.activeSkill = "direct-answer";
      session.skillReason =
        "LLM xác định tham chiếu sản phẩm còn mơ hồ; chỉ hỏi đúng đối tượng trước khi trả lời hoặc handoff.";
      return this.respond(
        session,
        "Dạ em chưa xác định được mình đang nói tới phiên bản nào ạ. Mình gửi giúp em tên hoặc ảnh sản phẩm đó nhé.",
      );
    }
    if (
      multiActionEnabled &&
      actionPlan.answerTopics.length > 0 &&
      (humanHandoff || hasUnsupportedQuestions)
    ) {
      const answer = multiActionAnswer(actionPlan.answerTopics, raw, semanticSlots);
      if (actionPlan.quantity) {
        selectQuantity(
          session,
          actionPlan.quantity,
          actionPlan.accepted.find((action) => action.type === "select_quantity"),
        );
        this.move(session, "agreed_to_buy");
      }
      pauseForHumanReview(session, humanHandoff?.reason ?? "Có phần câu hỏi chưa có dữ liệu được duyệt");
      session.orderCollectionPaused = true;
      session.lastIntent = actionPlan.primaryIntent ?? semantic.intent ?? "knowledge_unknown";
      session.activeSkill = "knowledge-handoff";
      session.skillReason =
        "Trả lời phần có nguồn trước, chuyển người cho phần thiếu và chưa tiếp tục thu thông tin đơn.";
      recordKnowledge(session, [...knowledgeForActionTopics(actionPlan.answerTopics, text)]);
      const handoff = unsupportedQuestionHandoffReply(raw, semantic.unsupportedQuestions ?? []);
      return this.respond(session, [
        answer,
        [
          handoff,
          ...(actionPlan.quantity
            ? [`Em đã ghi nhận mình muốn lấy ${quantityLabel(actionPlan.quantity)} ạ.`]
            : []),
        ].join("\n\n"),
      ]);
    }
    if (humanHandoff) {
      pauseForHumanReview(session, humanHandoff.reason ?? "Khách cần nhân viên kiểm tra thêm");
      session.lastIntent = semantic.intent ?? "knowledge_unknown";
      session.activeSkill = "knowledge-handoff";
      session.skillReason = "Action Planner yêu cầu chuyển người và đã được Reconciler chấp nhận.";
      if (isPriorSweatProcedureEffectQuestion(text)) {
        return this.respond(session, productComparisonReply(hasRecentlySentPrice(session), text));
      }
      if (priorOtherProductAdverseExperience) {
        return this.respond(session, productComparisonReply(hasRecentlySentPrice(session), text));
      }
      return this.respond(
        session,
        "Dạ em đã ghi nhận nội dung mình cần hỗ trợ. Em chuyển bộ phận liên quan kiểm tra và phản hồi lại mình ạ.",
      );
    }

    // The LLM remains the intent/action owner. This is only a grounded renderer
    // fallback when it produced an answer action but its draft omitted the
    // approved source IDs, so the legacy discovery flow must not replace the
    // product answer with an unrelated question.
    const batchedMultiTopicQuestion =
      raw.split(/\r?\n/u).filter((line) => line.trim()).length > 1 && actionPlan.answerTopics.length > 1;
    if (
      multiActionEnabled &&
      actionPlan.answerTopics.length > 0 &&
      (isApprovedProductAnswerFallback(text) || batchedMultiTopicQuestion)
    ) {
      session.lastIntent =
        effectiveExactIntent ?? actionPlan.primaryIntent ?? semantic.intent ?? "consultation";
      session.activeSkill = ["usage_guidance", "usage_time", "usage_frequency"].includes(session.lastIntent)
        ? "solution-guidance"
        : "direct-answer";
      session.skillReason =
        "LLM đã xác định hành động trả lời; Response Planner dựng lại bằng Knowledge đã duyệt.";
      if (session.pipeline === "1.Phân loại") this.move(session, "classified");
      recordKnowledge(session, knowledgeForActionTopics(actionPlan.answerTopics, text));
      return this.respond(session, multiActionAnswer(actionPlan.answerTopics, raw, semanticSlots));
    }

    if (
      multiActionEnabled &&
      actionPlan.conflicts.some((conflict) =>
        conflict.includes("vừa có tín hiệu mua vừa có tín hiệu từ chối mua"),
      )
    ) {
      session.orderCollectionPaused = true;
      session.lastIntent = "other";
      session.activeSkill = "direct-answer";
      session.skillReason =
        "Tin nhắn chứa đồng thời quyết định mua và không mua nên chỉ hỏi lại đúng điểm xung đột.";
      return this.respond(
        session,
        "Dạ em chưa rõ quyết định cuối của mình ạ: mình muốn đặt sản phẩm hay tạm thời chưa lấy ạ?",
      );
    }

    if (
      multiActionEnabled &&
      actionPlan.quantity &&
      actionPlan.answerTopics.length > 0 &&
      orderMutationAllowed
    ) {
      delete session.pendingAction;
      delete session.lastDecision.pendingActionAfter;
      const quantity = actionPlan.quantity;
      if (effectiveExactIntent === "negotiation") {
        approveSingleShipping(session);
      }
      const answer = multiActionAnswer(actionPlan.answerTopics, raw, semanticSlots);
      selectQuantity(
        session,
        quantity,
        actionPlan.accepted.find((action) => action.type === "select_quantity"),
      );
      if (!canEditCreatedInboxOrder) this.move(session, "agreed_to_buy");
      session.lastIntent = "buying";
      session.activeSkill = "order-closing";
      session.skillReason =
        "Một tin nhắn có nhiều hành động: trả lời câu hỏi trước, sau đó ghi nhận số lượng và tiếp tục thu đơn.";
      session.signal = undefined;
      recordKnowledge(session, knowledgeForActionTopics(actionPlan.answerTopics, text));
      const recordedOrderData = mergeOrderData(session, raw) || semanticOrderDataRecorded;
      if (recordedOrderData && orderHasAllFields(session.order)) {
        session.pendingAction = "confirm_order";
        session.lastDecision.pendingActionAfter = "confirm_order";
      }
      return this.respond(session, [
        answer,
        recordedOrderData
          ? orderCollectionReply(session, raw)
          : multiActionOrderInformationRequestReply(quantity),
      ]);
    }

    if (
      multiActionEnabled &&
      actionPlan.quantity &&
      actionPlan.answerTopics.length === 0 &&
      orderMutationAllowed
    ) {
      delete session.pendingAction;
      delete session.lastDecision.pendingActionAfter;
      const quantity = actionPlan.quantity;
      selectQuantity(
        session,
        quantity,
        actionPlan.accepted.find((action) => action.type === "select_quantity"),
      );
      if (!canEditCreatedInboxOrder) this.move(session, "agreed_to_buy");
      session.orderCollectionPaused = false;
      session.lastIntent = "buying";
      session.activeSkill = "order-closing";
      session.skillReason =
        "State Reducer thực thi action số lượng đã được LLM đề xuất và Reconciler xác minh bằng evidence của khách.";
      session.signal = undefined;
      const recordedOrderData = mergeOrderData(session, raw) || semanticOrderDataRecorded;
      if (recordedOrderData && orderHasAllFields(session.order)) {
        session.pendingAction = "confirm_order";
        session.lastDecision.pendingActionAfter = "confirm_order";
      }
      return this.respond(session, orderCollectionReply(session, recordedOrderData ? raw : undefined));
    }

    if (
      multiActionEnabled &&
      decision.intent === "buying" &&
      !session.selectedQuantity &&
      !actionPlan.quantity &&
      actionPlan.answerTopics.length === 0 &&
      actionPlan.conflicts.length === 0 &&
      actionPlan.rejected.some(
        ({ action }) => action.type === "continue_order_collection" && action.source === "llm",
      ) &&
      orderMutationAllowed
    ) {
      session.lastIntent = "buying";
      session.activeSkill = "order-closing";
      session.skillReason =
        "LLM xác định khách muốn mua nhưng chưa phát hành số lượng có thể commit; chỉ hỏi đúng trường còn thiếu thay vì quay lại khai thác tình trạng.";
      session.pendingAction = "choose_quantity";
      session.lastDecision.pendingActionAfter = "choose_quantity";
      session.orderCollectionPaused = false;
      return this.respond(session, "Dạ mình muốn lấy mấy lọ Stopirex (1–5 lọ) để em ghi nhận chính xác ạ?");
    }

    const compoundOrderQuantity = session.selectedQuantity
      ? resolveQuantitySelection(text, semantic, session)
      : undefined;
    if (orderMutationAllowed && compoundOrderQuantity && isCompoundOrderUpdateQuestion(raw)) {
      delete session.pendingAction;
      delete session.lastDecision.pendingActionAfter;
      selectQuantity(session, compoundOrderQuantity);
      mergeOrderData(session, raw);
      const destination = extractDeliveryDestination(raw);
      if (destination) commitLegacyAddress(session, destination, "append", raw);
      session.pipeline = canEditCreatedInboxOrder ? "6.Đã tạo đơn" : "5.Chờ TT KH";
      session.consultation = {
        ...session.consultation,
        stage: "S8.order",
      };
      session.lastIntent = "order_support";
      session.activeSkill = "order-closing";
      session.skillReason =
        "Khách vừa cập nhật đơn và hỏi chính sách nhận hàng; ghi dữ liệu mới trước rồi chỉ hỏi phần còn thiếu.";
      recordKnowledge(session, ["authenticity-before-purchase"]);
      return this.respond(session, compoundOrderUpdateReply(session, raw));
    }

    if (decision.route === "pending_action" && session.pendingAction === "send_usage_guidance") {
      const audience = session.pendingUsageAudience ?? "general";
      delete session.pendingAction;
      delete session.pendingUsageAudience;
      delete session.lastDecision.pendingActionAfter;
      session.lastIntent = "usage_guidance";
      session.signal = undefined;
      session.pipeline = "2.Đang tư vấn";
      session.consultation = {
        ...session.consultation,
        stage: "S5.guidance",
      };
      recordKnowledge(session, [audience === "child" ? "usage-child-12-plus" : "usage-general"]);
      return this.respond(
        session,
        audience === "child" ? childUsageGuidanceReply() : generalUsageGuidanceReply(),
      );
    }
    if (decision.route === "pending_action" && session.pendingAction === "send_price") {
      delete session.pendingAction;
      delete session.lastDecision.pendingActionAfter;
      const continuation = showPrice(session);
      session.lastIntent = "price_request";
      return this.respond(session, priceReply(continuationQuestion(continuation)));
    }
    if (decision.route === "pending_action" && session.pendingAction === "send_authenticity_legal_summary") {
      delete session.pendingAction;
      delete session.lastDecision.pendingActionAfter;
      session.lastIntent = "authenticity_question";
      session.activeSkill = "direct-answer";
      session.skillReason =
        "Khách xác nhận đề nghị ngay trước đó; gửi đúng phần pháp lý đã hứa và không mở luồng chọn số lượng.";
      recordKnowledge(session, ["authenticity-legal-summary", "regulatory-product-notification-2022"]);
      return this.respond(session, authenticityLegalSummaryReply());
    }
    if (
      decision.route === "pending_action" &&
      session.pendingAction === "choose_quantity" &&
      !resolveQuantitySelection(text, semantic, session)
    ) {
      return this.respond(
        session,
        "Dạ mình chọn giúp em số lượng từ 1 đến 5 lọ nhé. Từ 6 lọ bên em có tư vấn viên hỗ trợ riêng ạ.",
      );
    }
    if (decision.route === "pending_action" && session.pendingAction === "confirm_order") {
      return this.respond(
        session,
        "Dạ để tránh sai thông tin đơn, mình phản hồi “ĐÚNG” hoặc “ĐỒNG Ý” giúp em nhé ạ.",
      );
    }
    if (
      session.pendingAction &&
      session.pendingAction !== "choose_quantity" &&
      session.pendingAction !== "confirm_order"
    ) {
      delete session.pendingAction;
      delete session.pendingUsageAudience;
      delete session.lastDecision.pendingActionAfter;
    }

    if (session.openingVariantId === "A.choice" && session.consultation.stage === "S0.new" && text === "2") {
      session.lastIntent = "price_request";
      const continuation = showPrice(session);
      return this.respond(session, priceReply(continuationQuestion(continuation)));
    }

    if (session.openingVariantId === "A.choice" && session.consultation.stage === "S0.new" && text === "1") {
      session.lastIntent = "consultation";
      if (session.pipeline === "1.Phân loại") this.move(session, "classified");
      session.consultation = {
        ...session.consultation,
        stage: "S1.context",
        asked: [
          ...session.consultation.asked,
          "Tình trạng của mình thường chỉ xuất hiện khi vận động/ngoài trời, hay cả lúc ngồi điều hòa hoặc căng thẳng cũng bị ạ?",
        ],
      };
      return this.respond(
        session,
        "Dạ vâng, em kiểm tra nhanh tình trạng trước để hướng dẫn đúng cách cho mình ạ.\n\nTình trạng của mình thường chỉ xuất hiện khi vận động/ngoài trời, hay cả lúc ngồi điều hòa hoặc căng thẳng cũng bị ạ?",
      );
    }

    if (session.openingVariantId === "C.prior" && session.consultation.stage === "S0.new" && text === "1") {
      session.lastIntent = "usage_guidance";
      session.consultation = {
        ...session.consultation,
        stage: "S3.prior_use",
      };
      return this.respond(session, introductoryUsageReply());
    }

    if (session.openingVariantId === "C.prior" && session.consultation.stage === "S0.new" && text === "2") {
      session.lastIntent = "consultation";
      session.consultation = {
        ...session.consultation,
        stage: "S2.symptom",
      };
      return this.respond(session, symptomChoiceReply());
    }

    if (decision.route === "order_confirmation") {
      session.orderCollectionPaused = false;
      delete session.pendingAction;
      delete session.lastDecision.pendingActionAfter;
      commitOrderMutations(session, [{ type: "confirm_order", confirmedAt: new Date(), evidence: raw }]);
      assertOrderReady(session.order);
      this.move(session, "order_created");
      session.signal = undefined;
      session.lastIntent = "buying";
      return this.respond(session, [orderCreatingReply(session), orderCreatedReply(session)]);
    }

    if (decision.route === "order_collection") {
      session.orderCollectionPaused = false;
      session.lastIntent = "order_support";
      const recorded = mergeOrderData(session, raw) || semanticOrderDataRecorded;
      session.pipeline = canEditCreatedInboxOrder ? "6.Đã tạo đơn" : "5.Chờ TT KH";
      session.consultation = {
        ...session.consultation,
        stage: "S8.order",
      };
      if (recorded && orderHasAllFields(session.order)) {
        session.pendingAction = "confirm_order";
        session.lastDecision.pendingActionAfter = "confirm_order";
      }
      return this.respond(
        session,
        recorded ? orderCollectionReply(session, raw) : orderCollectionClarificationReply(session),
      );
    }

    if (decision.route === "clarification") {
      session.orderCollectionPaused = true;
      session.lastIntent = "other";
      session.activeSkill = "direct-answer";
      session.skillReason = "Tin hiện tại chưa đủ rõ và không có bằng chứng là dữ liệu đơn hàng.";
      return this.respond(session, contextualOrderClarificationReply(session, raw));
    }

    const postPriceQuantity = resolveQuantitySelection(text, semantic, session);
    if (
      postPriceQuantity &&
      !conditionalNoIrritationPurchase &&
      (session.pipeline === "3.Đã báo giá" ||
        session.pipeline === "4.XL băn khoăn" ||
        session.pipeline === "7.Chờ followup" ||
        session.pendingAction === "choose_quantity") &&
      (isExplicitQuantitySelection(text) ||
        isBareQuantityReply(text) ||
        isNegotiation(text) ||
        isLikelyOrderData(raw, session.order))
    ) {
      if (isNegotiation(text)) approveSingleShipping(session);
      delete session.pendingAction;
      delete session.lastDecision.pendingActionAfter;
      selectQuantity(session, postPriceQuantity);
      this.move(session, "agreed_to_buy");
      session.lastIntent = "buying";
      session.activeSkill = "order-closing";
      session.skillReason = "Khách đã chọn số lượng rõ ràng sau khi nhận báo giá.";
      session.signal = undefined;
      const recordedOrderData = mergeOrderData(session, raw) || semanticOrderDataRecorded;
      if (recordedOrderData) {
        if (orderHasAllFields(session.order)) {
          session.pendingAction = "confirm_order";
          session.lastDecision.pendingActionAfter = "confirm_order";
        }
        return this.respond(session, orderCollectionReply(session, raw));
      }
      if (isNegotiation(text)) {
        return this.respond(
          session,
          negotiationReply(text, session.freeShippingApproved, session.selectedQuantity),
        );
      }
      return this.respond(session, orderInformationRequestReply(postPriceQuantity));
    }

    const directIntent = decision.intent;
    if (
      session.pipeline === "6.Đã tạo đơn" &&
      !targetsExistingCompletedOrder(text, directIntent, actionPlan.accepted)
    ) {
      // A completed order is historical context, not the active goal of every
      // later message. Only an explicit order/tracking/edit request may keep
      // the completed-order lock. A greeting, a product question or a current
      // price question starts a fresh conversational turn.
      if (canEditCreatedInboxOrder) {
        // Do not erase a pending operational order just because the active
        // conversational goal changed. Park collection while retaining the
        // authoritative order aggregate and its audit history.
        session.pipeline = "4.XL băn khoăn";
        session.consultation = {
          ...session.consultation,
          stage: "S5.guidance",
        };
        session.orderCollectionPaused = true;
      } else {
        clearOrderDraft(session);
        session.pipeline = "1.Phân loại";
        session.consultation = {
          ...session.consultation,
          stage: "S0.new",
        };
        session.orderCollectionPaused = false;
        delete session.orderEditable;
      }
      delete session.pendingAction;
      delete session.lastDecision.pendingActionAfter;
      delete session.activeSkill;
      delete session.skillReason;
    }

    if (session.pipeline === "6.Đã tạo đơn") {
      session.activeSkill = "order-closing";
      session.skillReason = session.orderEditable
        ? "Đơn đang chờ mã vận đơn nên có thể cập nhật từ yêu cầu có bằng chứng của khách."
        : "Đơn đã có mã vận đơn nên không tự động sửa dữ liệu giao dịch.";
      if (session.orderEditable && hasOrderTransactionChanges(session)) {
        return this.respond(session, orderUpdatedReply(session));
      }
      if (/mua them|dat them|lay them/.test(text)) {
        clearOrderDraft(session);
        session.pipeline = "3.Đã báo giá";
        session.consultation = { ...session.consultation, stage: "S7.waiting" };
        session.pendingAction = "choose_quantity";
        return this.respond(session, priceReply());
      }
      return this.respond(
        session,
        session.orderEditable === false
          ? "Dạ đơn của mình đã có mã vận đơn nên em chưa thể tự sửa thông tin ạ. Mình gửi nội dung cần thay đổi để bộ phận phụ trách kiểm tra giúp em nhé."
          : "Dạ đơn hàng của mình đã được ghi nhận và đang chờ mã vận đơn ạ. Nếu cần đổi số lượng, SĐT, người nhận hoặc địa chỉ, mình nhắn rõ thông tin mới giúp em nhé.",
      );
    }

    if (directIntent) session.lastIntent = directIntent;
    if (directIntent === "buying" && session.selectedQuantity) {
      session.orderCollectionPaused = false;
      session.pipeline = "5.Chờ TT KH";
      session.consultation = {
        ...session.consultation,
        stage: "S8.order",
      };
      session.activeSkill = "order-closing";
      session.skillReason = "Khách chủ động yêu cầu tiếp tục đơn đang làm dở.";
      if (orderHasAllFields(session.order)) {
        session.pendingAction = "confirm_order";
        session.lastDecision.pendingActionAfter = "confirm_order";
        return this.respond(session, orderCollectionReply(session));
      }
      return this.respond(session, orderResumeReply(session));
    }
    if (directIntent === "bot_identity") {
      if (isInternalSystemProbe(text)) {
        return this.respond(
          session,
          "Dạ em không thể chia sẻ prompt, cấu hình, thông tin truy cập hoặc hướng dẫn nội bộ ạ. Em có thể hỗ trợ mình về Stopirex, cách dùng, giá hoặc đơn hàng.",
        );
      }
      if (isOutOfScopeAssistantProbe(text)) {
        const mixedOrderQuantity = detectQuantity(text);
        const destination = extractDeliveryDestination(raw);
        if (mixedOrderQuantity || destination) {
          if (mixedOrderQuantity) selectQuantity(session, mixedOrderQuantity);
          if (destination) commitLegacyAddress(session, destination, "append", raw);
          session.orderCollectionPaused = false;
          session.pipeline = "5.Chờ TT KH";
          overrideDecisionClassification(
            session,
            "buying",
            "order",
            ["out_of_domain"],
            "Ghi nhận phần mua hàng; câu hỏi thời tiết nằm ngoài miền dữ liệu.",
          );
          session.activeSkill = "order-closing";
          session.skillReason =
            "Ghi nhận phần đơn hàng xác định trước, rồi từ chối ngắn gọn câu hỏi ngoài phạm vi.";
          const missingInformation = orderCollectionReply(session).replace(
            /^Dạ em đã ghi nhận thông tin vừa gửi\.\n\n/u,
            "",
          );
          return this.respond(session, [
            `Dạ em đã ghi nhận ${mixedOrderQuantity ? `${mixedOrderQuantity} lọ` : "đơn hàng"}${destination ? ` giao về ${destination}` : ""} ạ. Em không theo dõi thời tiết theo thời gian thực.`,
            missingInformation,
          ]);
        }
        return this.respond(
          session,
          "Dạ em là trợ lý hỗ trợ Stopirex nên em không theo dõi thời tiết hay thông tin bên ngoài theo thời gian thực ạ. Mình cần em hỗ trợ về sản phẩm, cách dùng, giá hay đơn hàng?",
        );
      }
      return this.respond(
        session,
        "Dạ em là trợ lý tư vấn tự động của Stopirex ạ.\n\nEm có thể hỗ trợ mình về sản phẩm, cách dùng, giá và đơn hàng. Nội dung nào cần kiểm tra thêm, em sẽ chuyển bộ phận liên quan xác minh giúp mình.",
      );
    }
    if (directIntent === "promotion_inquiry") {
      session.lastIntent = "promotion_inquiry";
      if (isUnverifiedGiftClaim(text)) {
        session.activeSkill = "direct-answer";
        session.skillReason = "Đối chiếu quà tặng với chương trình hiện hành đã duyệt.";
        recordKnowledge(session, [
          "pricing-approved-options-2026-08",
          "promotion-current-no-gift",
          "promotion-multiuse-bag-from-two",
        ]);
        return this.respond(
          session,
          "Dạ hiện không có quà sữa tắm ạ. Đơn từ 2 lọ trở lên được miễn phí giao và tặng 1 túi đa năng vải dệt Stopirex ạ.",
        );
      }
      pauseForHumanReview(session, "promotion_not_verified", "CT.Giá/Ship");
      const discount = semantic.discountAmountVnd ?? extractDiscountAmountVnd(text);
      return this.respond(session, promotionVerificationReply(discount, hasRecentlySentPrice(session)));
    }
    if (directIntent === "knowledge_unknown") {
      session.lastIntent = "knowledge_unknown";
      pauseForHumanReview(session, "knowledge_not_verified");
      return this.respond(
        session,
        "Dạ nội dung mình hỏi hiện chưa có trong thông tin đã được bên em xác nhận, nên em chưa muốn trả lời vội làm mình hiểu sai.\n\nAnh/chị gửi thêm ảnh, đường link hoặc thông tin mình đã xem giúp em nhé. Em chuyển bộ phận liên quan kiểm tra và phản hồi lại mình sau khi xác minh ạ.",
      );
    }
    if (directIntent === "price_change") {
      session.signal = "CT.Giá/Ship";
      session.pipeline = "4.XL băn khoăn";
      const answer = priceChangeReply(raw, semantic);
      recordKnowledge(session, answer.knowledgeEntityIds);
      session.pendingAction = "send_price";
      session.lastDecision.pendingActionAfter = "send_price";
      return this.respond(session, answer.reply);
    }

    if (directIntent === "negotiation") {
      approveSingleShipping(session);
      session.lastIntent = "negotiation";
      session.signal = "CT.Giá/Ship";
      session.pipeline = "4.XL băn khoăn";
      session.consultation = {
        ...session.consultation,
        stage: "S7.waiting",
      };
      return this.respond(
        session,
        negotiationReply(text, session.freeShippingApproved, session.selectedQuantity),
      );
    }
    if (directIntent === "price_request") {
      const effectTopic = productEffectTopic(text, semanticSlots);
      if (effectTopic) {
        showPrice(session);
        session.lastIntent = "product_effect";
        session.activeSkill = "direct-answer";
        session.skillReason =
          "LLM không khả dụng; trả đủ câu hỏi hiệu quả và giá bằng Knowledge cùng catalog đã duyệt.";
        recordKnowledge(session, [
          "product-comparison-traditional-rollon",
          "pricing-approved-options-2026-08",
        ]);
        return this.respond(session, multiActionAnswer(["effectiveness", "price"], raw, semanticSlots));
      }
      const continuation = showPrice(session);
      return this.respond(session, priceReplyForRequest(text, continuationQuestion(continuation)));
    }

    if (directIntent === "order_support" && isReturnsPolicyQuestion(text)) {
      session.lastIntent = "order_support";
      session.activeSkill = "direct-answer";
      session.skillReason =
        "Khách hỏi chính sách đổi trả/hoàn tiền đã được duyệt; trả lời trực tiếp theo điều kiện áp dụng.";
      const usedIneffectiveRefund = isUsedIneffectiveRefundQuestion(text);
      const hypotheticalIrritationRefund = isHypotheticalIrritationRefundQuestion(text);
      if (usedIneffectiveRefund || hypotheticalIrritationRefund) {
        session.pendingPolicyContext = "refund_used_ineffective";
      }
      recordKnowledge(
        session,
        hypotheticalIrritationRefund
          ? ["safety-irritation-hypothetical", "refund-used-ineffective"]
          : usedIneffectiveRefund
            ? ["refund-used-ineffective"]
            : ["returns-eligibility", "returns-exclusions", "returns-process-fees-refund"],
      );
      if (!usedIneffectiveRefund && /vo hop|boc rach|vut (?:vo|hop)|mat vo|khong con vo/.test(text)) {
        pauseForHumanReview(session, "return_logistics_requires_review");
        session.activeSkill = "knowledge-handoff";
        session.skillReason =
          "Trả lời điều kiện hoàn tiền trước, chuyển người kiểm tra ngoại lệ vỏ hộp và cách gửi trả.";
      }
      return this.respond(session, returnsPolicyReply(text));
    }

    if (directIntent === "order_support" && isWholesaleDealerInquiry(text)) {
      pauseForHumanReview(session, "wholesale_or_dealer_request", "CT.Giá/Ship");
      session.lastIntent = "order_support";
      session.activeSkill = "knowledge-handoff";
      session.skillReason = "Nhu cầu sỉ/đại lý phải chuyển nhân viên kinh doanh xác nhận chính sách.";
      recordKnowledge(session, ["wholesale-dealer-handoff"]);
      return this.respond(session, wholesaleDealerHandoffReply(raw));
    }

    if (directIntent === "safety") {
      session.lastIntent = "safety";
      session.signal = "CT.An toàn";
      if (isKnownAluminumSaltAllergy(text)) {
        pauseForHumanReview(session, "known_aluminum_salt_allergy", "CT.An toàn");
        session.activeSkill = "safety-first";
        session.skillReason =
          "Khách đã biết mình dị ứng muối nhôm; dừng chốt đơn và chuyển người kiểm tra thành phần.";
        recordKnowledge(session, ["safety-known-aluminum-salt-allergy"]);
        return this.respond(
          session,
          "Dạ nếu mình đã từng dị ứng muối nhôm thì chưa nên dùng Stopirex ạ. Em chuyển bộ phận liên quan kiểm tra đúng bảng thành phần; mình cũng nên hỏi bác sĩ da liễu trước khi sử dụng nhé.",
        );
      }
      if (session.pipeline === "1.Phân loại") this.move(session, "classified");
      else if (session.pipeline === "0.Chưa tư vấn") session.pipeline = "2.Đang tư vấn";
      const confirmedChildAge = confirmedChildAgeFromSession(session);
      const answer = audienceSafetyReply(
        text,
        semantic,
        confirmedChildAge === undefined ? {} : { confirmedChildAge },
      );
      recordKnowledge(session, answer.knowledgeEntityIds);
      if (answer.reply.includes("gửi thêm cách dùng")) {
        session.pendingAction = "send_usage_guidance";
        session.pendingUsageAudience = "child";
        session.lastDecision.pendingActionAfter = "send_usage_guidance";
      } else {
        delete session.pendingAction;
        delete session.pendingUsageAudience;
        delete session.lastDecision.pendingActionAfter;
      }
      return this.respond(session, answer.reply);
    }

    if (directIntent === "efficacy_objection") {
      session.lastIntent = "efficacy_objection";
      session.signal = "CT.Hiệu quả";
      session.pipeline = "4.XL băn khoăn";
      session.consultation = mergeConfirmedSlots(session.consultation, semanticSlots);
      session.consultation = {
        ...session.consultation,
        stage: "S5.guidance",
      };
      session.pendingAction = "send_usage_guidance";
      session.pendingUsageAudience = "general";
      session.lastDecision.pendingActionAfter = "send_usage_guidance";
      return this.respond(
        session,
        "Dạ Stopirex hỗ trợ kiểm soát tình trạng ra nhiều mồ hôi ạ. Mình dùng buổi tối khi da sạch, khô, lăn một lớp mỏng và theo dõi trong 2 tuần đầu.\n\nNếu chưa cải thiện, mình nhắn lại để bên em kiểm tra cách dùng và hỗ trợ tiếp nhé ạ.",
      );
    }

    if (directIntent === "product_comparison") {
      session.lastIntent = "product_comparison";
      session.signal = undefined;
      if (session.pipeline === "1.Phân loại") this.move(session, "classified");
      else if (session.pipeline === "0.Chưa tư vấn") session.pipeline = "2.Đang tư vấn";
      session.consultation = {
        ...session.consultation,
        stage: "S5.guidance",
      };
      recordKnowledge(session, [
        "product-comparison-traditional-rollon",
        ...(isPriorOtherProductAdverseExperience(text) ? ["safety-irritation-hypothetical"] : []),
        ...(isNamedCompetitorChallenge(text)
          ? [
              "competitor-neutral-advice",
              "product-composition-tolerance-approved",
              "product-official-ingredient-list-2022",
              "lab-test-2025-skin-irritation",
            ]
          : []),
      ]);
      return this.respond(session, productComparisonReply(hasRecentlySentPrice(session), text));
    }

    if (directIntent === "authenticity_question") {
      session.lastIntent = "authenticity_question";
      session.signal = "SC.Hàng giả";
      session.pipeline = "4.XL băn khoăn";
      session.consultation = {
        ...session.consultation,
        stage: "S5.guidance",
      };
      if (isProductCompositionMythQuestion(text)) {
        recordKnowledge(session, [
          "product-official-version-and-false-ingredients",
          "authenticity-legal-summary",
          ...(isIndustrialAlcoholMythQuestion(text)
            ? [
                "product-composition-tolerance-approved",
                "product-official-ingredient-list-2022",
                "mechanism-control-not-permanent",
              ]
            : []),
        ]);
        return this.respond(
          session,
          isIndustrialAlcoholMythQuestion(text)
            ? "Dạ hồ sơ công bố của Stopirex có thành phần Alcohol dùng trong công thức mỹ phẩm, không có dữ liệu nào ghi sản phẩm chứa ‘cồn công nghiệp’ ạ. Stopirex hỗ trợ kiểm soát mồ hôi và không làm teo tuyến mồ hôi vĩnh viễn."
            : "Dạ thông tin này chưa đúng với hồ sơ sản phẩm chính thức bên em ạ. Stopirex không có phiên bản nắp vàng chứa nọc rắn hay thông tin 50% muối nhôm. Sản phẩm có hồ sơ công bố và kết quả thử nghiệm; riêng lo ngại về ung thư vú, em không tự đưa kết luận y khoa, mình nên hỏi bác sĩ để được đánh giá đúng nhé.",
        );
      }
      recordKnowledge(session, [
        "authenticity-before-purchase",
        "authenticity-legal-summary",
        "regulatory-product-notification-2022",
      ]);
      session.pendingAction = "send_authenticity_legal_summary";
      session.lastDecision.pendingActionAfter = "send_authenticity_legal_summary";
      return this.respond(
        session,
        "Dạ sản phẩm Stopirex bên em cung cấp là hàng chính hãng, nhập khẩu chính ngạch, có hồ sơ công bố sản phẩm và kết quả thử nghiệm ạ.\n\nKhi nhận hàng, mình có thể đối chiếu bao bì, tem, đúng tên sản phẩm và thông tin người gửi; nếu có điểm không khớp, mình có quyền từ chối nhận và liên hệ bên em kiểm tra.\n\nEm gửi mình phần thông tin pháp lý tóm tắt để tham khảo nhé?",
      );
    }

    const effectTopic = productEffectTopic(text, semanticSlots);
    if (directIntent === "product_effect" && isProductPurposeQuestion(text)) {
      session.lastIntent = "product_effect";
      session.consultation = { ...session.consultation, stage: "S5.guidance" };
      session.signal = undefined;
      if (session.pipeline === "1.Phân loại") this.move(session, "classified");
      else if (session.pipeline === "0.Chưa tư vấn") session.pipeline = "2.Đang tư vấn";
      recordKnowledge(session, ["product-comparison-traditional-rollon"]);
      return this.respond(
        session,
        "Dạ Stopirex là dòng ngăn tiết mồ hôi chuyên sâu, hỗ trợ giảm nách ẩm ướt và kiểm soát mùi cơ thể ạ.",
      );
    }
    if (directIntent === "product_effect" || (semantic.asksDirectAnswer === true && effectTopic)) {
      const topic = effectTopic ?? semanticSlots.primarySymptom ?? "both";
      session.lastIntent = "product_effect";
      session.consultation = mergeConfirmedSlots(session.consultation, {
        ...semanticSlots,
        primarySymptom: topic,
      });
      session.consultation = {
        ...session.consultation,
        stage: "S5.guidance",
      };
      const nextQuestion = session.orderCollectionPaused
        ? undefined
        : nextProductEffectQuestion(session.consultation.asked, hasRecentlySentPrice(session));
      if (nextQuestion) {
        session.consultation = {
          ...session.consultation,
          asked: [...session.consultation.asked, nextQuestion],
        };
      }
      session.signal = undefined;
      if (session.pipeline === "1.Phân loại") this.move(session, "classified");
      recordKnowledge(session, [
        ...(isEffectivenessJourneyQuestion(text)
          ? ["effectiveness-usage-journey", "product-training-72h-conditional-claim", "usage-general"]
          : ["product-comparison-traditional-rollon"]),
        ...(isApplicationFeelOrClothingConcern(text) ? ["usage-application-feel-clothing"] : []),
        ...(isSweatWashOffConcern(text) ? ["usage-exercise-sweat-washoff"] : []),
        ...(isPermanentControlQuestion(text) ? ["mechanism-control-not-permanent"] : []),
        ...(isFragranceAndWetnessPreference(text)
          ? ["usage-morning-fragrance-layering", "usage-application-feel-clothing"]
          : []),
      ]);
      return this.respond(session, productEffectReply(topic, nextQuestion, text, semanticSlots.workContext));
    }

    if (directIntent === "usage_time") {
      session.signal = undefined;
      session.pipeline = "2.Đang tư vấn";
      const understood = {
        ...semanticSlots,
        ...extractConsultationSlots(text, session.consultation, session.openingVariantId),
      };
      if (Object.keys(understood).length > 0) {
        session.consultation = mergeConfirmedSlots(session.consultation, understood);
      }
      if (isMissedEveningApplicationQuestion(text)) {
        session.consultation = {
          ...session.consultation,
          stage: "S5.guidance",
        };
        recordKnowledge(session, ["usage-timing-missed-evening-application"]);
        return this.respond(session, missedEveningApplicationReply());
      }
      session.consultation = {
        ...session.consultation,
        stage: session.consultation.slots.workContext ? "S5.guidance" : "S1.context",
      };
      const contextQuestion = session.consultation.slots.workContext
        ? ""
        : "\n\nCông việc của mình chủ yếu ngoài trời/vận động nhiều hay ngồi văn phòng ạ?";
      return this.respond(
        session,
        `Dạ bên em đang hướng dẫn dùng Stopirex vào buổi tối trên da sạch, khô hoàn toàn và lăn một lớp mỏng; mình không nên tự chuyển sang dùng buổi sáng ạ. Việc làm cả ngày và ra nhiều mồ hôi có thể ảnh hưởng cảm nhận khô thoáng, nên em đã ghi nhận cả lo lắng về mùi của mình.${contextQuestion}`,
      );
    }

    if (directIntent === "usage_guidance" || directIntent === "usage_frequency") {
      session.lastIntent = directIntent;
      session.signal = undefined;
      if (!["3.Đã báo giá", "4.XL băn khoăn", "5.Chờ TT KH", "7.Chờ followup"].includes(session.pipeline)) {
        session.pipeline = "2.Đang tư vấn";
      }
      session.consultation = {
        ...session.consultation,
        stage: "S5.guidance",
      };
      if (isShelfLifeQuestion(text)) {
        recordKnowledge(session, ["shelf-life-and-after-opening"]);
        return this.respond(
          session,
          "Dạ hạn 3 năm là hạn của sản phẩm còn nguyên và bảo quản đúng ạ. Sau khi mở, mình xem ký hiệu trên chai; hiện bên em chưa có mốc tháng đã duyệt nên không báo 6 hay 12 tháng. Mình đậy kín, để nơi khô thoáng, không để lâu trong nhà tắm; em chuyển bộ phận liên quan kiểm tra đúng nhãn lô hàng giúp mình.",
        );
      }
      if (isMorningFragranceLayeringQuestion(text) && isCurrentCatalogSoapQuestion(text)) {
        recordKnowledge(session, ["usage-morning-fragrance-layering", "catalog-no-underarm-darkening-soap"]);
        return this.respond(
          session,
          "Dạ Stopirex không dùng hương thơm để che mùi nên sáng mình dùng nước hoa sẽ không bị lẫn hương ạ. Hiện gian hàng chưa bán xà phòng trị thâm nách nên em không tự gợi ý thêm sản phẩm ngoài danh mục.",
        );
      }
      if (isMorningFragranceLayeringQuestion(text) && asksWeeklyFrequency(text)) {
        recordKnowledge(session, ["usage-general", "usage-morning-fragrance-layering"]);
        return this.respond(
          session,
          "Dạ mình lăn Stopirex 2–3 lần/tuần vào buổi tối trên da sạch, khô ạ. Stopirex không dùng hương thơm để che mùi nên sáng mình dùng thêm lăn khử mùi Romano sẽ không bị lộn hương ạ.",
        );
      }
      recordKnowledge(session, [
        isMorningFragranceLayeringQuestion(text)
          ? "usage-morning-fragrance-layering"
          : bottleLongevityConcern
            ? "usage-bottle-duration"
            : "usage-general",
        ...(bottleLongevityConcern && /size|kich thuoc|lo be|lo nho|lo to/.test(text)
          ? ["catalog-single-standard-sku"]
          : []),
      ]);
      return this.respond(
        session,
        isMorningFragranceLayeringQuestion(text)
          ? morningFragranceLayeringReply()
          : bottleLongevityConcern && isUsageDurationOrFrequencyQuestion(text)
            ? "Dạ một lọ thường dùng khoảng 3–4 tháng ạ. Mình không cần bôi hằng ngày; lúc mới dùng chỉ lăn một lớp mỏng 2–3 lần/tuần vào buổi tối trên da sạch, khô hoàn toàn."
            : bottleLongevityConcern
              ? bottleLongevityReply(raw)
              : isUsageDurationOrFrequencyQuestion(text)
                ? usageDurationAndFrequencyReply(text)
                : generalUsageGuidanceReply(),
      );
    }

    if (directIntent === "decline_purchase" || isExplicitPriceDecline(text) || isPurchaseDecline(text)) {
      session.lastIntent = "decline_purchase";
      session.signal = "CT.Giá/Ship";
      session.pipeline = "N.Nuôi dưỡng";
      clearOrderDraft(session);
      return this.respond(
        session,
        "Dạ em hiểu ạ, mức giá hiện tại chưa phù hợp với mình. Em xin phép không làm phiền thêm; khi nào cần xem lại sản phẩm hoặc có chương trình phù hợp, mình nhắn em hỗ trợ ngay ạ.",
      );
    }

    if (isUnclearPriceReference(text, session)) {
      session.lastIntent = "other";
      session.signal = "CT.Giá/Ship";
      return this.respond(
        session,
        "Dạ em chưa nghe rõ phần giá mình vừa nói ạ. Mình đang hỏi về mức giá cũ hay khoản phí giao 30.000đ ạ?",
      );
    }

    if (directIntent === "price_objection" || isPriceConcern(text)) {
      session.lastIntent = "price_objection";
      session.signal = "CT.Giá/Ship";
      recordKnowledge(session, ["price-adjustment-france-import", "product-comparison-traditional-rollon"]);
      try {
        session.pipeline = transitionPipeline(session.pipeline, "objection_found");
      } catch {
        session.pipeline = "4.XL băn khoăn";
      }
      return this.respond(session, priceObjectionReply(session, text));
    }

    if (
      session.consultation.stage === "S5.guidance" &&
      isGuidancePriceChoice(text) &&
      !isBuyingIntent(text)
    ) {
      const continuation = showPrice(session);
      return this.respond(session, priceReply(continuationQuestion(continuation)));
    }

    const quantity = detectQuantity(text);
    if (
      quantity &&
      (session.pipeline === "3.Đã báo giá" || session.pipeline === "7.Chờ followup" || isBuyingIntent(text))
    ) {
      selectQuantity(session, quantity);
      this.move(session, "agreed_to_buy");
      session.signal = undefined;
      mergeOrderData(session, raw);
      const destination = extractDeliveryDestination(raw);
      if (destination) commitLegacyAddress(session, destination, "append", raw);
      const deliveryNote = extractDeliveryNote(raw);
      if (deliveryNote) {
        commitOrderMutations(session, [{ type: "set_delivery_note", deliveryNote, evidence: raw }]);
      }
      const collectionReply = orderCollectionReply(session);
      return this.respond(
        session,
        isPriceRequest(text) ? [selectedOrderPriceReply(quantity), collectionReply] : collectionReply,
      );
    }

    if (isPriceRequest(text)) {
      const continuation = showPrice(session);
      return this.respond(session, priceReplyForRequest(text, continuationQuestion(continuation)));
    }

    if (session.messages === 1 && !session.openingSent && isGenericOpening(text)) {
      session.openingSent = true;
      session.consultation = {
        ...session.consultation,
        stage: openingStage(session.openingVariantId),
      };
      return this.respond(session, openingMessage(session.openingVariantId, session.identity));
    }

    if (session.pipeline === "3.Đã báo giá") this.move(session, "needs_more_advice");
    if (session.pipeline === "7.Chờ followup") this.move(session, "followup_replied");
    const extracted = {
      ...semanticSlots,
      ...extractConsultationSlots(text, session.consultation, session.openingVariantId),
    };
    const understood = Object.keys(extracted).length > 0;
    if (understood) {
      session.consultation = mergeConfirmedSlots(session.consultation, extracted);
      session.signal = undefined;
      if (session.pipeline === "1.Phân loại") this.move(session, "classified");
    }

    const action = nextScenarioAction(session.openingVariantId, session.consultation);
    const repeatedQuestion = Boolean(
      action.question &&
      session.consultation.stage === action.stage &&
      session.consultation.asked.includes(action.question),
    );
    const nextAction = repeatedQuestion ? continuationAfterRepeatedQuestion(session.consultation) : action;
    const question = nextAction.question;
    session.consultation = {
      ...session.consultation,
      stage: nextAction.stage,
      asked:
        question && session.consultation.asked.at(-1) !== question
          ? [...session.consultation.asked, question]
          : session.consultation.asked,
    };
    if (question && offersPriceChoice(question)) {
      session.pendingAction = "send_price";
      session.lastDecision.pendingActionAfter = "send_price";
    }
    const reply = nextAction.reply;
    return this.respond(session, [reply, question].filter(Boolean).join("\n\n"));
  }

  reset(sessionId?: string, context: DemoChatContext = {}): DemoChatResponse {
    const id = sessionId?.trim() || randomUUID();
    const session = newSession(id, context);
    session.greeted = true;
    const dynamic = session.openingVariantId === "AUTO.dynamic";
    session.openingSent = !dynamic;
    session.consultation = {
      ...session.consultation,
      stage: openingStage(session.openingVariantId),
    };
    this.sessions.set(id, session);
    return this.respond(
      session,
      dynamic
        ? [
            greetingMessage(session.identity),
            "Em có thể hỗ trợ mình theo ba hướng:\n1. Tư vấn tình trạng mồ hôi hoặc mùi\n2. Hướng dẫn cách dùng Stopirex\n3. Gửi bảng giá hiện tại\n\nAnh/chị muốn bắt đầu từ phần nào ạ? Chỉ cần nhắn 1, 2 hoặc 3 giúp em.",
          ]
        : [greetingMessage(session.identity), openingMessage(session.openingVariantId, session.identity)],
    );
  }

  approveFreeShipping(sessionId?: string, context: DemoChatContext = {}): DemoChatResponse {
    const session = this.getOrCreate(sessionId, context);
    applyChatContext(session, context);
    session.freeShippingApproved = true;
    session.lastIntent = "negotiation";
    session.signal = "CT.Giá/Ship";

    if (session.selectedQuantity && session.selectedQuantity >= 2) {
      return this.respond(
        session,
        `Dạ combo ${session.selectedQuantity} lọ của mình đã được miễn phí giao theo chương trình hiện tại rồi ạ.`,
      );
    }

    if (session.selectedQuantity === 1) {
      selectQuantity(session, 1);
      return this.respond(
        session,
        "Dạ em đã hỗ trợ miễn phí giao cho đơn 1 lọ của mình ạ. Tổng thanh toán sau hỗ trợ là 285.000đ.",
      );
    }

    session.pipeline = "4.XL băn khoăn";
    session.consultation = {
      ...session.consultation,
      stage: "S7.waiting",
    };
    return this.respond(
      session,
      "Dạ em đã được duyệt hỗ trợ miễn phí giao cho phương án 1 lọ lần này ạ. Nếu mình chọn 1 lọ, tổng thanh toán sẽ còn 285.000đ.",
    );
  }

  startFollowup(
    sessionId: string | undefined,
    stage: FollowupStage,
    context: DemoChatContext = {},
  ): DemoChatResponse {
    const session = this.getOrCreate(sessionId, context);
    applyChatContext(session, context);
    approveSingleShipping(session);
    this.move(session, "followup_due");
    session.activeSkill = "follow-up";
    session.skillReason = "Follow-up đã bắt đầu nên quyền miễn phí giao cho 1 lọ được kích hoạt.";
    return this.respond(session, followupMessage(stage, {
      ...(session.lastIntent ? { lastIntent: session.lastIntent } : {}),
      rejectedArguments: session.conversationMemory.rejectedArguments,
      openQuestions: session.conversationMemory.openQuestions,
      askedTopics: session.askedTopics,
    }));
  }

  replaceLatestAssistantTurn(sessionId: string | undefined, styledReply: string): DemoChatState {
    const session = this.getOrCreate(sessionId);
    this.claims.assertSafe(styledReply);
    assertCustomerFacingCopy(styledReply);
    for (let index = session.history.length - 1; index >= 0; index -= 1) {
      const turn = session.history[index];
      if (turn?.role !== "assistant") continue;
      session.history[index] = { role: "assistant", text: styledReply };
      break;
    }
    return stateOf(session);
  }

  replaceLatestAssistantTurns(
    sessionId: string | undefined,
    previousReplies: readonly string[],
    renderedReplies: readonly string[],
  ): DemoChatState {
    const session = this.getOrCreate(sessionId);
    if (previousReplies.length === 0 || renderedReplies.length === 0) {
      return stateOf(session);
    }
    for (const reply of renderedReplies) {
      this.claims.assertSafe(reply);
      assertCustomerFacingCopy(reply);
    }
    const start = session.history.length - previousReplies.length;
    const currentTail = session.history.slice(start);
    const matches =
      start >= 0 &&
      currentTail.length === previousReplies.length &&
      // The workflow and the presentation governor can legitimately reshape
      // bubble text between the first render and the final LLM render. The
      // invariant we need here is ownership of the trailing assistant batch,
      // not byte-for-byte equality of presentation text.
      currentTail.every((turn) => turn.role === "assistant");
    if (!matches) {
      throw new Error("Latest assistant turns no longer match response being rendered");
    }
    session.history.splice(
      start,
      previousReplies.length,
      ...renderedReplies.map((text) => ({ role: "assistant" as const, text })),
    );
    const askedTopics = session.history
      .filter((turn) => turn.role === "assistant")
      .map((turn) => questionTopic(turn.text))
      .filter((topic): topic is ConversationTopic => Boolean(topic));
    session.askedTopics = [...new Set(askedTopics)];
    const pendingQuestionTopic = askedTopics.at(-1);
    if (pendingQuestionTopic) session.pendingQuestionTopic = pendingQuestionTopic;
    else delete session.pendingQuestionTopic;
    return stateOf(session);
  }

  recordCanonicalAnswerFacts(
    sessionId: string | undefined,
    factIds: readonly string[],
  ): DemoChatState {
    const session = this.getOrCreate(sessionId);
    if (factIds.length === 0) return stateOf(session);
    session.dialogueState = {
      ...session.dialogueState,
      version: session.dialogueState.version + 1,
      recentlyAnsweredFactIds: [
        ...new Set([...session.dialogueState.recentlyAnsweredFactIds, ...factIds]),
      ].slice(-24),
    };
    return stateOf(session);
  }

  replaceLatestAssistantTurnsAndPauseForCoverage(
    sessionId: string | undefined,
    previousReplies: readonly string[],
    renderedReplies: readonly string[],
    reason: string,
  ): DemoChatState {
    this.replaceLatestAssistantTurns(sessionId, previousReplies, renderedReplies);
    const session = this.getOrCreate(sessionId);
    session.orderCollectionPaused = true;
    delete session.pendingAction;
    if (session.lastDecision) delete session.lastDecision.pendingActionAfter;
    pauseForHumanReview(session, reason);
    session.activeSkill = "knowledge-handoff";
    session.skillReason =
      "Question Coverage Gate phát hiện còn câu hỏi chưa được phản hồi; giữ dữ liệu mua nhưng dừng thu đơn.";
    return stateOf(session);
  }

  resumeCareAfterHuman(
    sessionId: string | undefined,
    result: { resolved: boolean; summary: string; allowBotResume: boolean },
  ): DemoChatState {
    const session = this.getOrCreate(sessionId);
    if (!session.care) return stateOf(session);
    const updatedCase = resumeAfterHuman(session.care.case, result);
    this.careCases.save(updatedCase);
    if (!result.allowBotResume) {
      session.care = { ...session.care, case: updatedCase };
      return stateOf(session);
    }
    if (!result.resolved) {
      session.care = {
        ...session.care,
        case: updatedCase,
        stage: "C4.followup",
        breakpoint: "CSKH đã xử lý bước đầu - chatbot theo dõi",
      };
      session.pipeline = "C4.Theo dõi";
      return stateOf(session);
    }
    delete session.care;
    session.mode = "sales";
    session.pipeline = session.previousSalesPipeline ?? "2.Đang tư vấn";
    session.consultation = {
      ...session.consultation,
      stage: session.previousSalesStage ?? "S5.guidance",
    };
    delete session.previousSalesPipeline;
    delete session.previousSalesStage;
    return stateOf(session);
  }

  replaceOpeningTurns(sessionId: string | undefined, styledReplies: readonly string[]): DemoChatState {
    const session = this.getOrCreate(sessionId);
    if (styledReplies.length < 2) {
      throw new Error("Opening rewrite must contain greeting and opening content");
    }
    for (const reply of styledReplies) {
      this.claims.assertSafe(reply);
      assertCustomerFacingCopy(reply);
    }
    const openingStart = session.history.length - 2;
    if (
      openingStart < 0 ||
      session.history[openingStart]?.role !== "assistant" ||
      session.history[openingStart + 1]?.role !== "assistant"
    ) {
      throw new Error("Opening assistant turns not found");
    }
    session.history.splice(
      openingStart,
      2,
      ...styledReplies.map((text) => ({ role: "assistant" as const, text })),
    );
    return stateOf(session);
  }

  peek(sessionId?: string): DemoChatState {
    return stateOf(this.getOrCreate(sessionId));
  }

  approvedKnowledgeFallback(
    text: string,
    semanticSlots: ConsultationSlots = {},
  ): { reply: string; knowledgeIds: string[]; intent: CustomerIntent } | undefined {
    return llmFailureKnowledgeAnswer(text, semanticSlots);
  }

  exportSession(sessionId: string): unknown {
    const session = this.sessions.get(sessionId);
    return session ? JSON.parse(JSON.stringify(session)) : undefined;
  }

  discardSession(sessionId: string): boolean {
    return this.sessions.delete(sessionId);
  }

  restoreSession(sessionId: string, snapshot: unknown, context: DemoChatContext = {}): boolean {
    if (this.sessions.has(sessionId)) return true;
    if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
      return false;
    }
    const candidate = snapshot as Partial<DemoSession>;
    if (
      !candidate.consultation ||
      typeof candidate.consultation !== "object" ||
      !Array.isArray(candidate.history) ||
      typeof candidate.pipeline !== "string"
    ) {
      return false;
    }
    const base = newSession(sessionId, context);
    const restored: DemoSession = {
      ...base,
      ...candidate,
      id: sessionId,
      consultation: {
        ...base.consultation,
        ...candidate.consultation,
        slots: { ...candidate.consultation.slots },
        asked: [...candidate.consultation.asked],
      },
      order: { ...(candidate.order ?? {}) },
      history: candidate.history
        .filter((turn): turn is { role: "user" | "assistant"; text: string } =>
          Boolean(
            turn && (turn.role === "user" || turn.role === "assistant") && typeof turn.text === "string",
          ),
        )
        .slice(-40),
      identity: { ...base.identity, ...(candidate.identity ?? {}) },
      customerProfile: { ...base.customerProfile, ...(candidate.customerProfile ?? {}) },
      locationMemory: {
        ...base.locationMemory,
        ...(candidate.locationMemory ?? {}),
        history: [...(candidate.locationMemory?.history ?? [])].slice(-8),
      },
      conversationMemory: {
        ...base.conversationMemory,
        ...(candidate.conversationMemory ?? {}),
        beneficiaries: sanitizeBeneficiaries(candidate.conversationMemory?.beneficiaries),
        ...(isKnownBeneficiaryId(
          candidate.conversationMemory?.activeBeneficiaryId,
          candidate.conversationMemory?.beneficiaries,
        )
          ? { activeBeneficiaryId: candidate.conversationMemory?.activeBeneficiaryId }
          : {}),
        usedArguments: [...(candidate.conversationMemory?.usedArguments ?? [])].slice(-8),
        rejectedArguments: [...(candidate.conversationMemory?.rejectedArguments ?? [])].slice(-8),
        answeredQuestions: [...(candidate.conversationMemory?.answeredQuestions ?? [])].slice(-12),
        openQuestions: [...(candidate.conversationMemory?.openQuestions ?? [])].slice(-8),
        phoneHistory: sanitizePhoneHistory(candidate.conversationMemory?.phoneHistory),
        consultationFacts: {
          ...base.conversationMemory.consultationFacts,
          ...(candidate.conversationMemory?.consultationFacts ?? {}),
          triggers: [...(candidate.conversationMemory?.consultationFacts?.triggers ?? [])].slice(-4),
        },
        salesContext: {
          objections: [...(candidate.conversationMemory?.salesContext?.objections ?? [])].slice(-8),
        },
      },
      dialogueState: {
        ...base.dialogueState,
        ...(candidate.dialogueState ?? {}),
        lastUserActs: [...(candidate.dialogueState?.lastUserActs ?? [])].slice(-12),
        lastAssistantActs: [...(candidate.dialogueState?.lastAssistantActs ?? [])].slice(-12),
        unresolvedTopics: [...(candidate.dialogueState?.unresolvedTopics ?? [])].slice(-12),
        recentlyAnsweredFactIds: [
          ...(candidate.dialogueState?.recentlyAnsweredFactIds ?? []),
        ].slice(-20),
        expectedInputs: [...(candidate.dialogueState?.expectedInputs ?? [])].slice(-8),
      },
      workflowState: {
        ...base.workflowState,
        ...(candidate.workflowState ?? {}),
        recentEvents: [...(candidate.workflowState?.recentEvents ?? [])].slice(-12),
      },
      answeredTopics: [...(candidate.answeredTopics ?? [])],
      askedTopics: [...(candidate.askedTopics ?? [])],
    };
    if (
      restored.conversationMemory.activeBeneficiaryId &&
      !restored.conversationMemory.beneficiaries.some(
        (item) => item.id === restored.conversationMemory.activeBeneficiaryId,
      )
    ) {
      delete restored.conversationMemory.activeBeneficiaryId;
    }
    if (typeof restored.order.customerConfirmedAt === "string") {
      restored.order.customerConfirmedAt = new Date(restored.order.customerConfirmedAt);
    }
    restored.workflowState = {
      ...restored.workflowState,
      orderLifecycle:
        restored.workflowState.orderLifecycle === "cancelled" &&
        !restored.selectedQuantity &&
        Object.keys(restored.order).length === 0
          ? "cancelled"
          : deriveOrderLifecycle({
              ...(restored.selectedQuantity ? { selectedQuantity: restored.selectedQuantity } : {}),
              draft: restored.order,
              ...(restored.trackingNumber ? { trackingNumber: restored.trackingNumber } : {}),
            }),
    };
    if (restored.care) restored.care = reviveCareDates(restored.care);
    this.sessions.set(sessionId, restored);
    return true;
  }

  private getOrCreate(sessionId?: string, context: DemoChatContext = {}): DemoSession {
    const id = sessionId?.trim() || randomUUID();
    const existing = this.sessions.get(id);
    if (existing) return existing;
    const created = newSession(id, context);
    this.sessions.set(id, created);
    return created;
  }

  private move(session: DemoSession, event: PipelineEvent): void {
    if (event === "followup_due") approveSingleShipping(session);
    try {
      session.pipeline = transitionPipeline(session.pipeline, event);
    } catch {
      if (event === "first_reply") session.pipeline = "1.Phân loại";
      else if (event === "classified" || event === "needs_more_advice") session.pipeline = "2.Đang tư vấn";
      else if (event === "price_sent") session.pipeline = "3.Đã báo giá";
      else if (event === "objection_found" || event === "followup_replied")
        session.pipeline = "4.XL băn khoăn";
      else if (event === "agreed_to_buy") session.pipeline = "5.Chờ TT KH";
      else if (event === "order_created") session.pipeline = "6.Đã tạo đơn";
      else if (event === "followup_due") session.pipeline = "7.Chờ followup";
    }
  }

  private respond(session: DemoSession, reply: string | readonly string[]): DemoChatResponse {
    const rawReplies = typeof reply === "string" ? [reply] : [...reply];
    const customerMessage = [...session.history].reverse().find((turn) => turn.role === "user")?.text ?? "";
    const nextBestAction = planNextBestAction({
      customerMessage,
      replies: rawReplies,
      ...(session.lastIntent ? { intent: session.lastIntent } : {}),
      ...(session.lastDecision?.semantic.topic ? { topic: session.lastDecision.semantic.topic } : {}),
      knowledgeEntityIds: session.lastDecision?.knowledgeEntityIds ?? [],
      pipeline: session.pipeline,
      slots: session.consultation.slots,
      answeredTopics: session.answeredTopics,
      askedTopics: session.askedTopics,
      ...(session.selectedQuantity ? { selectedQuantity: session.selectedQuantity } : {}),
      botPaused: session.care?.case.botPaused ?? false,
      hasCareCase: Boolean(session.care),
      handoffPending: Boolean(session.manualHandoffReason),
      optedOut: session.optedOut,
    });
    const semanticDecision = session.lastDecision?.semantic;
    const llmOwnsCta =
      semanticDecision?.status === "interpreted" &&
      semanticDecision.selectedCtaId !== undefined;
    const semanticCta =
      llmOwnsCta && semanticDecision.selectedCtaId !== "none"
        ? semanticDecision.ctaText?.trim()
        : undefined;
    const promptToAppend = llmOwnsCta ? semanticCta : nextBestAction.prompt;
    const activeResponseBudget =
      session.lastIntent === "price_request"
        ? 650
        : 280;
    const nextBestActionFits =
      !promptToAppend ||
      rawReplies.join("\n\n").length + promptToAppend.length + 2 <= activeResponseBudget;
    session.lastNextBestAction = nextBestActionFits
      ? nextBestAction
      : {
          type: "close_without_question",
          state: "stopped_due_to_length",
          key: "response_budget_exhausted",
          reason: "Câu trả lời chính đã đủ dài; không nối thêm câu khai thác.",
        };
    if (
      promptToAppend &&
      nextBestActionFits &&
      !rawReplies.some((message) => message.includes(promptToAppend))
    ) {
      rawReplies.push(promptToAppend);
    }
    let logicalReplies = rawReplies.map((message) => personalizeCustomerAddress(message, session.identity));
    if (!session.greeted && session.messages > 0) {
      if (!(session.mode === "care" && session.care?.case.issue === "complaint")) {
        logicalReplies.unshift(greetingMessage(session.identity));
      }
      session.greeted = true;
    }
    const activeSkill = session.activeSkill ? conversationSkills[session.activeSkill] : undefined;
    const previouslyAskedTopics =
      session.lastIntent === "price_request" && session.pendingQuestionTopic
        ? session.askedTopics.filter((topic) => topic !== session.pendingQuestionTopic)
        : session.askedTopics;
    const governed = governCustomerResponse({
      replies: logicalReplies,
      answeredTopics: session.mode === "care" ? [] : session.answeredTopics,
      previouslyAskedTopics: session.mode === "care" ? [] : previouslyAskedTopics,
      maxCharacters:
        session.messages <= 1
          ? Math.max(500, activeSkill?.maxCharacters ?? 0)
          : Math.max(360, activeSkill?.maxCharacters ?? 0),
      maxBubbles: 2,
      preserveFullText: shouldPreserveFullResponse(session, logicalReplies),
    });
    logicalReplies = governed.replies;
    session.askedTopics = [...new Set([...session.askedTopics, ...governed.askedTopics])];
    if (governed.pendingQuestionTopic) {
      session.pendingQuestionTopic = governed.pendingQuestionTopic;
    } else {
      delete session.pendingQuestionTopic;
    }
    session.responseGovernorTruncated = governed.truncated;
    assertReplyMatchesConversationState({
      reply: logicalReplies.join("\n\n"),
      ...(session.lastDecision ? { trace: session.lastDecision } : {}),
      ...(session.selectedQuantity ? { selectedQuantity: session.selectedQuantity } : {}),
      ...(session.orderId ? { orderId: session.orderId } : {}),
      orderReceived: Boolean(session.pipeline === "6.Đã tạo đơn" && session.order.customerConfirmedAt),
      botPaused: session.care?.case.botPaused ?? false,
      freeShippingApproved: session.freeShippingApproved,
      orderDraft: session.order,
      ...(session.orderTransactionTrace?.acceptedMutations
        ? { acceptedOrderMutations: session.orderTransactionTrace.acceptedMutations }
        : {}),
    });
    for (const message of logicalReplies) {
      this.claims.assertSafe(message);
      assertCustomerFacingCopy(message);
      rememberTurn(session, { role: "assistant", text: message });
    }
    const selectedCtaId = (session.lastDecision?.semantic.selectedCtaId ?? "none") as ConversationCtaId;
    session.dialogueState = reduceDialogueState(session.dialogueState, {
      type: "assistant_turn_committed",
      ctaId: selectedCtaId,
      requestedSlots: selectedCtaRequestedSlots(selectedCtaId, session),
      answeredFactIds: session.lastDecision?.knowledgeEntityIds ?? [],
      unresolvedTopics: session.lastDecision?.semantic.unsupportedQuestions ?? [],
      turn: session.messages,
      goal: dialogueGoalForSession(session),
    });
    session.workflowState = reduceWorkflowStateMeta(
      session.workflowState,
      {
        type: "turn_completed",
        evidence: workflowEvidenceRef(customerMessage || "system_response"),
      },
      {
        ...(session.selectedQuantity ? { selectedQuantity: session.selectedQuantity } : {}),
        draft: session.order,
        ...(session.trackingNumber ? { trackingNumber: session.trackingNumber } : {}),
      },
    );
    finalizeDecisionTrace(session);
    const replies = logicalReplies.slice(0, 2);
    return {
      sessionId: session.id,
      reply: replies.join("\n\n"),
      replies,
      state: stateOf(session),
      sandbox: true,
      productionData: false,
    };
  }
}

function stateOf(session: DemoSession): DemoChatState {
  return {
    mode: session.mode,
    customerType: session.customerType,
    consultationStage: session.consultation.stage,
    journeyStage: session.care?.stage ?? session.consultation.stage,
    breakpoint:
      session.care?.breakpoint ??
      (session.pipeline === "C3.Chờ CSKH" && session.manualHandoffReason
        ? session.manualHandoffReason
        : salesBreakpoint(session)),
    ...(session.care ? { careIssue: session.care.case.issue, careFacts: session.care.case.facts } : {}),
    ...(session.care
      ? {
          careCaseId: session.care.case.id,
          careOwner: session.care.case.owner,
          careDueAt: session.care.case.dueAt.toISOString(),
          careStatus: session.care.case.status,
          carePriority: session.care.case.priority,
        }
      : {}),
    ...(session.previousSalesPipeline ? { previousSalesPipeline: session.previousSalesPipeline } : {}),
    botPaused: session.care?.case.botPaused ?? false,
    // Keep enough raw turns to reconstruct six complete exchanges. The prompt
    // layer groups these turns, so multi-bubble assistant replies do not evict
    // the customer context that introduced the active subject.
    recentTurns: session.history.slice(-36),
    ...(session.lastIntent ? { lastIntent: session.lastIntent } : {}),
    ...(session.activeSkill ? { activeSkill: session.activeSkill } : {}),
    ...(session.skillReason ? { skillReason: session.skillReason } : {}),
    slots: session.consultation.slots,
    pipeline: session.pipeline,
    ...(session.signal ? { signal: session.signal } : {}),
    ...(session.selectedQuantity ? { selectedQuantity: session.selectedQuantity } : {}),
    orderDraft: structuredClone(session.order),
    orderFlowStatus: resolveOrderFlowStatus(session),
    orderReceived: Boolean(session.pipeline === "6.Đã tạo đơn" && session.order.customerConfirmedAt),
    freeShippingApproved: session.freeShippingApproved,
    orderMissing: missingOrderFields(session.order),
    optedOut: session.optedOut,
    ...(session.orderId ? { orderId: session.orderId } : {}),
    ...(session.trackingNumber ? { trackingNumber: session.trackingNumber } : {}),
    openingVariantId: session.openingVariantId,
    openingSelectionMode: session.openingSelectionMode,
    ...(session.openingStrategyReason ? { openingStrategyReason: session.openingStrategyReason } : {}),
    ...(session.pendingAction ? { pendingAction: session.pendingAction } : {}),
    ...(session.manualHandoffReason ? { handoffReason: session.manualHandoffReason } : {}),
    ...(session.lastDecision ? { decisionTrace: session.lastDecision } : {}),
    ...(session.orderTransactionTrace
      ? { orderTransactionTrace: structuredClone(session.orderTransactionTrace) }
      : {}),
    ...(session.lastNextBestAction ? { nextBestAction: structuredClone(session.lastNextBestAction) } : {}),
    answeredTopics: [...session.answeredTopics],
    askedTopics: [...session.askedTopics],
    ...(session.pendingQuestionTopic ? { pendingQuestionTopic: session.pendingQuestionTopic } : {}),
    responseGovernorTruncated: session.responseGovernorTruncated,
    customerProfile: { ...session.customerProfile },
    locationMemory: {
      ...session.locationMemory,
      history: [...(session.locationMemory.history ?? [])],
    },
    conversationMemory: {
      ...session.conversationMemory,
      beneficiaries: session.conversationMemory.beneficiaries.map((item) => ({ ...item })),
      usedArguments: [...session.conversationMemory.usedArguments],
      rejectedArguments: [...session.conversationMemory.rejectedArguments],
      answeredQuestions: [...session.conversationMemory.answeredQuestions],
      openQuestions: [...session.conversationMemory.openQuestions],
      phoneHistory: session.conversationMemory.phoneHistory.map((item) => ({ ...item })),
      consultationFacts: {
        ...session.conversationMemory.consultationFacts,
        triggers: [...session.conversationMemory.consultationFacts.triggers],
      },
      salesContext: {
        objections: (session.conversationMemory.salesContext?.objections ?? []).map((item) => ({ ...item })),
      },
    },
    dialogueState: structuredClone(session.dialogueState),
    stateVersion: session.workflowState.version,
    orderRevision: session.workflowState.orderRevision,
    orderLifecycle:
      session.workflowState.orderLifecycle === "cancelled" &&
      !session.selectedQuantity &&
      Object.keys(session.order).length === 0
        ? "cancelled"
        : deriveOrderLifecycle({
            ...(session.selectedQuantity ? { selectedQuantity: session.selectedQuantity } : {}),
            draft: session.order,
            ...(session.trackingNumber ? { trackingNumber: session.trackingNumber } : {}),
          }),
    recentStateEvents: session.workflowState.recentEvents.map((event) => ({ ...event })),
  };
}

function shouldPreserveFullResponse(session: DemoSession, replies: readonly string[]): boolean {
  if (session.mode === "care") return true;
  if (session.selectedQuantity || session.orderId) return true;
  const text = replies.join("\n");
  if (extractRequiredResponseFacts(text).length > 0) return true;
  const answerTopicCount = new Set(session.lastDecision?.actionPlan?.answerTopics ?? []).size;
  if (answerTopicCount >= 3) return true;
  if (/không bết/iu.test(text) && /hoàn tiền/iu.test(text)) return true;
  return /Dạ giá hiện tại:|Tên người nhận:|Địa chỉ trước sáp nhập:|Mã vận đơn|ĐỒNG Ý|chuyển nhân viên kiểm tra/u.test(
    text,
  );
}

function finalizeDecisionTrace(session: DemoSession): void {
  if (!session.lastDecision) return;
  session.lastDecision.final = {
    ...(session.lastIntent ? { intent: session.lastIntent } : {}),
    pipeline: session.pipeline,
    stage: session.care?.stage ?? session.consultation.stage,
    ...(session.signal ? { signal: session.signal } : {}),
  };
}

function overrideDecisionClassification(
  session: DemoSession,
  intent: CustomerIntent,
  topic?: SemanticUnderstanding["topic"],
  secondaryIntents: Array<"out_of_domain"> = [],
  reason?: string,
): void {
  session.lastIntent = intent;
  if (!session.lastDecision) return;
  session.lastDecision.selectedIntent = intent;
  session.lastDecision.semantic.intent = intent;
  if (topic) session.lastDecision.semantic.topic = topic;
  session.lastDecision.ruleMatches = [
    ...session.lastDecision.ruleMatches.filter((match) => !match.intent && !match.id.startsWith("intent_")),
    {
      id: `intent_${intent}_route_override`,
      kind: "hard",
      confidence: 1,
      intent,
    },
  ];
  if (session.lastDecision.actionPlan) {
    session.lastDecision.actionPlan.primaryIntent = intent;
  }
  if (secondaryIntents.length > 0) {
    session.lastDecision.secondaryIntents = [...secondaryIntents];
  } else {
    delete session.lastDecision.secondaryIntents;
  }
  if (reason) session.lastDecision.reason = reason;
}

function recordKnowledge(session: DemoSession, entityIds: readonly string[]): void {
  if (!session.lastDecision) return;
  session.lastDecision.knowledgeEntityIds = [...new Set(entityIds)];
}

function newSession(id: string, context: DemoChatContext = {}): DemoSession {
  return {
    id,
    mode: "sales",
    customerType: "new",
    consultation: initialConsultation(),
    pipeline: "0.Chưa tư vấn",
    signal: undefined,
    order: {},
    orderCollectionPaused: false,
    freeShippingApproved: false,
    optedOut: false,
    orderConfirmationMode: context.orderConfirmationMode ?? "sandbox",
    ...(context.orderEditable !== undefined ? { orderEditable: context.orderEditable } : {}),
    messages: 0,
    history: [],
    identity: { ...(context.identity ?? {}) },
    openingVariantId: context.openingVariantId ?? "AUTO.dynamic",
    openingSelectionMode:
      context.openingVariantId && context.openingVariantId !== "AUTO.dynamic" ? "manual" : "auto",
    greeted: false,
    openingSent: false,
    answeredTopics: [],
    askedTopics: [],
    responseGovernorTruncated: false,
    customerProfile: {},
    locationMemory: {},
    conversationMemory: {
      beneficiaries: [],
      usedArguments: [],
      rejectedArguments: [],
      answeredQuestions: [],
      openQuestions: [],
      phoneHistory: [],
      consultationFacts: { triggers: [] },
      salesContext: { objections: [] },
    },
    dialogueState: initialDialogueState(),
    workflowState: initialWorkflowStateMeta(),
  };
}

function selectedCtaRequestedSlots(ctaId: ConversationCtaId, session: DemoSession): string[] {
  if (ctaId === "ask_recipient_name") return ["recipientName"];
  if (ctaId === "ask_phone") return ["phone"];
  if (ctaId === "ask_address") return ["legacyAddress"];
  if (session.selectedQuantity) {
    return missingOrderFields(session.order).filter((field) =>
      ["recipientName", "phone", "legacyAddress"].includes(field),
    );
  }
  return [];
}

function dialogueGoalForSession(session: DemoSession): string {
  if (session.care?.case.botPaused) return "resolve_customer_care_safely";
  if (session.selectedQuantity && missingOrderFields(session.order).length > 0) {
    return "collect_missing_order_fields";
  }
  if (session.selectedQuantity) return "review_or_update_order";
  return session.pendingAction ?? "answer_current_customer_need";
}

function reviveCareDates(care: CareFlowState): CareFlowState {
  const revive = (value: Date | string): Date => (value instanceof Date ? value : new Date(value));
  return {
    ...care,
    case: {
      ...care.case,
      dueAt: revive(care.case.dueAt as Date | string),
      createdAt: revive(care.case.createdAt as Date | string),
      updatedAt: revive(care.case.updatedAt as Date | string),
      acknowledgedAt: revive(care.case.acknowledgedAt as Date | string),
      ...(care.case.closedAt ? { closedAt: revive(care.case.closedAt as Date | string) } : {}),
      updates: care.case.updates.map((update) => ({
        ...update,
        at: revive(update.at as Date | string),
      })),
    },
  };
}

function applyChatContext(session: DemoSession, context: DemoChatContext): void {
  if (context.identity) {
    session.identity = { ...session.identity, ...context.identity };
  }
  if (context.openingVariantId && !session.openingSent) {
    session.openingVariantId = context.openingVariantId;
    session.openingSelectionMode = context.openingVariantId === "AUTO.dynamic" ? "auto" : "manual";
    delete session.openingStrategyReason;
  }
  if (context.orderConfirmationMode) session.orderConfirmationMode = context.orderConfirmationMode;
  if (context.orderEditable !== undefined) session.orderEditable = context.orderEditable;
}

function openingStage(variantId: OpeningVariantId): ConsultationState["stage"] {
  if (variantId === "B.context") return "S1.context";
  if (variantId === "D.pain" || variantId === "E.number") return "S2.symptom";
  return "S0.new";
}

function selectDynamicOpeningStrategy(input: {
  sessionId: string;
  text: string;
  semantic: SemanticUnderstanding;
  exactIntent?: CustomerIntent;
  careIssue?: IssueType;
}): { variantId: Exclude<OpeningVariantId, "AUTO.dynamic">; reason: string } {
  const { text, semantic, exactIntent, careIssue } = input;

  if (careIssue === "complaint") {
    return {
      variantId: "A.choice",
      reason: "Khách đang khiếu nại; ưu tiên tiếp nhận khẩn và chuyển CSKH, không chạy chiến lược bán hàng.",
    };
  }

  if (isPriorOtherProductAdverseExperience(text)) {
    return {
      variantId: "C.prior",
      reason:
        "Khách mô tả phản ứng với sản phẩm khác trước đây; xử lý như băn khoăn trước mua, không mở khiếu nại Stopirex.",
    };
  }

  if (
    careIssue ||
    exactIntent === "safety" ||
    semantic.intent === "safety" ||
    semantic.topic === "irritation" ||
    /loai cu.*(?:kho chiu|rat|ngua)|tung.*(?:rat|ngua|kich ung)/.test(text)
  ) {
    return {
      variantId: "E.number",
      reason: "Tin khách có dấu hiệu an toàn hoặc sản phẩm cũ gây khó chịu; ưu tiên kiểm tra da trước.",
    };
  }

  if (
    exactIntent === "product_comparison" ||
    semantic.intent === "product_comparison" ||
    semantic.slots.priorProduct ||
    /lan (?:thuong|truyen thong|hang ngay)|da dung|tung dung|gian cach/.test(text)
  ) {
    return {
      variantId: "C.prior",
      reason: "Khách nhắc sản phẩm cũ hoặc hỏi điểm khác; chọn chiến lược giáo dục từ thói quen sử dụng.",
    };
  }

  if (
    exactIntent === "price_request" ||
    exactIntent === "price_change" ||
    exactIntent === "price_objection" ||
    exactIntent === "negotiation" ||
    exactIntent === "promotion_inquiry" ||
    semantic.topic === "price" ||
    semantic.topic === "promotion" ||
    semantic.topic === "shipping"
  ) {
    return {
      variantId: "A.choice",
      reason: "Khách quan tâm giá hoặc giao hàng; trả lời thương mại trực tiếp, không ép khai thác trước.",
    };
  }

  if (
    semantic.slots.workContext ||
    /ngoai troi|van dong|the thao|pickle|padel|gym|phong lanh|dieu hoa|van phong|cang thang/.test(text)
  ) {
    return {
      variantId: "B.context",
      reason: "Khách đã nêu môi trường phát sinh; tiếp tục từ bối cảnh thay vì hỏi lại từ đầu.",
    };
  }

  if (semantic.slots.primarySymptom || /uot ao|o ao|ra nhieu mo hoi|mui co the|hoi nach/.test(text)) {
    if (/muon|uu tien|can (?:giam|kiem soat)/.test(text)) {
      return {
        variantId: "E.number",
        reason: "Khách nêu rõ mục tiêu mong muốn; dùng chiến lược phản hồi nhanh theo mục tiêu.",
      };
    }
    return {
      variantId: "D.pain",
      reason: "Khách mô tả vấn đề đang gặp; bắt đầu từ nỗi đau và chỉ hỏi dữ kiện còn thiếu.",
    };
  }

  const candidates: Array<Exclude<OpeningVariantId, "AUTO.dynamic">> = [
    "A.choice",
    "B.context",
    "C.prior",
    "D.pain",
    "E.number",
  ];
  const digest = createHash("sha256").update(`${input.sessionId}:${text}`).digest();
  const variantId = candidates[digest.readUInt32BE(0) % candidates.length]!;
  return {
    variantId,
    reason:
      "Tin nhắn còn chung; phân bổ ổn định một chiến lược thử nghiệm cho toàn bộ phiên, không đổi ngẫu nhiên giữa các lượt.",
  };
}

function dynamicOpeningStrategyForMenuChoice(choice: "1" | "2" | "3"): {
  variantId: Exclude<OpeningVariantId, "AUTO.dynamic">;
  reason: string;
} {
  if (choice === "1") {
    return {
      variantId: "D.pain",
      reason: "Khách chọn tư vấn tình trạng trong menu mở đầu; giữ đúng ý nghĩa lựa chọn số 1.",
    };
  }
  if (choice === "2") {
    return {
      variantId: "C.prior",
      reason: "Khách chọn hướng dẫn cách dùng trong menu mở đầu; giữ đúng ý nghĩa lựa chọn số 2.",
    };
  }
  return {
    variantId: "A.choice",
    reason: "Khách chọn xem bảng giá trong menu mở đầu; giữ đúng ý nghĩa lựa chọn số 3.",
  };
}

function introductoryUsageReply(): string {
  return [
    "Dạ, em hướng dẫn mình cách dùng Stopirex trước nhé.",
    "Mình dùng vào buổi tối khi vùng da sạch và khô hoàn toàn, lăn một lớp mỏng; thông thường chỉ cần dùng 2–3 lần/tuần. Mình tránh dùng khi da đang trầy xước hoặc ngay sau cạo/wax.",
    "Trước đây mình thường dùng lăn nách hằng ngày hay đây là lần đầu sử dụng ạ?",
  ].join("\n\n");
}

function symptomChoiceReply(): string {
  return [
    "Dạ, em sẽ dựa vào điều làm mình khó chịu nhất để tư vấn ngắn gọn và đúng trọng tâm nhé.",
    "1. Mồ hôi làm ướt hoặc ố áo\n2. Mùi cơ thể\n3. Gặp cả hai tình trạng",
    "Mình chọn giúp em số 1, 2 hoặc 3 ạ?",
  ].join("\n\n");
}

function normalizeSemanticInput(input: ConsultationSlots | SemanticUnderstanding): SemanticUnderstanding {
  if ("slots" in input) return input;
  return { slots: input };
}

function hasGroundedSemanticEvidence(raw: string, semantic: SemanticUnderstanding): boolean {
  const message = normalize(raw);
  const evidence = [
    ...(semantic.evidence ?? []),
    ...(semantic.actions ?? []).flatMap((action) => action.evidence),
  ];
  return evidence.some((item) => {
    const grounded = normalize(item);
    return grounded.length >= 2 && message.includes(grounded);
  });
}

function resolveContextualSemantic(
  session: DemoSession,
  raw: string,
  semantic: SemanticUnderstanding,
): SemanticUnderstanding {
  const text = normalize(raw);
  const awaitingChildAge = session.pendingQuestionTopic === "child_age";
  const age = extractAgeMention(text, awaitingChildAge);
  const mentionsChild =
    awaitingChildAge ||
    /\b(?:tre|te)\s*(?:em|e|nho)?\b|\bbe(?: trai| gai| nha|minh| bao nhieu tuoi|\s*\d+\s*tuoi)\b|con (?:trai|gai)|duoi 12/.test(
      text,
    );

  if (age === undefined || !mentionsChild) return semantic;

  return {
    ...semantic,
    intent: "safety",
    topic: "child_age",
    subject: "child",
    age,
    asksDirectAnswer: true,
    needsClarification: false,
    confidence: Math.max(semantic.confidence ?? 0, 0.99),
    evidence: [...new Set([...(semantic.evidence ?? []), `${age}`])].slice(0, 3),
  };
}

function extractAgeMention(normalizedText: string, allowBareNumber = false): number | undefined {
  const explicit = normalizedText.match(/\b(\d{1,3})\s*(?:tuoi|t)\b/)?.[1];
  const bare = allowBareNumber ? normalizedText.match(/^(?:be\s*)?(\d{1,3})$/)?.[1] : undefined;
  const parsed = Number(explicit ?? bare);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 120 ? parsed : undefined;
}

function rememberTurn(session: DemoSession, turn: { role: "user" | "assistant"; text: string }): void {
  session.history.push(turn);
  if (session.history.length > 40) session.history.splice(0, session.history.length - 40);
}

function rememberSemanticPlan(
  session: DemoSession,
  semantic: SemanticUnderstanding,
  raw: string,
): void {
  if (semantic.intent) session.conversationMemory.currentGoal = semantic.intent;
  if (semantic.subject) session.conversationMemory.activeSubject = semantic.subject;
  if (semantic.nextStep) session.conversationMemory.nextStep = semantic.nextStep;
  if (semantic.newAngle) {
    session.conversationMemory.usedArguments = [
      ...new Set([...session.conversationMemory.usedArguments, semantic.newAngle]),
    ].slice(-8);
  }
  if (semantic.rejectedArguments?.length) {
    session.conversationMemory.rejectedArguments = [
      ...new Set([...session.conversationMemory.rejectedArguments, ...semantic.rejectedArguments]),
    ].slice(-8);
  }
  if (semantic.answeredQuestions?.length) {
    session.conversationMemory.answeredQuestions = [
      ...new Set([
        ...session.conversationMemory.answeredQuestions,
        ...semantic.answeredQuestions.map((item) => item.trim()).filter(Boolean),
      ]),
    ].slice(-12);
  }
  if (semantic.unsupportedQuestions?.length) {
    session.conversationMemory.openQuestions = [
      ...new Set([
        ...session.conversationMemory.openQuestions,
        ...semantic.unsupportedQuestions.map((item) => item.trim()).filter(Boolean),
      ]),
    ].slice(-8);
  }
  if (semantic.answeredQuestions?.length && session.conversationMemory.openQuestions.length) {
    const answered = new Set(semantic.answeredQuestions.map((item) => normalize(item)));
    session.conversationMemory.openQuestions = session.conversationMemory.openQuestions.filter(
      (item) => !answered.has(normalize(item)),
    );
  }
  if (semantic.intent === "price_objection" || semantic.intent === "efficacy_objection") {
    const comparedWith = extractMentionedCompetitor(raw);
    const objection: ConversationSalesObjection = {
      type: semantic.intent === "price_objection" ? "price" : "effectiveness",
      ...(comparedWith ? { comparedWith } : {}),
      status: "open",
      evidence: raw.slice(0, 180),
      sourceTurn: session.messages + 1,
    };
    const salesContext = session.conversationMemory.salesContext ?? { objections: [] };
    salesContext.objections = [
      ...salesContext.objections.filter(
        (item) => item.type !== objection.type || item.comparedWith !== objection.comparedWith,
      ),
      objection,
    ].slice(-8);
    session.conversationMemory.salesContext = salesContext;
  }
  applyBeneficiaryUpdates(session, semantic.beneficiaryUpdates ?? []);
}

function extractMentionedCompetitor(raw: string): string | undefined {
  const text = normalize(raw);
  if (/\betiaxil\b/u.test(text)) return "Etiaxil";
  if (/\bperspirex\b/u.test(text)) return "Perspirex";
  if (/\bnivea\b/u.test(text)) return "Nivea";
  if (/\bromano\b/u.test(text)) return "Romano";
  return undefined;
}

function rememberCustomerConsultationFacts(session: DemoSession, raw: string): void {
  const text = normalize(raw);
  const facts = session.conversationMemory.consultationFacts;
  if (/mo hoi|tiet mo hoi|uot ao|o ao/.test(text)) facts.sweatConcern = true;
  if (/(?:khong|ko|k|chua)\s+(?:bi\s+)?mui\s+(?:nang|nhieu)|mui\s+(?:khong|ko|k)\s+(?:nang|nhieu)/.test(text)) {
    facts.odorSeverity = "mild";
  } else if (/mui\s+(?:nang|nhieu)|hoi nach\s+(?:nang|nhieu)/.test(text)) {
    facts.odorSeverity = "strong";
  }
  if (/da\s+(?:minh\s+)?(?:hoi\s+)?nhay cam|da nhay cam/.test(text)) facts.sensitiveSkin = true;
  const triggers = new Set(facts.triggers);
  if (/cang thang/.test(text)) triggers.add("stress");
  if (/\bhop\b|gap khach/.test(text)) triggers.add("meeting");
  if (/van dong|the thao|gym|chay bo/.test(text)) triggers.add("exercise");
  if (/ngoai troi|troi nong|nong buc/.test(text)) triggers.add("heat");
  facts.triggers = [...triggers].slice(-4);
}

function applyBeneficiaryUpdates(
  session: DemoSession,
  updates: readonly SemanticBeneficiaryUpdate[],
): void {
  if (updates.length === 0) return;
  const latestMessage = [...session.history].reverse().find((turn) => turn.role === "user")?.text ?? "";
  const normalizedMessage = normalize(latestMessage);
  for (const update of updates) {
    const evidence = update.evidence.trim();
    if (!evidence || !normalizedMessage.includes(normalize(evidence))) continue;
    const byId = update.id
      ? session.conversationMemory.beneficiaries.find((item) => item.id === update.id)
      : undefined;
    const byIdentity = session.conversationMemory.beneficiaries.find(
      (item) => item.type === update.type && normalize(item.label) === normalize(update.label),
    );
    let beneficiary = byId ?? byIdentity;
    if (update.operation === "activate" && !beneficiary) continue;
    if (!beneficiary) {
      beneficiary = {
        id: nextBeneficiaryId(session.conversationMemory.beneficiaries, update.type),
        type: update.type,
        label: update.label.trim(),
        ageGroup: update.ageGroup,
        confirmed: update.confirmed,
        evidence,
        sourceTurn: session.messages + 1,
        ...(update.age !== undefined ? { age: update.age } : {}),
      };
      session.conversationMemory.beneficiaries.push(beneficiary);
    } else if (update.operation === "upsert") {
      beneficiary.type = update.type;
      beneficiary.label = update.label.trim();
      beneficiary.ageGroup = update.ageGroup;
      beneficiary.confirmed = update.confirmed;
      beneficiary.evidence = evidence;
      beneficiary.sourceTurn = session.messages + 1;
      if (update.age !== undefined) beneficiary.age = update.age;
    }
    session.conversationMemory.activeBeneficiaryId = beneficiary.id;
  }
  session.conversationMemory.beneficiaries = session.conversationMemory.beneficiaries.slice(-6);
  if (
    session.conversationMemory.activeBeneficiaryId &&
    !session.conversationMemory.beneficiaries.some(
      (item) => item.id === session.conversationMemory.activeBeneficiaryId,
    )
  ) {
    delete session.conversationMemory.activeBeneficiaryId;
  }
}

function nextBeneficiaryId(
  beneficiaries: readonly ConversationBeneficiary[],
  type: BeneficiaryType,
): string {
  let suffix = beneficiaries.filter((item) => item.type === type).length + 1;
  while (beneficiaries.some((item) => item.id === `beneficiary-${type}-${suffix}`)) suffix += 1;
  return `beneficiary-${type}-${suffix}`;
}

function sanitizeBeneficiaries(value: unknown): ConversationBeneficiary[] {
  if (!Array.isArray(value)) return [];
  const validTypes: readonly BeneficiaryType[] = ["self", "spouse", "child", "mother", "father", "other"];
  const validAgeGroups: readonly BeneficiaryAgeGroup[] = [
    "child",
    "adolescent",
    "adult",
    "older_adult",
    "unknown",
  ];
  return value
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
    .flatMap((item) => {
      if (
        typeof item.id !== "string" ||
        typeof item.label !== "string" ||
        !validTypes.includes(item.type as BeneficiaryType) ||
        !validAgeGroups.includes(item.ageGroup as BeneficiaryAgeGroup) ||
        typeof item.confirmed !== "boolean" ||
        typeof item.evidence !== "string" ||
        !Number.isInteger(item.sourceTurn)
      ) {
        return [];
      }
      return [
        {
          id: item.id,
          type: item.type as BeneficiaryType,
          label: item.label,
          ageGroup: item.ageGroup as BeneficiaryAgeGroup,
          confirmed: item.confirmed,
          evidence: item.evidence,
          sourceTurn: Number(item.sourceTurn),
          ...(Number.isInteger(item.age) ? { age: Number(item.age) } : {}),
        },
      ];
    })
    .slice(-6);
}

function sanitizePhoneHistory(value: unknown): ConversationPhoneMemory[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
    .flatMap((item) => {
      if (
        typeof item.value !== "string" ||
        !/^0\d{9}$/u.test(item.value) ||
        (item.status !== "current" && item.status !== "historical") ||
        typeof item.evidence !== "string" ||
        !Number.isInteger(item.sourceTurn)
      ) {
        return [];
      }
      return [
        {
          value: item.value,
          status: item.status as ConversationPhoneMemory["status"],
          evidence: item.evidence,
          sourceTurn: Number(item.sourceTurn),
        },
      ];
    })
    .slice(-6);
}

function isKnownBeneficiaryId(id: unknown, beneficiaries: unknown): id is string {
  return typeof id === "string" && sanitizeBeneficiaries(beneficiaries).some((item) => item.id === id);
}

function groundSemanticSlots(session: DemoSession, proposed: ConsultationSlots): ConsultationSlots {
  const latestCustomerText = normalize(
    [...session.history].reverse().find((turn) => turn.role === "user")?.text ?? "",
  );
  const customerText = normalize(
    session.history
      .filter((turn) => turn.role === "user")
      .slice(-6)
      .map((turn) => turn.text)
      .join(" "),
  );
  const grounded: ConsultationSlots = { ...proposed };
  const outdoorEvidence =
    /ngoai troi|van dong|lao dong nang|cong trinh|di nang|the thao|pickle|padel|gym|chay bo/.test(
      customerText,
    );
  const restingEvidence =
    /phong lanh|dieu hoa|van phong|ngoi yen|ngoi mat|ngoi (?:khong|ko|k)(?: cung)?|it van dong|cang thang/.test(
      customerText,
    );
  if (
    (grounded.workContext === "outdoor_heavy" && !outdoorEvidence) ||
    (grounded.workContext === "rest_or_stress" && !restingEvidence) ||
    (grounded.workContext === "both" && !(outdoorEvidence && restingEvidence))
  ) {
    delete grounded.workContext;
  }

  const sweatEvidence = /mo hoi|\buot\b|uot ao|o ao|tiet mo hoi/.test(customerText);
  const odorEvidence = /\bmui\b|mui co the|hoi nach/.test(customerText);
  // LLM-first: a short answer such as “cả 2” is meaningful only together
  // with the symptom question immediately before it. Do not require the
  // customer to repeat both literal keywords after the model has resolved
  // that context. The deterministic check remains a contradiction guard and
  // a fallback, not a replacement for the model's interpretation.
  const contextualSymptomAnswer =
    session.pendingQuestionTopic === "symptom" &&
    !/[?？]/u.test(latestCustomerText) &&
    !isUnknownAnswer(latestCustomerText) &&
    /^(?:1|2|3|ca\s*(?:hai|2)|hai cai|2 cai|deu bi|bi ca\s*(?:hai|2)|mo hoi|mui|mui co the|uot ao|o ao)$/u.test(
      latestCustomerText,
    );
  if (
    !contextualSymptomAnswer &&
    ((grounded.primarySymptom === "sweat" && !sweatEvidence) ||
      (grounded.primarySymptom === "odor" && !odorEvidence) ||
      (grounded.primarySymptom === "both" && !(sweatEvidence && odorEvidence)))
  ) {
    delete grounded.primarySymptom;
  }
  return grounded;
}

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function targetsExistingCompletedOrder(
  text: string,
  intent: CustomerIntent | undefined,
  actions: readonly ConversationAction[],
): boolean {
  if (actions.some((action) => action.type === "update_order")) return true;
  if (/^(?:dung|dung roi|dong y|ok|okay)$/.test(text)) return true;
  if (/^[.!?…]+$/.test(text)) return true;
  const explicitlyReferencesExistingOrder =
    /(?:ma van don|tracking|van don|don (?:cua|minh|hang)|don nay|don vua|don truoc)/.test(text);
  const explicitlyRequestsOrderMutation =
    /(?:doi|sua|thay|huy|cap nhat).*(?:don|dia chi|sdt|so dien thoai|nguoi nhan|so luong)|(?:don|dia chi|sdt|so dien thoai|nguoi nhan|so luong).*(?:doi|sua|thay|huy|cap nhat)/.test(
      text,
    );
  if (explicitlyReferencesExistingOrder || explicitlyRequestsOrderMutation) return true;
  return intent === "order_support" && /(?:giao|nhan|huy|doi|sua|van don|don)/.test(text);
}

function isReset(text: string): boolean {
  return /^(reset|lam moi|bat dau lai)$/.test(text);
}

function isGenericOpening(text: string): boolean {
  return /^(?:tu van|tu van giup|tu van giup minh|xin chao|chao|hello|hi|inbox|ib)(?: a| nhe| voi)?$/.test(
    text,
  );
}

function isStateRequest(text: string): boolean {
  return /^(trang thai|state|debug)$/.test(text);
}

function isOptOut(text: string): boolean {
  return (
    /(?:^|\b)(?:dung|ngung|khong muon|khong can) (?:nhan )?(?:tin nhan|tin|tu van)(?: nua)?\b/.test(text) ||
    /^(?:stop|huy dang ky|khong nhan nua|dung nhan)$/.test(text)
  );
}

function detectSafety(text: string): { redFlag: boolean; slots: ConsultationSlots } {
  const currentIrritation =
    !isPrePurchaseAdverseEffectQuestion(text) &&
    !isPriorOtherProductAdverseExperience(text) &&
    /dang (?:bi )?(?:do|rat|ngua)|bi (?:do|rat|ngua)(?:.*(?:do|rat|ngua))?|tray xuoc|ton thuong|viem/.test(
      text,
    );
  const recentProcedure = /vua (cao|wax|triet)|cao.*24|wax.*24|triet.*24/.test(text);
  return {
    redFlag: currentIrritation || recentProcedure,
    slots: {
      ...(currentIrritation ? { activeIrritation: true, damagedSkin: true } : {}),
      ...(recentProcedure ? { recentShaveWaxLaser: true } : {}),
    },
  };
}

function isPrePurchaseAuthenticityConcern(text: string): boolean {
  const mentionsAuthenticity =
    /hang that|chinh hang|hang gia|gia mao|fake|mua nham|ban nham|dung ban gia|gui hang gia|giao hang gia/.test(
      text,
    );
  if (!mentionsAuthenticity) return false;
  const saysAlreadyReceivedOrBought =
    /(?:toi|minh|chi|anh|em) (?:da|vua|moi) (?:mua|nhan)|(?:da|vua|moi) nhan (?:hang|duoc)|san pham (?:toi|minh|chi|anh|em) nhan|lo (?:toi|minh|chi|anh|em) nhan|don (?:cua )?(?:toi|minh|chi|anh|em)|shop (?:da )?(?:giao|gui) cho (?:toi|minh|chi|anh|em)/.test(
      text,
    );
  return !saysAlreadyReceivedOrBought;
}

function detectCareIssue(text: string): IssueType | undefined {
  // “vỏ hộp” is the packaging noun, not “vỡ hộp”. Normalization removes the
  // Vietnamese tone marks, so explicitly exclude common return-policy wording
  // before applying the damaged-goods fallback.
  const packagingOnly = /vo hop(?: giay)?|boc rach|rach vo|vut (?:vo|hop)|mat vo hop|khong con vo hop/.test(
    text,
  );
  if (isUrgentComplaint(text)) return "complaint";
  if (/danh gia.*(?:xau|1 sao|tieu cuc)|review.*(?:xau|1 sao)|cho 1 sao/.test(text)) return "negative_review";
  if (
    /hang gia|nghi gia|khong chinh hang|tem gia|fake/.test(text) &&
    !isPrePurchaseAuthenticityConcern(text)
  ) {
    return "counterfeit";
  }
  if (
    /giao cham|chua nhan|khong nhan duoc|giao sai|ship cham|that lac|shipper.*khong giao|don.*hoan ve|hoan ve|don vi van chuyen.*su co/.test(
      text,
    )
  ) {
    return "delivery";
  }
  if (
    !packagingOnly &&
    /\b(?:hang|hop|chai|lo|san pham)\b (?:bi )?\b(?:vo|do|ro ri|mop|nut)\b|\b(?:hang|hop|chai|lo|san pham)\b bi \bbe\b|\b(?:vo|do|ro ri|mop|nut)\b \b(?:hang|hop|chai|lo|san pham)\b|\bbe\b (?:vo|nat) \b(?:hang|hop|chai|lo|san pham)\b|\bthieu (?:hang|san pham)\b/.test(
      text,
    )
  ) {
    return "missing_or_damaged";
  }
  if (
    !isPriorOtherProductAdverseExperience(text) &&
    (!isKnownAluminumSaltAllergy(text) ||
      /sau khi dung|dang.*(?:do|rat|ngua|phat ban|noi me day|sung)|kho tho|kho khe|choang|kho nuot/.test(
        text,
      )) &&
    /dang (?:bi )?(?:do|rat|ngua)|bi (?:do|rat|ngua|kich ung|di ung)(?:.*(?:do|rat|ngua|phat ban|noi me day|sung))?|sau khi dung.*(?:di ung|phat ban|noi me day|sung)|tray xuoc|ton thuong|viem/.test(
      text,
    )
  ) {
    return "irritation";
  }
  if (/khong hieu qua|khong thay tac dung|van ra mo hoi|van co mui|dung.*khong do/.test(text))
    return "ineffective";
  return undefined;
}

/**
 * Khiếu nại phải thắng mọi tín hiệu thương mại trong cùng câu (ví dụ “đã mua
 * 1 lọ” chỉ là dữ kiện của đơn cũ, không phải yêu cầu tạo một đơn mới).
 * Bộ nhận diện này chỉ làm cổng ưu tiên an toàn; LLM vẫn chịu trách nhiệm hiểu
 * ngữ cảnh và soạn nội dung ở các hội thoại thông thường.
 */
function isUrgentComplaint(text: string): boolean {
  const complaintLanguage =
    /khieu nai|phan anh|boc phot|lam an (?:lom com|kieu gi|an gian)|lua dao|qua te|that vong|buc xuc|khong chap nhan|bao (?:cong an|quan ly thi truong)|kien (?:shop|cao)/.test(
      text,
    );
  const asksOrderInvestigation =
    /(?:kiem tra|check|tra|xu ly|giai quyet).{0,35}(?:ma )?(?:don|van don)|(?:ma )?(?:don|van don).{0,35}(?:kiem tra|check|tra|xu ly|giai quyet)/.test(
      text,
    );
  const orderFailure =
    /(?:don|hanh trinh|trang thai|van don).{0,45}(?:bao )?(?:huy|hoan|that lac|khong giao|chua giao|giao cham|giao sai)|(?:bao )?(?:huy|hoan|that lac|khong giao|chua giao|giao cham|giao sai).{0,45}(?:don|hang|van don)/.test(
      text,
    );
  const urgentDeliveryDemand =
    /(?:giao|ship).{0,20}(?:le|gap|ngay|nhanh).{0,60}(?:boc phot|khieu nai|phan anh|lam an|khong chap nhan)/.test(
      text,
    );

  return (
    (complaintLanguage && (asksOrderInvestigation || orderFailure || /don|hang|san pham|shop/.test(text))) ||
    (asksOrderInvestigation && orderFailure) ||
    urgentDeliveryDemand
  );
}

function detectDirectIntent(text: string): CustomerIntent | undefined {
  if (isInternalSystemProbe(text) || isOutOfScopeAssistantProbe(text)) {
    return "bot_identity";
  }
  if (isUrgentComplaint(text)) return "order_support";
  if (isOrderRecapRequest(text)) return "order_support";
  if (isOrderCaptureMessage(text)) return "buying";
  if (isHypotheticalIrritationRefundQuestion(text)) return "order_support";
  if (isProductPurposeQuestion(text)) return "product_effect";
  if (isPriorOtherProductAdverseExperience(text)) return "product_comparison";
  if (isPriorSweatProcedureEffectQuestion(text)) return "product_comparison";
  if (isPriceAndShippingPolicyQuestion(text)) return "price_request";
  if (isNamedCompetitorPriceObjection(text)) return "price_objection";
  if (isDeliveryInspectionQuestion(text)) return "order_support";
  if (isDomesticDeliveryInspectionQuestion(text)) return "order_support";
  if (isAlcoholAndScentPremiseQuestion(text)) return "product_comparison";
  if (isProductNatureAndScentQuestion(text)) return "product_comparison";
  if (isHairRemovalSafetyQuestion(text)) return "usage_guidance";
  if (isConditionalQuantityPurchase(text)) return "buying";
  if (isPermanentControlQuestion(text)) return "product_effect";
  if (isApplicationFeelOrClothingConcern(text)) return "product_effect";
  if (isSweatWashOffConcern(text)) return "product_effect";
  if (isPriceAcknowledgementWithEffectQuestion(text)) {
    return "product_effect";
  }
  if (isUsageDurationOrFrequencyQuestion(text)) {
    return "usage_frequency";
  }
  if (
    /(?:^|\b)(?:em|ban|shop|day|đây).*(?:la ai|là ai|ai a|ai à|chatbot|chatgpt|bot|robot|nguoi that|người thật)|(?:dang|đang).*(?:noi chuyen|nói chuyện).*(?:nguoi|người|ai|chatgpt|bot)|(?:co phai|có phải).*(?:ai|chatgpt|chatbot|bot)/.test(
      text,
    )
  ) {
    return "bot_identity";
  }
  if (isPrePurchaseAuthenticityConcern(text)) {
    return "authenticity_question";
  }
  if (isProductCompositionMythQuestion(text)) return "authenticity_question";
  if (isShelfLifeQuestion(text)) return "usage_guidance";
  if (isWholesaleDealerInquiry(text)) return "order_support";
  if (isReturnsPolicyQuestion(text)) return "order_support";
  if (isKnownAluminumSaltAllergy(text)) return "safety";
  if (isBulkPurchaseBenefitQuestion(text)) return "negotiation";
  if (isPromotionInquiry(text)) return "promotion_inquiry";
  if (
    /(?:tu|từ)\s*\d+\s*k?.*(?:len|lên|thanh|thành)\s*\d+\s*k?|\d+\s*k?.*(?:len|tang).*\d+\s*k?|sao.*gia.*(?:tang|len)|gia cu.*gia moi/.test(
      text,
    )
  ) {
    return "price_change";
  }
  if (isMorningFragranceLayeringQuestion(text)) return "usage_guidance";
  if (isBottleLongevityQuestion(text)) return "usage_frequency";
  if (isMissedEveningApplicationQuestion(text)) return "usage_time";
  if (isHairRemovalMorningClothingQuestion(text)) return "usage_guidance";
  if (isMorningApplicationQuestion(text)) {
    return "usage_time";
  }
  if (
    /da nhay cam|\b(?:tre|te)\s*(?:em|e|nho)?\b|\bbe(?: trai| gai| nha|minh| bao nhieu tuoi|\s*\d+\s*tuoi)\b|duoi 12|12 tuoi|me bau|ba bau|pa pau|ba pau|mang thai|cho con bu|doi tuong.*(?:dung|su dung)|\bai\s+(?:co the\s+)?(?:dung|su dung)\s+duoc\b|\ban toan\b.{0,40}\b(?:khong|ko|k)\b/.test(
      text,
    )
  ) {
    return "safety";
  }
  if (isHypotheticalIrritationQuestion(text)) return "safety";
  if (isConditionalEfficacyObjection(text)) return "efficacy_objection";
  if (isProductComparison(text)) return "product_comparison";
  if (isNegotiation(text)) return "negotiation";
  if (isPurchaseDecline(text)) return "decline_purchase";
  if (isExplicitPriceDecline(text)) return "decline_purchase";
  if (isPriceConcern(text)) return "price_objection";
  if (isPriceRequest(text)) return "price_request";
  if (/cach dung|huong dan (?:dung|su dung)|dung nhu the nao/.test(text)) {
    return "usage_guidance";
  }
  if (/may lan.*tuan|tan suat|2.?3 lan.*tuan/.test(text)) {
    return "usage_frequency";
  }
  if (productEffectTopic(text, {})) return "product_effect";
  if (isBuyingIntent(text)) return "buying";
  return undefined;
}

export function isPriceAndShippingPolicyQuestion(value: string): boolean {
  const text = normalize(value);
  const asksPrice = /\b(?:gia|gia ro|bao nhieu tien)\b/.test(text);
  const asksShipping =
    /\b(?:freeship|free ship|mien phi giao|phi giao|phi ship|co duoc.*ship|hay phai mua)\b/.test(text);
  const mentionsQuantity = /\b(?:[1-5]|mot|hai|ba|bon|nam)\s+lo\b|\bcombo\b/.test(text);
  return asksPrice && asksShipping && mentionsQuantity;
}

export function isQuantityShippingPolicyQuestion(value: string): boolean {
  const text = normalize(value);
  const quantities = new Set<number>();
  for (const match of text.matchAll(/\b(1|2|3|4|5|mot|hai|ba|bon|nam)\s+lo\b/g)) {
    const token = match[1];
    const quantity =
      token === "mot"
        ? 1
        : token === "hai"
          ? 2
          : token === "ba"
            ? 3
            : token === "bon"
              ? 4
              : token === "nam"
                ? 5
                : Number(token);
    if (Number.isInteger(quantity)) quantities.add(quantity);
  }
  const wordToQuantity: Record<string, number> = {
    "1": 1,
    "2": 2,
    "3": 3,
    "4": 4,
    "5": 5,
    mot: 1,
    hai: 2,
    ba: 3,
    bon: 4,
    nam: 5,
  };
  for (const match of text.matchAll(/\b(?:mua|lay|chon|combo)\s+(1|2|3|4|5|mot|hai|ba|bon|nam)\b/g)) {
    const quantity = wordToQuantity[match[1] ?? ""];
    if (quantity) quantities.add(quantity);
  }
  const asksShipping =
    /\b(?:freeship|free ship|mien phi giao|phi giao|phi ship|mat phi ship|co duoc.*ship)\b/.test(text);
  const questionShape = /\?|\b(?:khong|ko|k|neu|hay phai)\b/.test(text);
  return quantities.size >= 2 && asksShipping && questionShape;
}

export function isDomesticDeliveryInspectionQuestion(value: string): boolean {
  const text = normalize(value);
  const asksEta = /\b(?:may ngay|bao lau|khi nao|bao gio)\b.*\b(?:nhan|giao|toi)\b/.test(text);
  return asksEta && isDeliveryInspectionQuestion(value) && !isInternationalShippingQuestion(value);
}

export function isDeliveryInspectionQuestion(value: string): boolean {
  const text = normalize(value);
  return (
    /\b(?:boc|kiem|kjem|kiem tra|kjem tra|kiem hang|kjem hang|dong kiem)\b.{0,35}\b(?:hang|hag|hop|san pham|seal|tem)\b/.test(
      text,
    ) ||
    /\bmo\b.{0,20}\b(?:hang|hag|hop|seal|tem)\b/.test(text) ||
    /\b(?:nhan|nhan hang|nhan hag)\b.{0,35}\b(?:kiem|kjem|kiem tra|kjem tra|kiem hang|kjem hang)\b/.test(
      text,
    )
  );
}

export function isDomesticDeliveryEtaQuestion(value: string): boolean {
  const text = normalize(value);
  const asksEta =
    /\b(?:may ngay|bao lau|khi nao|bao gio)\b.{0,50}\b(?:nhan(?: duoc)?(?: hang)?|giao hang|ship|giao den|giao toi)\b/.test(
      text,
    ) ||
    /\b(?:ship|giao)\b.{0,60}\b(?:may ngay|bao lau|khi nao|bao gio)\b.{0,15}(?:\btoi\b|\bden\b|\bnhan\b|$)/.test(
      text,
    ) ||
    /\b(?:ship|giao)\b.{0,25}\b(?:cham|tre|lau|kip)\b/.test(text);
  return asksEta && !isInternationalShippingQuestion(value);
}

export function isExpressDeliveryQuestion(value: string): boolean {
  const text = normalize(value);
  return /\b(?:ship|giao)\s*(?:hang\s*)?(?:hoa toc|ngay|trong ngay|tuc thoi|2h|4h)\b|\b(?:grab|ahamove)\b.{0,25}\b(?:ship|giao|chay)\b/.test(
    text,
  );
}

export function isOfflineStoreQuestion(value: string): boolean {
  const text = normalize(value);
  return /\b(?:co (?:cua hang|shop offline|showroom)(?: khong| ko| k)?|cua hang offline|showroom|dia chi (?:shop|cua hang)|shop o dau|cua hang o dau|mua truc tiep|den (?:shop|cua hang) mua|qua (?:shop|cua hang) (?:mua|lay|xem))\b/.test(
    text,
  );
}

function domesticDeliveryInspectionReply(text: string): string {
  void text;
  return `${domesticDeliveryEtaPolicyReply()}\n\nKhi nhận, mình được kiểm tra bao bì ngoài, tem và đúng lọ Stopirex; mình không mở seal sản phẩm trước khi xác nhận nhận hàng nhé.`;
}

function domesticDeliveryEtaPolicyReply(): string {
  return [
    "Dạ thời gian giao dự kiến:",
    "• Nội thành (cùng tỉnh/thành phố): 1–2 ngày.",
    "• Nội miền (ví dụ TP.HCM đi các tỉnh miền Nam): 2–3 ngày.",
    "• Liên miền (miền Bắc ⇄ miền Nam): 3–5 ngày ạ.",
  ].join("\n");
}

function onlineOnlyDeliveryPolicyReply(text: string): string {
  const asksExpress = isExpressDeliveryQuestion(text);
  const asksOffline = isOfflineStoreQuestion(text);
  const parts = [
    ...(asksOffline
      ? ["Dạ bên em không có cửa hàng offline hoặc showroom; mình đặt Stopirex online ạ."]
      : []),
    ...(asksExpress
      ? [
          "Bên em không có ship hỏa tốc hoặc giao tức thời; đơn chỉ được gửi qua đơn vị vận chuyển ạ.",
          domesticDeliveryEtaPolicyReply(),
        ]
      : ["Đơn online được gửi qua đơn vị vận chuyển ạ."]),
  ];
  return parts.join("\n\n");
}

function isProductNatureAndScentQuestion(value: string): boolean {
  const text = normalize(value);
  const asksNature = /\b(?:lan khu mui|thuoc tri|tri mo hoi|ngan tiet mo hoi|dac tri)\b/.test(text);
  const asksScent = /\b(?:co mui gi|co mui|thom|mui gi)\b/.test(text);
  return asksNature && asksScent;
}

function isHouseholdSharedUseQuestion(value: string): boolean {
  const text = normalize(value);
  const mentionsRelative = /\b(?:vo|chong|nguoi yeu|chi gai|anh trai|nguoi nha)\b/.test(text);
  const asksSharedUse = /\b(?:dung ke|dung chung|xai ke|xai chung)\b|\bco dung duoc khong\b/.test(text);
  const mentionsSafetyPriorityAudience =
    /\b(?:phu nu co thai|mang thai|dang bau|me bau|ba bau|bau bi|co bau|cho con bu|duoi 12|tre em|be\s+\d+\s+tuoi)\b/.test(
      text,
    );
  return mentionsRelative && asksSharedUse && !mentionsSafetyPriorityAudience;
}

function isDarkeningAndClothingQuestion(value: string): boolean {
  const text = normalize(value);
  const asksDarkening = /\b(?:tham|den xi|sam)\b.*\b(?:nach|da)\b|\bnach\b.*\b(?:tham|den|sam)\b/.test(text);
  const asksClothing = /\b(?:o vang|vang nach ao|ao so mi|ao trang)\b/.test(text);
  return asksDarkening && asksClothing;
}

function isUnderarmDarkeningObjection(value: string): boolean {
  const text = normalize(value);
  if (/\b(?:xa phong|san pham|kem|serum)\b.{0,25}\b(?:tri|giam|mo) tham\b/.test(text)) return false;
  if (/\b(?:da mong|da nhay cam|ngua|rat|kich ung|cham chich)\b/.test(text)) return false;
  return (
    /\b(?:tham|sam|den(?: den)?|den xi)\b.{0,35}\b(?:nach|vung nach|da nach)\b/.test(text) ||
    /\b(?:nach|vung nach|da nach)\b.{0,35}\b(?:tham|sam|den(?: den)?|den xi)\b/.test(text)
  );
}

function isCombinedPregnancyAndChildQuestion(value: string): boolean {
  const text = normalize(value);
  const asksPregnancy = /\b(?:phu nu co thai|mang thai|me bau|ba bau|bau bi|co bau)\b/.test(text);
  const asksChild = /\b(?:be|tre|tuoi day thi)\b/.test(text) && extractAgeMention(text) !== undefined;
  return asksPregnancy && asksChild;
}

function isMorningWashAndFragranceQuestion(value: string): boolean {
  return isMorningSoapWashQuestion(value) && isMorningFragranceLayeringQuestion(value);
}

function isHandsOrFeetApplicationQuestion(value: string): boolean {
  const text = normalize(value);
  const mentionsArea = /\b(?:mo hoi )?(?:tay|chan|ban tay|ban chan|long ban tay|long ban chan)\b/.test(text);
  const asksApplication =
    /\b(?:lan|boi|dung|xai|quet)\b.{0,45}\b(?:tay|chan|ban tay|ban chan)\b|\b(?:tay|chan|ban tay|ban chan)\b.{0,45}\b(?:lan|boi|dung|xai|quet)\b/.test(
      text,
    );
  return mentionsArea && asksApplication;
}

function isEligibleChildAgeQuestion(value: string): boolean {
  const text = normalize(value);
  const age = extractAgeMention(text);
  return age !== undefined && age >= 12 && /\b(?:be|tre|tuoi day thi)\b/.test(text);
}

function isKnownAluminumSaltAllergy(text: string): boolean {
  return /(?:di ung|khong hop|phan ung).*(?:muoi nhom|aluminum|aluminium)|(?:muoi nhom|aluminum|aluminium).*(?:di ung|khong hop|phan ung)/.test(
    text,
  );
}

function isSevereAllergicReaction(text: string): boolean {
  return /kho tho|kho khe|choang|kho nuot|sung (?:moi|mat|luoi)|me day.*toan|ngat/.test(text);
}

/**
 * Nhận diện yêu cầu dò/tìm cách lấy chỉ dẫn, cấu hình hoặc thông tin truy cập
 * nội bộ. Rule này được dùng trước LLM để nội dung nhạy cảm không cần đi qua
 * luồng diễn giải tự do.
 */
export function isInternalSystemProbe(value: string): boolean {
  const text = normalize(value);
  const asksForSecrets =
    /\b(?:system ?prompt|prompts?|promt|cau lenh noi bo|huong dan noi bo|cau hinh noi bo|developer message|system message|api ?key|access ?token|token truy cap|token he thong|khoa api|bien moi truong|env file)\b/.test(
      text,
    );
  const instructionOverride =
    /(?:bo qua|quen|xoa|vo hieu hoa).{0,35}(?:lenh|chi dan|huong dan|quy tac|noi dung).{0,25}(?:truoc|he thong|noi bo)|(?:ignore|disregard|forget).{0,35}(?:previous|prior|system|developer).{0,25}(?:instruction|prompt|message)|(?:dong vai|gia vo|role ?play).{0,35}(?:system|developer|admin|quan tri)|(?:hay|phai) (?:in|xuat|hien thi|tiet lo).{0,35}(?:prompt|token|api key|cau hinh|lenh noi bo)/.test(
      text,
    );
  const forcedInternalOutput =
    /(?:tra ve|xuat ra|in ra).{0,25}(?:json|schema|tool call|function call).{0,35}(?:he thong|noi bo|bi mat)|(?:jailbreak|prompt injection|do thiet lap)/.test(
      text,
    );
  return asksForSecrets || instructionOverride || forcedInternalOutput;
}

/** Những phép thử nằm ngoài phạm vi tư vấn Stopirex và cần trả lời minh bạch. */
export function isOutOfScopeAssistantProbe(value: string): boolean {
  const text = normalize(value);
  const mentionsStopirexContext =
    /\b(?:stopirex|san pham|cach dung|su dung|mo hoi|mui co the|hoi nach|lan nach)\b/.test(text);
  if (mentionsStopirexContext) return false;
  return /\b(?:thoi tiet|du bao thoi tiet|nhiet do|hom nay co mua|may gio|hom nay ngay may|tin tuc hom nay|ket qua xo so)\b/.test(
    text,
  );
}

export function isReturnsPolicyQuestion(value: string): boolean {
  const text = normalize(value);
  return /doi tra|tra hang|hoan tien|hoan xeng|tra tien|chinh sach doi|doi hang|phi doi tra|duoc doi khong/.test(
    text,
  );
}

function isProductComparison(text: string): boolean {
  const comparison = /khac gi|khac nhau|diem khac|so voi|phan biet|hon gi/.test(text);
  const comparisonTarget =
    /lan (?:thuong|truyen thong|hang ngay|khu mui|khac)|lan deodorant|deodorant|san pham (?:thuong|truyen thong|hang ngay|khac)/.test(
      text,
    );
  return comparison && comparisonTarget;
}

function isConditionalEfficacyObjection(text: string): boolean {
  const hasConditionalPurchase =
    /neu.*(?:dung|hieu qua|do|giam|het|khoi|dut).*(?:mua|lay|chot)|neu.*(?:mua|lay|chot)/.test(text);
  const hasFailureCondition =
    /(?:khong|ko|k).*(?:dung|hieu qua|do|giam|het|khoi|dut).*(?:mo hoi|mui|uot|o ao|thi thoi|khong mua|khong lay)|(?:khong|ko|k).*(?:mo hoi|mui).*(?:thi thoi|khong mua|khong lay)/.test(
      text,
    );
  return hasConditionalPurchase && hasFailureCondition;
}

/**
 * Khách chốt số lượng ngay trong một câu điều kiện về hiệu quả, ví dụ:
 * “Nếu đúng như lời nói thì cho mình 1 lọ”. Đây là một hành động mua hàng,
 * không phải chỉ là câu hỏi hiệu quả.
 */
export function isConditionalQuantityPurchase(value: string): boolean {
  const text = normalize(value);
  if (!detectQuantity(text) || !/(?:^|\b)neu\b/.test(text)) return false;

  const hasEfficacyCondition =
    /dung nhu|nhu (?:loi|shop|em|tu van)|hieu qua|co tac dung|kiem soat|giam|do|het/.test(text);
  const hasExplicitOrderAction =
    /(?:^|\b)(?:cho|gui|lay|chot|dat|mua)(?:\s+(?:minh|menh|toi|anh|chi|em))?\s*(?:(?:1|mot|2|hai)\s+lo|combo)(?:\b|$)/.test(
      text,
    );
  return hasEfficacyCondition && hasExplicitOrderAction;
}

function detectCareScenario(
  text: string,
  issue: IssueType | undefined,
): SemanticUnderstanding["scenario"] | undefined {
  if (!issue) return undefined;
  if (issue === "irritation" && isPrePurchaseAdverseEffectQuestion(text)) {
    return "hypothetical";
  }
  if (
    issue === "irritation" &&
    /\b(?:hien|hien tai|dang|con) (?:dang )?(?:bi )?(?:do|rat|ngua|kich ung|viem)\b|\bda (?:dang )?(?:do|rat|ngua|kich ung|viem)\b/.test(
      text,
    )
  ) {
    return "actual";
  }
  if (
    /(?:^|\b)(?:neu|gia su|vi du|lo nhu|lo ma|truong hop|trong truong hop)\b/.test(text) ||
    /\bco bi\b.{0,80}\b(?:khong|ko|k)\b/.test(text) ||
    /\b(?:bi|xuat hien).*(?:thi sao|thi lam sao|co phai|phai ngung|can ngung)\b/.test(text)
  ) {
    return "hypothetical";
  }
  if (/\b(?:tung bi|truoc day|lan truoc|da tung)\b/.test(text)) return "past";
  return "actual";
}

function isHypotheticalIrritationQuestion(text: string): boolean {
  return (
    isPrePurchaseAdverseEffectQuestion(text) ||
    (/(?:^|\b)(?:neu|gia su|vi du|lo nhu|lo ma|truong hop|trong truong hop)\b/.test(text) &&
      /(?:rat|ngua|do da|kich ung|tham nach|sam nach)/.test(text))
  );
}

/**
 * Câu hỏi về nguy cơ trước khi dùng, ví dụ “dùng có bị rát không?”.
 * Phải tách khỏi lời xác nhận sự cố hiện tại như “đã dùng và đang bị rát”.
 */
export function isPrePurchaseAdverseEffectQuestion(value: string): boolean {
  const text = normalize(value);
  const adverseEffect = /(?:rat|ngua|do da|kich ung|tham nach|sam nach|den nach|kho tham)/;
  if (!adverseEffect.test(text)) return false;

  const actualUseEvidence =
    /\b(?:da|vua|moi) (?:dung|su dung|lan|boi)\b.*\b(?:bi|dang|hien)\b|\b(?:dung|su dung|lan|boi) (?:xong|roi)\b.*\b(?:bi|dang|hien)\b|\bsau khi (?:dung|su dung|lan|boi)\b.*\b(?:bi|dang|hien)\b|\b(?:hien|hien tai) (?:dang )?(?:bi )?(?:rat|ngua|do da|kich ung)\b|\bdang (?:bi )?(?:rat|ngua|do da|kich ung)\b/.test(
      text,
    );
  if (actualUseEvidence) return false;

  const explicitlyBeforeUse =
    /\b(?:chua|chua tung) (?:dung|su dung|lan|boi)\b/.test(text) ||
    /\b(?:so|lo|ngai) (?:se |co |minh |lai )?(?:bi |gay )?(?:rat|ngua|do da|kich ung|tham nach|sam nach|den nach)\b/.test(
      text,
    );
  if (explicitlyBeforeUse) return true;

  const asksRisk =
    /\b(?:co bi|co gay|co lam|lieu co|se bi)\b/.test(text) ||
    /\b(?:rat|ngua|do da|kich ung|tham nach|sam nach|den nach|kho tham)\b.*\b(?:khong|ko|k)\b/.test(text);
  const mentionsUseOrSensitiveSkin =
    /\b(?:dung|su dung|lan|boi|stopirex|san pham|da mong|da nhay cam|da yeu|de kich ung)\b/.test(text);
  return asksRisk && mentionsUseOrSensitiveSkin;
}

/**
 * Khách đang kể trải nghiệm xấu với một sản phẩm khác trước khi hỏi về
 * Stopirex. Không được gán phản ứng đó cho Stopirex và mở ca khiếu nại.
 */
export function isPriorOtherProductAdverseExperience(value: string): boolean {
  const text = normalize(value);
  const adverseEffect = /\b(?:viem|rat|ngua|do da|kich ung|cham chich|noi mun|tham nach|sam nach)\b/.test(
    text,
  );
  if (!adverseEffect) return false;
  const explicitlyStopirexUse =
    /(?:mua|dung|su dung|lan|boi).{0,35}\bstopirex\b|\bstopirex\b.{0,35}(?:mua|dung|su dung|lan|boi)/.test(
      text,
    );
  if (explicitlyStopirexUse) return false;
  const historicalOtherProduct =
    /(?:truoc|truoc day|da tung|tung).{0,80}(?:mua|dung|su dung|lan|boi).{0,80}(?:may loai(?:\s+lan)?|loai khac|san pham khac|hang khac|loai quang cao|lan khac|lan xin|etiaxil|perspirex)|(?:mua|dung|su dung|lan|boi).{0,60}(?:may loai(?:\s+lan)?|loai khac|san pham khac|hang khac|loai quang cao|lan khac|lan xin|etiaxil|perspirex)|(?:may loai(?:\s+lan)?|loai khac|san pham khac|hang khac|loai quang cao|lan khac|lan xin|etiaxil|perspirex).{0,60}(?:mua|dung|su dung|lan|boi)/.test(
      text,
    );
  const asksAboutCurrentOffer =
    /\b(?:loai|hang|san pham) (?:nha|minh|ben minh|nay)\b|\bben (?:em|minh|shop)\b|\bstopirex\b|\bco (?:xin|tot|hieu qua|bi|gay)\b|\bhay lai nhu\b|\bneu cam ket\b/.test(
      text,
    );
  return historicalOtherProduct && asksAboutCurrentOffer;
}

export function isConditionalNoIrritationPurchase(value: string): boolean {
  const text = normalize(value);
  return (
    /\bneu\b.{0,70}\bcam ket\b.{0,80}\b(?:khong|ko|k)\b.{0,45}\b(?:ngua|rat|do da|kich ung|viem)\b/.test(
      text,
    ) && /\b(?:cho|gui|lay|chot|dat|mua)\b.{0,25}\b(?:1|mot|2|hai)\s+lo\b|\bcombo\b/.test(text)
  );
}

/** Câu hỏi liệu mồ hôi/vận động có làm “trôi” tác dụng đã dùng từ tối hôm trước. */
export function isSweatWashOffConcern(value: string): boolean {
  const text = normalize(value);
  const mentionsSweatOrExercise =
    /mo hoi|uot dam|tap gym|tap the thao|da bong|choi bong|van dong|chay bo/.test(text);
  const asksLossOfEffect =
    /troi (?:mat )?(?:tac dung|hieu qua)|mat (?:tac dung|hieu qua)|het (?:tac dung|hieu qua)/.test(text);
  return mentionsSweatOrExercise && asksLossOfEffect;
}

/** Khách hỏi cảm giác ngay sau khi lăn hoặc sản phẩm có bám/ố/làm cứng áo không. */
export function isApplicationFeelOrClothingConcern(value: string): boolean {
  const text = normalize(value);
  const asksApplicationFeel =
    /\b(?:moi|vua|luc|sau khi) (?:lan|boi)\b.{0,55}\b(?:uot|am|nhep|bet|dinh)\b/.test(text) ||
    /\b(?:lan|boi)(?: xong| len| vao)?\b.{0,45}\b(?:uot|am|nhep|bet|dinh)\b/.test(text);
  const asksClothingEffect =
    /\b(?:bam|dinh|o|vang|vet trang|cung vai)\b.{0,35}\b(?:ao|so mi|vai)\b|\b(?:ao|so mi|vai)\b.{0,35}\b(?:bam|dinh|o|vang|vet trang|cung)\b/.test(
      text,
    );
  return asksApplicationFeel || asksClothingEffect;
}

function isClothingCompensationQuestion(value: string): boolean {
  const text = normalize(value);
  const mentionsClothingDamage =
    /\b(?:o|vang|hong|hu|lam ban)\b.{0,45}\b(?:ao|vai|quan ao)\b|\b(?:ao|vai|quan ao)\b.{0,45}\b(?:o|vang|hong|hu|lam ban)\b/.test(
      text,
    );
  const asksCompensation =
    /\b(?:shop|ben (?:em|minh))?\s*(?:co|se|phai)?\s*den(?: tien)?\s+(?:ao|vai|quan ao|tai san)\b/.test(
      text,
    ) ||
    /\bboi thuong\b.{0,35}\b(?:ao|vai|quan ao|tai san)\b/.test(text) ||
    /\btra tien\b.{0,20}\b(?:ao|vai|quan ao|tai san)\b/.test(text);
  return mentionsClothingDamage && asksCompensation;
}

/**
 * Một câu hỏi sản phẩm rõ ràng được phép tạm ngắt bước hỏi CSKH cũ.
 * Hồ sơ CSKH vẫn được giữ nguyên; chỉ tin hiện tại được trả lời theo đúng ý mới.
 */
function canInterruptActiveCare(intent: CustomerIntent): boolean {
  return [
    "bot_identity",
    "price_change",
    "price_request",
    "promotion_inquiry",
    "price_objection",
    "negotiation",
    "product_comparison",
    "authenticity_question",
    "product_effect",
    "usage_guidance",
    "usage_time",
    "usage_frequency",
    "buying",
  ].includes(intent);
}

function isExplicitCustomerQuestion(value: string): boolean {
  if (/[?？]/u.test(value)) return true;
  const text = normalize(value);
  return /\b(?:bao nhieu|the nao|tai sao|vi sao|la gi|co .* khong|duoc khong|dung khong|hay khong)\b/u.test(
    text,
  );
}

function dismissMisattributedCare(session: DemoSession): void {
  const retainedSlots = { ...session.consultation.slots };
  delete retainedSlots.activeIrritation;
  delete retainedSlots.damagedSkin;
  delete retainedSlots.recentShaveWaxLaser;
  delete session.care;
  session.mode = "sales";
  session.pipeline = session.previousSalesPipeline ?? "2.Đang tư vấn";
  session.consultation = {
    ...session.consultation,
    slots: { ...retainedSlots, priorIrritation: true },
    stage: session.previousSalesStage ?? "S5.guidance",
  };
  if (session.signal === "CT.An toàn") session.signal = undefined;
  delete session.previousSalesPipeline;
  delete session.previousSalesStage;
}

function isNegotiation(text: string): boolean {
  return /free\s*ship|freeship|mien phi (?:ship|giao)|bao ship|ho tro (?:ship|phi giao)|bot gia|bot them|bot dong nao|giam gia|fix gia|de gia cu|tang kem|qua (?:gi|tang)|gia cu.*(?:lay|chot)|(?:lay|chot).*(?:gia cu|gia \d+)/.test(
    text,
  );
}

export function isBulkPurchaseBenefitQuestion(value: string): boolean {
  const text = normalize(value);
  const bulkQuantity = /\b(?:[3-9]|\d{2,}|ba|bon|nam)\s*lo\b|\b(?:mua|lay|chot)\s+(?:nhieu|so luong)\b/.test(
    text,
  );
  const asksBenefit =
    /bot(?: gia| them| dong nao)|giam(?: gia| them)|uu dai|khuyen mai|tang kem|qua (?:gi|tang)|ho tro them/.test(
      text,
    );
  return bulkQuantity && asksBenefit;
}

function isPromotionInquiry(text: string): boolean {
  const mentionsProgram = /chuong trinh|khuyen mai|uu dai|voucher|ma giam|coupon/.test(text);
  const mentionsDiscount = /giam|sale|discount|\d+\s*k\b|\d{2,}\s*(?:nghin|dong)\b/.test(text);
  return mentionsProgram && mentionsDiscount;
}

function extractDiscountAmountVnd(text: string): number | undefined {
  const compact = text.match(/(?:giam|sale)?\s*(\d{1,3})\s*k\b/);
  if (compact?.[1]) return Number(compact[1]) * 1_000;
  const full = text.match(/(?:giam|sale)?\s*(\d{2,3}(?:[.\s]\d{3})+)\s*(?:d|dong)?\b/);
  if (!full?.[1]) return undefined;
  return Number(full[1].replace(/[.\s]/g, ""));
}

function promotionVerificationReply(
  discountAmountVnd: number | undefined,
  priceAlreadySent: boolean,
): string {
  const discountReference = discountAmountVnd
    ? `chương trình giảm ${formatVnd(discountAmountVnd)}`
    : "chương trình mình đang nhắc tới";
  const messages = [
    `Em chưa có thông tin đã được xác nhận về ${discountReference}.`,
    "Anh/chị gửi em ảnh hoặc đường link nhé. Em chuyển bộ phận liên quan kiểm tra đúng kênh, điều kiện áp dụng và phản hồi lại mình ạ.",
  ];
  if (!priceAlreadySent) {
    messages.unshift(
      "Dạ hiện bên em đang áp dụng mức 285.000đ cho 1 lọ, phí giao 30.000đ; combo 2 lọ là 510.000đ và được miễn phí giao.",
    );
  }
  return messages.join("\n\n");
}

function hasRecentlySentPrice(session: DemoSession): boolean {
  return session.history
    .filter((turn) => turn.role === "assistant")
    .slice(-6)
    .some((turn) => {
      const text = normalize(turn.text);
      return /285[.]?000/.test(text) && (/510[.]?000/.test(text) || /phi giao 30[.]?000/.test(text));
    });
}

function pauseForHumanReview(session: DemoSession, reason: string, signal?: SignalTag): void {
  session.previousSalesPipeline = session.pipeline;
  session.previousSalesStage = session.consultation.stage;
  session.pipeline = "C3.Chờ CSKH";
  session.consultation = {
    ...session.consultation,
    stage: "H.handoff",
  };
  session.manualHandoffReason = reason;
  if (signal) session.signal = signal;
}

function resumeAfterSoftHandoff(session: DemoSession): void {
  if (!session.manualHandoffReason || session.pipeline !== "C3.Chờ CSKH") {
    return;
  }
  session.pipeline = session.previousSalesPipeline ?? "2.Đang tư vấn";
  session.consultation = {
    ...session.consultation,
    stage: session.previousSalesStage ?? "S5.guidance",
  };
  delete session.previousSalesPipeline;
  delete session.previousSalesStage;
  delete session.manualHandoffReason;
}

function negotiationReply(
  text: string,
  freeShippingApproved: boolean,
  selectedQuantity?: SupportedOrderQuantity,
): string {
  if (isBulkPurchaseBenefitQuestion(text)) {
    const quantity = detectQuantity(text);
    if (quantity && quantity >= 3) {
      return `Dạ combo ${quantity} lọ hiện là ${formatVnd(quote(quantity).total.amount)}, đã miễn phí giao và được tặng ${stopirexGiftForQuantity(quantity)} ạ. Mình muốn em giữ phương án này không ạ?`;
    }
  }
  if (/free\s*ship|freeship|mien phi (?:ship|giao)|bao ship|ho tro (?:ship|phi giao)/.test(text)) {
    const requestedDiscount = text.match(/giam\s*(\d{1,3})\s*%/)?.[1];
    const discountReply = requestedDiscount
      ? `Dạ hiện bên em chưa thể giảm ${requestedDiscount}% theo đề nghị của mình ạ. `
      : "";
    if (selectedQuantity && selectedQuantity >= 2) {
      return `${discountReply}Combo ${selectedQuantity} lọ giá ${formatVnd(quote(selectedQuantity).total.amount)}, đã miễn phí giao và được tặng ${stopirexGiftForQuantity(selectedQuantity)} ạ.\n\nMình tiếp tục đơn combo này nhé ạ?`;
    }
    if (freeShippingApproved) {
      return `${discountReply}Bên em đã duyệt miễn phí giao cho phương án 1 lọ lần này. Tổng thanh toán còn 285.000đ ạ.\n\nMình muốn em giữ đơn 1 lọ theo mức đã hỗ trợ không ạ?`;
    }
    return `${discountReply}Bên em đã duyệt miễn phí giao cho phương án 1 lọ lần này, tổng thanh toán còn 285.000đ ạ.\n\nMình muốn giữ phương án 1 lọ không ạ?`;
  }
  if (selectedQuantity === 1) {
    return "Dạ mức đang áp dụng là 285.000đ cho 1 lọ và 30.000đ phí giao; hiện bên em chưa thể giảm thêm ạ.\n\nNếu mình vẫn tiếp tục đơn 1 lọ, em xin lại thông tin người nhận để lên đơn cho mình nhé ạ?";
  }
  if (selectedQuantity && selectedQuantity >= 2) {
    return `Dạ combo ${selectedQuantity} lọ đang là ${formatVnd(quote(selectedQuantity).total.amount)}, đã miễn phí giao và được tặng ${stopirexGiftForQuantity(selectedQuantity)} ạ.\n\nNếu mình tiếp tục đơn này, em xin thông tin người nhận để lên đơn nhé ạ?`;
  }
  return "Dạ em hiểu mình muốn bên em hỗ trợ thêm về giá ạ. Lần này bên em duyệt miễn phí giao cho 1 lọ, tổng còn 285.000đ. Đơn từ 2 lọ trở lên được miễn phí giao và tặng 1 túi đa năng vải dệt Stopirex cho mỗi đơn ạ.\n\nMình muốn lấy mấy lọ ạ?";
}

function priceObjectionReply(session: DemoSession, customerText = ""): string {
  const single = quote(1);
  const money = (amount: number): string => `${amount.toLocaleString("vi-VN")}đ`;
  const value =
    "Stopirex là sản phẩm nhập khẩu từ Pháp, thuộc dòng ngăn tiết mồ hôi chuyên sâu; sau giai đoạn làm quen thường dùng giãn cách 2–3 ngày/lần tùy tình trạng.";

  if (session.selectedQuantity && session.selectedQuantity >= 2) {
    const selected = quote(session.selectedQuantity);
    const saving =
      session.selectedQuantity === 2
        ? `, tiết kiệm ${money(single.productPrice.amount * 2 - selected.productPrice.amount)} so với mua lẻ`
        : "";
    return `Dạ em hiểu băn khoăn của mình ạ. ${value}\n\nCombo ${session.selectedQuantity} lọ hiện là ${money(selected.total.amount)}, miễn phí giao${saving} và được tặng ${stopirexGiftForQuantity(session.selectedQuantity)}. Mình muốn giữ phương án đang chọn hay điều chỉnh số lượng ạ?`;
  }

  if (session.selectedQuantity === 1) {
    const shipping = `cộng ${money(single.shippingFee.amount)} phí giao`;
    return `Dạ em hiểu băn khoăn của mình ạ. ${value}\n\nPhương án 1 lọ hiện là ${money(single.productPrice.amount)}, ${shipping}. Mình muốn giữ 1 lọ hay xem phương án combo tiết kiệm hơn ạ?`;
  }

  if (isBottleLongevityQuestion(customerText) || isDetailedMechanismComparisonQuestion(customerText)) {
    return [
      "Dạ anh so sánh thời gian dùng như vậy là hợp lý ạ; điểm khác không nằm ở dung tích hay số tháng dùng.",
      "Lăn thông thường thiên về khử hoặc che mùi hằng ngày, còn Stopirex là dòng ngăn tiết mồ hôi chuyên sâu, dùng buổi tối để hỗ trợ vùng nách khô thoáng hơn vào hôm sau.",
      "Với loại anh đang dùng, giữa ngày nách có còn ướt áo không ạ?",
    ].join("\n\n");
  }

  return `Dạ em hiểu mình cân nhắc về giá ạ. ${value}\n\n1 lọ hiện là ${money(single.productPrice.amount)} + ${money(single.shippingFee.amount)} phí giao; combo 2 lọ ${money(quote(2).total.amount)}, miễn phí giao. Điều mình lăn tăn nhất là mức giá hay hiệu quả kiểm soát mồ hôi ạ?`;
}

function productEffectTopic(text: string, semanticSlots: ConsultationSlots): PrimarySymptom | undefined {
  const asksAboutEffect =
    /(?:co|lieu|dung).*(?:hieu qua|tac dung|khoi|het|do|giam|kiem soat)|(?:hieu qua|tac dung|khoi|het|do|giam).*(?:khong|ko|k)\b/.test(
      text,
    );
  if (!asksAboutEffect) return undefined;
  const sweat = /mo hoi|\buot\b|uot ao|o ao|tiet mo hoi/.test(text);
  const odor = /\bmui\b|hoi nach|mui co the/.test(text);
  if (sweat && odor) return "both";
  if (sweat) return "sweat";
  if (odor) return "odor";
  return semanticSlots.primarySymptom;
}

function isProductPurposeQuestion(value: string): boolean {
  const text = normalize(value);
  return /(?:dung|de) (?:lam gi|tac dung gi|cong dung gi)|(?:co )?(?:tac dung|cong dung) (?:la )?gi/.test(
    text,
  );
}

function isDetailedMechanismComparisonQuestion(value: string): boolean {
  const text = normalize(value);
  return isProductComparison(text) && /co che|hoat dong|tu goc|tai sao.*dat|ma dat|dat the/.test(text);
}

function productEffectReply(
  topic: PrimarySymptom,
  nextQuestion?: string,
  customerText = "",
  workContext?: ConsultationSlots["workContext"],
): string {
  if (isFragranceAndWetnessPreference(customerText)) {
    return "Dạ có ạ. Stopirex không dùng hương thơm để che mùi; khi mình lăn một lớp mỏng trên da khô, sản phẩm khô nhanh và không bết. Mình chờ khô rồi mặc áo, sáng dùng nước hoa sẽ không bị lẫn hương ạ.";
  }
  if (isApplicationFeelOrClothingConcern(customerText)) {
    return "Dạ lúc mới lăn da chỉ hơi ẩm nhẹ, sản phẩm khô nhanh và không bết ạ. Mình lăn một lớp mỏng trên da khô, chờ khô rồi mặc áo. Dùng đúng hướng dẫn, Stopirex không bám, không gây ố vàng nách áo hay làm cứng vải đâu anh/chị ơi.";
  }
  if (isSweatWashOffConcern(customerText)) {
    return "Dạ không ạ. Stopirex dùng từ buổi tối trên da sạch, khô nên không phải lớp lăn vừa bôi trước khi tập để mồ hôi làm trôi đi.\n\nChiều hôm sau mình vẫn có thể tập gym hoặc đá bóng bình thường ạ.";
  }
  if (isPermanentControlQuestion(customerText)) {
    if (/ti le|phan tram|tai phat|sau 1 nam/.test(customerText)) {
      return "Dạ Stopirex là dược mỹ phẩm dùng ngoài da, hỗ trợ ức chế và giảm lượng mồ hôi tiết ra; sản phẩm không can thiệp loại bỏ tuyến mồ hôi như phẫu thuật ạ. Vì cần dùng duy trì để kiểm soát mồ hôi nên khái niệm tỷ lệ tái phát sau 1 năm không áp dụng cho sản phẩm này.";
    }
    if (isEffectivenessJourneyQuestion(customerText)) {
      return "Dạ mình có thể bắt đầu cảm nhận nách khô thoáng hơn trong tuần đầu khi dùng đúng hướng dẫn ạ. Mốc đến 72 giờ là kết quả thử nghiệm cho mỗi lần dùng; giai đoạn đầu lăn buổi tối 2–3 lần/tuần, khi ổn định duy trì giãn cách 2–3 ngày/lần. Sản phẩm kiểm soát mồ hôi trong quá trình dùng, không phải chữa khỏi vĩnh viễn.";
    }
    return "Dạ không ạ. Stopirex hỗ trợ kiểm soát mồ hôi khi mình dùng đúng hướng dẫn, không phải thuốc chữa dứt điểm. Khi ngừng dùng, mồ hôi có thể ra lại ạ.";
  }
  const severeSweat =
    (topic === "sweat" || topic === "both") &&
    /mo hoi (?:rat )?nang|uot sung|uot dam|dam ca ao|uot ca ao/.test(customerText);
  if (severeSweat) {
    const answer =
      "Dạ Stopirex hỗ trợ kiểm soát tiết mồ hôi, giúp giảm nách ẩm và áo bị ướt ạ. Với mức mồ hôi nặng đến ướt sũng, mình dùng buổi tối khi da sạch, khô, lăn mỏng và theo dõi 2 tuần; nếu chưa cải thiện, nhắn bên em kiểm tra cách dùng nhé.";
    return nextQuestion ? `${answer}\n\n${nextQuestion}` : answer;
  }
  const restingSweatContext =
    workContext === "rest_or_stress" ||
    /phong lanh|dieu hoa|van phong|ngoi yen|ngoi mat|ngoi (?:khong|ko|k)(?: cung)?|it van dong|cang thang/.test(
      customerText,
    );
  if ((topic === "sweat" || topic === "both") && restingSweatContext) {
    const answer =
      "Dạ có ạ. Việc mình ngồi yên mà vùng nách vẫn ướt cho thấy lượng mồ hôi đang khá nhiều. Stopirex hỗ trợ kiểm soát tiết mồ hôi, giúp giảm tình trạng ẩm và ướt áo. Mình dùng buổi tối khi da sạch, khô, lăn mỏng và theo dõi trong 2 tuần đầu; nếu chưa cải thiện, nhắn bên em kiểm tra cách dùng ạ.";
    return nextQuestion ? `${answer}\n\n${nextQuestion}` : answer;
  }
  const benefit =
    topic === "odor"
      ? "hỗ trợ kiểm soát mùi cơ thể ở vùng nách"
      : topic === "sweat"
        ? "hỗ trợ kiểm soát tiết mồ hôi, từ đó giảm tình trạng ẩm, ướt hoặc ố áo"
        : "hỗ trợ kiểm soát cả mồ hôi và mùi cơ thể ở vùng nách";
  const answer = `Dạ có ạ. Stopirex ${benefit}. Mình dùng buổi tối khi da sạch, khô, lăn một lớp mỏng và theo dõi trong 2 tuần đầu; nếu chưa cải thiện, nhắn bên em kiểm tra cách dùng ạ.`;
  return nextQuestion ? `${answer}\n\n${nextQuestion}` : answer;
}

function productComparisonReply(priceAlreadySent: boolean, customerText = ""): string {
  if (isPriorOtherProductAdverseExperience(customerText)) {
    if (isNamedCompetitorChallenge(customerText)) {
      return "Dạ em hiểu mình lo vì trước đây từng bị rát hoặc ngứa ạ. Em không nhận xét về Etiaxil hay Perspirex; riêng mẫu Stopirex đã thử nghiệm có mức kích ứng da không đáng kể. Công thức có Aluminium Sesquichlorohydrate, Glycerin, Allantoin và Bisabolol; mình chỉ dùng khi da đã ổn, sạch, khô hoàn toàn và lăn một lớp mỏng ạ.";
    }
    if (isConditionalNoIrritationPurchase(customerText)) {
      return [
        "Dạ em hiểu chị lo vì loại trước gây ngứa/rát. Stopirex có công thức dịu nhẹ, phù hợp da nhạy cảm khi dùng đúng hướng dẫn nên mình có thể yên tâm hơn ạ.",
        "Dùng khi da lành, thật khô, lăn mỏng để hạn chế khó chịu. Theo dõi 2 tuần; nếu khó chịu thì ngưng và nhắn bên em. 1 lọ 285.000đ + 30.000đ giao; combo 2 lọ 510.000đ miễn phí giao. Chị vẫn chọn 1 lọ nhé?",
      ].join("\n\n");
    }
    if (/\bviem\b/.test(customerText)) {
      return "Dạ em hiểu mình lo vì loại trước từng gây viêm ở vùng nách ạ.\n\nStopirex có công thức dịu nhẹ, phù hợp da nhạy cảm; mẫu thử có mức kích ứng da không đáng kể. Nếu da hiện còn viêm thì mình chưa dùng, chờ da ổn hẳn rồi mới lăn một lớp mỏng trên da sạch, khô ạ.";
    }
    return "Dạ em hiểu mình lo vì trước đây từng bị ngứa và đỏ da ạ.\n\nStopirex có công thức dịu nhẹ, phù hợp da nhạy cảm; mẫu thử có mức kích ứng da không đáng kể. Mình chỉ dùng khi da đã ổn, sạch, khô hoàn toàn và lăn một lớp mỏng. Nếu thấy khó chịu, mình tạm ngưng và nhắn bên em kiểm tra ạ.";
  }
  if (isPriorSweatProcedureEffectQuestion(customerText)) {
    return "Dạ em hiểu mình đã từng cắt tuyến mồ hôi hoặc tiêm Botox nhưng tình trạng vẫn quay lại ạ. Stopirex hỗ trợ kiểm soát tiết mồ hôi theo cơ chế dùng ngoài da; riêng trường hợp đã can thiệp trước đó, em chuyển bộ phận liên quan kiểm tra kỹ rồi tư vấn đúng cho mình nhé.";
  }
  if (isDetailedMechanismComparisonQuestion(customerText)) {
    return "Dạ lăn khử mùi thông thường chủ yếu dùng hằng ngày để giảm hoặc che mùi bằng hương thơm. Stopirex là dòng ngăn tiết mồ hôi chuyên sâu: hoạt chất hỗ trợ kiểm soát lượng mồ hôi tại vùng bôi, nhờ đó vùng nách khô thoáng hơn và môi trường gây mùi cũng giảm đi. Mình dùng buổi tối 2–3 lần/tuần, không phải lăn tạo hương dùng nhiều lần trong ngày ạ.";
  }
  const nextQuestion = priceAlreadySent
    ? "Mình muốn xem cách dùng hay chọn 1 lọ/combo trước ạ?"
    : "Em gửi cách dùng hay giá ạ?";
  return [
    "Dạ điểm khác chính là cơ chế và tần suất dùng ạ.",
    "Lăn thông thường dùng hằng ngày để khử/che mùi. Stopirex ngăn tiết mồ hôi chuyên sâu, dùng buổi tối 2–3 ngày/lần và không dùng hương thơm để che mùi.",
    nextQuestion,
  ].join("\n\n");
}

export function isPriorSweatProcedureEffectQuestion(value: string): boolean {
  const text = normalize(value);
  const mentionsProcedure = /cat tuyen(?: mo hoi)?|tiem botox|dot tuyen|phau thuat.*mo hoi/.test(text);
  const asksCurrentEffect =
    /lai bi|bi lai|ra lai|co an thua|co (?:hieu qua|tac dung|do|giam)|dung duoc khong/.test(text);
  return mentionsProcedure && asksCurrentEffect;
}

export function isPermanentControlQuestion(value: string): boolean {
  const text = normalize(value);
  return /dut diem|chua (?:khoi|het)|khoi vinh vien|vinh vien.*(?:khong bao gio|bi lai|tuyen)|khong bao gio bi lai|ngan tam thoi|triet tieu.*vinh vien|ngung (?:boi|dung).*(?:mo hoi|ra lai)/.test(
    text,
  );
}

function isProductCompositionMythQuestion(value: string): boolean {
  const text = normalize(value);
  return /nap vang|noc ran|50\s*%.*muoi nhom|muoi nhom.*50\s*%|cong nghiep.*(?:teo|tay trang)|cong nghiep.*tuyen mo hoi|teo tuyen mo hoi.*vinh vien/.test(
    text,
  );
}

function isIndustrialAlcoholMythQuestion(value: string): boolean {
  const text = normalize(value);
  return /con cong nghiep|alcohol cong nghiep|teo tuyen mo hoi.*vinh vien|tay trang.*nong do/.test(text);
}

function isNamedCompetitorChallenge(value: string): boolean {
  return /\b(?:etiaxil|perspirex)\b/.test(normalize(value));
}

function isFragranceAndWetnessPreference(value: string): boolean {
  const text = normalize(value);
  const avoidsFragrance =
    /khong.*(?:mui huong|huong hoa|hoa hoe)|(?:mui huong|huong hoa|hoa hoe).*khong/.test(text);
  const avoidsWetness = /khong.*(?:uot nhep|bet dinh|uot.*ao)|(?:uot nhep|bet dinh|uot.*ao).*khong/.test(
    text,
  );
  return avoidsFragrance && avoidsWetness;
}

export function isInternationalShippingQuestion(value: string): boolean {
  const text = normalize(value);
  return /(?:gui|giao|ship).*(?:nhat ban|nuoc ngoai|quoc te)|(?:nhat ban|nuoc ngoai|quoc te).*(?:phi|ship|giao|gui)/.test(
    text,
  );
}

function isMaliciousCommercialOverride(value: string): boolean {
  const text = normalize(value);
  return /(?:cap nhat|doi|thay).*(?:he thong|gia)|(?:gia vip|khach hang vip)|(?:len don|tao don).*(?:50k|gia vip)/.test(
    text,
  );
}

function isShelfLifeQuestion(value: string): boolean {
  const text = normalize(value);
  return /han su dung|\bhsd\b|sau khi mo nap|mo nap.*(?:may thang|bao lau)|dung lai rai.*3 nam/.test(text);
}

function isCurrentCatalogSoapQuestion(value: string): boolean {
  const text = normalize(value);
  return /(?:ban|co) (?:kem )?xa phong.*(?:tham|nach)|xa phong tri tham/.test(text);
}

export function isWholesaleDealerInquiry(value: string): boolean {
  const text = normalize(value);
  if (isExplicitWholesaleCancellation(text)) return false;
  return /nhap si|dai ly|nha thuoc|tiem thuoc|cua hang.*ban lai|\b(?:[6-9]|\d{2,})\s*lo\b/.test(text);
}

function wholesaleDealerHandoffReply(value: string, quantity?: number): string {
  const text = normalize(value);
  const topics: string[] = [];
  if (/chiet khau|gia si|gia dai ly/.test(text)) topics.push("chiết khấu");
  if (/\bvat\b|hoa don(?: do| dien tu| cong ty)?/.test(text)) topics.push("xuất hóa đơn VAT");
  if (/tu ke|banner|vat pham|trung bay/.test(text)) topics.push("tủ kệ/file banner");
  if (topics.length === 0) topics.push("chính sách sỉ");
  const need = topics.length === 1 ? topics[0] : `${topics.slice(0, -1).join(", ")} và ${topics.at(-1)}`;
  const demand = quantity ? `nhu cầu nhập ${quantity} lọ cho tiệm` : "nhu cầu nhập hàng cho tiệm thuốc";
  return `Dạ em ghi nhận ${demand} ạ. Phần ${need} cần xác nhận riêng; em chuyển bộ phận liên quan hỗ trợ trực tiếp cho mình.`;
}

function isExplicitWholesaleCancellation(text: string): boolean {
  return /(?:chua|khong|thoi|khoan|tu tu).{0,25}(?:nhap si|lay si|don si)|(?:nhap si|don si).{0,25}(?:chua|khong|thoi|de sau)/.test(
    text,
  );
}

function containsWeatherQuestion(value: string): boolean {
  const text = normalize(value);
  return /\b(?:thoi tiet|du bao|nhiet do|co mua|mua khong)\b/.test(text);
}

function isRetailEscapeFromWholesaleHandoff(
  session: DemoSession,
  text: string,
  raw: string,
  requestedQuantity: number | undefined,
): requestedQuantity is SupportedOrderQuantity {
  const wholesaleHandoff = ["bulk_quantity_over_5", "wholesale_or_dealer_request"].includes(
    session.manualHandoffReason ?? "",
  );
  if (!wholesaleHandoff || !isExplicitWholesaleCancellation(text)) return false;
  const retailQuantity = requestedQuantity !== undefined && requestedQuantity >= 1 && requestedQuantity <= 5;
  const strongOrderEntity = /(?<!\d)0\d{9}(?!\d)/u.test(raw) || looksLikeAddress(raw);
  return retailQuantity && strongOrderEntity;
}

function isAlcoholAndScentPremiseQuestion(value: string): boolean {
  const text = normalize(value);
  const asksAlcohol =
    /(?:100\s*%|hoan toan)?.{0,20}khong con|khong con.{0,20}(?:100\s*%|hoan toan)|co con khong/.test(text);
  const asksScent =
    /(?:hoan toan|100\s*%)?.{0,20}khong mui|khong mui.{0,30}(?:nuoc hoa|lan mui|lon mui)|(?:nuoc hoa|mui).{0,40}(?:lon mui|lan mui)/.test(
      text,
    );
  return asksAlcohol && asksScent;
}

function isAlcoholAndPermanentPremiseQuestion(value: string): boolean {
  const text = normalize(value);
  const mentionsAlcohol = /\b(?:con|alcohol)\b/.test(text);
  return mentionsAlcohol && isPermanentControlQuestion(text);
}

function alcoholAndPermanentReply(): string {
  return "Dạ thông tin chính xác là Stopirex có chứa cồn (Alcohol) làm dung môi trong ngưỡng an toàn của công thức. Sản phẩm hỗ trợ kiểm soát mồ hôi và cần dùng duy trì, không phải thuốc chữa khỏi vĩnh viễn ạ. Nếu mình cần kiểm tra lại nội dung tư vấn trước đó, em chuyển bộ phận liên quan hỗ trợ ạ.";
}

function isHairRemovalMorningClothingQuestion(value: string): boolean {
  const text = normalize(value);
  const recentRemoval = /(?:vua|moi|sang nay).{0,30}(?:nho|cao|wax|triet).{0,20}(?:long )?nach/.test(text);
  const wantsImmediateUse =
    /(?:quet|boi|lan|dung).{0,20}(?:luon|sang|sang nay)|(?:sang|sang nay).{0,30}(?:quet|boi|lan|dung)/.test(
      text,
    );
  const clothing = /o vang|ao so mi|vang nach ao|bet.*ao/.test(text);
  return recentRemoval && wantsImmediateUse && clothing;
}

function isMorningApplicationQuestion(value: string): boolean {
  const text = normalize(value);
  return (
    /\b(?:sang|buoi sang|sang day|sang ngu day|sang duoc|sang dc|luc sang)\b/.test(text) &&
    (/\b(?:boi|lan|quet)\b/.test(text) ||
      /\bdung (?:stopirex|san pham|loai nay|cai nay)\b/.test(text) ||
      /\bdung (?:vao )?(?:buoi )?sang\b/.test(text)) &&
    !/\b(?:nuoc hoa|lan khu mui|romano)\b/.test(text) &&
    !/\b(?:boi|lan|quet|dung)(?: xong)?\b.{0,60}\b(?:sang|buoi sang|sang hom sau)\b.{0,60}\b(?:tam|rua|xa phong|soap)\b/.test(
      text,
    ) &&
    !(
      /\b(?:tam|rua|xa phong|soap)\b/.test(text) &&
      /\b(?:toi hom truoc|buoi toi|dem truoc)\b/.test(text)
    )
  );
}

function isHairRemovalSafetyQuestion(value: string): boolean {
  const text = normalize(value);
  const recentRemoval = /(?:vua|moi|sang nay)?.{0,20}(?:nho|cao|wax|triet).{0,20}(?:long )?nach/.test(text);
  const immediateUse =
    /(?:boi|lan|quet|dung).{0,25}(?:luon|ngay)|(?:luon|ngay).{0,25}(?:boi|lan|quet|dung)/.test(text);
  return recentRemoval && immediateUse;
}

export function isActualIrritationMessage(value: string): boolean {
  const text = normalize(value);
  const issue = detectCareIssue(text);
  return issue === "irritation" && detectCareScenario(text, issue) === "actual";
}

function returnsPolicyReply(text: string): string {
  if (isHypotheticalIrritationRefundQuestion(text)) {
    return "Dạ có ạ. Stopirex có chính sách bảo hành và hỗ trợ hoàn tiền nếu sản phẩm không đạt hiệu quả sau khi mình dùng đúng hướng dẫn đủ 2 tuần. Hồ sơ gồm thông tin đơn hàng, thông tin tài khoản và clip nhúng hủy sản phẩm; mình không cần gửi lại sản phẩm. Nếu bôi thấy xót hoặc rát kéo dài, mình ngưng dùng và nhắn bên em kiểm tra ngay ạ.";
  }
  if (isUsedIneffectiveRefundQuestion(text)) {
    if (isHypotheticalIneffectiveRefundQuestion(text)) {
      return "Dạ nếu mình dùng đúng hướng dẫn đủ 2 tuần mà vẫn chưa hiệu quả, bên em hỗ trợ hoàn tiền ạ. Khi đó hồ sơ gồm số tài khoản, tên ngân hàng, tên người thụ hưởng và clip nhúng hủy sản phẩm xuống nước; mình không cần giữ vỏ hộp hay gửi sản phẩm về.";
    }
    return "Dạ nếu mình đã dùng đúng hướng dẫn đủ 2 tuần mà vẫn chưa hiệu quả, bên em hỗ trợ hoàn tiền ạ. Mình gửi số tài khoản, tên ngân hàng, tên người thụ hưởng và clip nhúng hủy sản phẩm xuống nước. Trường hợp này mình không cần giữ vỏ hộp hay gửi sản phẩm về; đủ hồ sơ em chuyển bộ phận liên quan xử lý tiếp ạ.";
  }
  return [
    "Dạ shop đổi trả nếu hàng còn nguyên seal và lỗi nhà sản xuất trong 7 ngày hoặc giao sai. Hàng bể vỡ do vận chuyển cần báo trong 48 giờ và có video mở hộp.",
    "Không áp dụng với hàng đã mở/dùng, không hợp mùi hoặc do khách làm hỏng. Sau khi nhận hàng trả, shop đổi mới hoặc hoàn tiền trong 3–5 ngày làm việc ạ.",
  ].join("\n\n");
}

function isHypotheticalIneffectiveRefundQuestion(value: string): boolean {
  const text = normalize(value);
  return (
    /\b(?:neu|nho|lo ma|gia su)\b.{0,100}\b(?:khong|ko|k)\s*(?:do|khoi|het|hieu qua|cai thien)\b/.test(
      text,
    ) && /\b(?:hoan tien|hoan xeng|tra tien|doi tra)\b/.test(text)
  );
}

function isHypotheticalIrritationRefundQuestion(value: string): boolean {
  const text = normalize(value);
  const hypotheticalIrritation =
    /neu|minh boi|lo ma|gia su/.test(text) && /xot|rat|ngua|kich ung|do da/.test(text);
  const otherPersonExperience =
    /ban|minh nghe|nguoi khac|chi gai|anh trai/.test(text) && /xot|rat|ngua|kich ung|do da/.test(text);
  return (hypotheticalIrritation || otherPersonExperience) && /hoan tien|tra hang|doi tra/.test(text);
}

function isUsedIneffectiveRefundQuestion(value: string): boolean {
  const text = normalize(value);
  return (
    /da dung dung|dung (?:khong|k) do|(?:khong|k) hieu qua|chua hieu qua|(?:khong|k) (?:do|khoi|het)|khong cai thien|(?:nhỡ|nho|neu).{0,50}(?:(?:khong|k) (?:do|khoi)|khong hieu qua)|(?:sau|du)\s*2\s*tuan.{0,45}(?:van uot|van ra mo hoi|khong kho|khong cai thien)/.test(
      text,
    ) && /hoan tien|hoan xeng|tra tien|gui tra|tra hang|doi tra/.test(text)
  );
}

function isRefundPolicyFollowup(session: DemoSession, text: string): boolean {
  if (isReturnsPolicyQuestion(text)) return false;
  const contextActive =
    session.pendingPolicyContext === "refund_used_ineffective" ||
    session.history
      .filter((turn) => turn.role === "user")
      .slice(-2)
      .some((turn) => isUsedIneffectiveRefundQuestion(turn.text));
  return (
    contextActive &&
    /\b(?:luc day|truong hop day|nhung|the).{0,45}(?:vo hop|hop giay|boc rach|vut|mat vo|khong con vo)\b|\b(?:vo hop|hop giay).{0,30}(?:vut|rach|mat|khong con)\b/.test(
      text,
    )
  );
}

function refundFollowupReply(text: string): string {
  if (/vo hop|hop giay|boc rach|vut|mat vo|khong con vo/.test(text)) {
    return "Dạ trường hợp hoàn tiền do đã dùng đúng hướng dẫn đủ 2 tuần mà chưa hiệu quả thì mình không cần giữ vỏ hộp hay gửi sản phẩm về ạ. Mình chuẩn bị thông tin tài khoản và clip nhúng hủy sản phẩm, bên em chuyển bộ phận liên quan xử lý tiếp nhé.";
  }
  return returnsPolicyReply("dung khong do hoan tien");
}

export function isMissedEveningApplicationQuestion(value: string): boolean {
  const text = normalize(value);
  const missedNight =
    /(?:quen|lo|bo).*(?:boi|lan|dung).*(?:buoi )?toi|xin qua.*(?:quen|lo).*(?:buoi )?toi/.test(text);
  const asksMorning =
    /(?:sang|sang day|buoi sang).*(?:boi|lan|quet|dung)|(?:boi bu|lan bu|quet).*(?:sang|buoi sang)/.test(
      text,
    );
  return missedNight && asksMorning;
}

function missedEveningApplicationReply(): string {
  return "Dạ nếu quên một tối thì mình không cần bôi bù vào buổi sáng ạ. Stopirex nên dùng buổi tối trên da sạch, khô hoàn toàn để hoạt chất có thời gian phát huy khi tuyến mồ hôi hoạt động ít hơn. Bôi buổi sáng thường kém hiệu quả hơn; mình tiếp tục vào tối hôm sau nhé.";
}

function nextProductEffectQuestion(asked: readonly string[], priceAlreadySent: boolean): string | undefined {
  const first = priceAlreadySent
    ? "Mình muốn em hướng dẫn cách dùng phù hợp trước, hay mình chọn luôn 1 lọ trải nghiệm hoặc combo 2 lọ ạ?"
    : "Mình muốn em hướng dẫn cách dùng trước hay gửi bảng giá để tham khảo ạ?";
  if (!asked.includes(first)) return first;
  const second = "Mình muốn em hướng dẫn cách dùng phù hợp để hỗ trợ cả mồ hôi và mùi luôn không ạ?";
  if (!asked.includes(second)) return second;
  return undefined;
}

type GroundedReply = {
  reply: string;
  knowledgeEntityIds: string[];
};

function priceChangeReply(raw: string, semantic: SemanticUnderstanding): GroundedReply {
  const mentioned = [...raw.matchAll(/(\d{2,3})\s*k/gi)].map((match) => Number(match[1]) * 1_000);
  const text = normalize(raw);
  const explicitlyHistorical =
    (semantic.priceFromVnd !== undefined && semantic.priceToVnd !== undefined) ||
    mentioned.length >= 2 ||
    /gia cu|tu\s+\d{2,3}\s*k?.*(?:len|thanh|sang)\s+\d{2,3}\s*k?|(?:vi sao|tai sao|sao).*(?:tang|len|dieu chinh).*gia|gia.*(?:tang|len|dieu chinh).*(?:vi sao|tai sao)/.test(
      text,
    );
  if (!explicitlyHistorical) {
    const entity = demoKnowledge.find((candidate) => candidate.id === "pricing-approved-options-2026-08");
    return {
      reply:
        "Dạ giá hiện tại chưa có thay đổi mới ạ: 1 lọ Stopirex 285.000đ + 30.000đ phí giao; combo 2 lọ 510.000đ và combo 3 lọ 750.000đ, đều miễn phí giao.",
      knowledgeEntityIds: entity ? [entity.id] : [],
    };
  }
  const from = semantic.priceFromVnd ?? mentioned[0];
  const to = semantic.priceToVnd ?? mentioned[1] ?? 285_000;
  const comparison = from
    ? `giá từ ${formatVnd(from)} lên ${formatVnd(to)}`
    : `mức giá ${formatVnd(to)} hiện tại`;
  const entity = retrieveKnowledge({
    tenantId: demoTenant,
    query: "lý do điều chỉnh tăng giá nhập khẩu Pháp",
    entities: demoKnowledge,
    limit: 1,
  })[0];
  const reason = entity?.content ?? "Bên em đã điều chỉnh giá bán để phù hợp với chi phí đầu vào.";
  return {
    reply: `Dạ em hiểu mình đang thắc mắc về chênh lệch ${comparison} ạ. ${reason}\n\nEm gửi chương trình đang áp dụng để mình tham khảo nhé ạ?`,
    knowledgeEntityIds: entity ? [entity.id] : [],
  };
}

type AudienceSafetyContext = {
  confirmedChildAge?: number;
};

function audienceSafetyReply(
  text: string,
  semantic: SemanticUnderstanding,
  context: AudienceSafetyContext = {},
): GroundedReply {
  const asksBreastfeeding =
    semantic.topic === "breastfeeding" || /cho con bu|dang cho bu|me sua|me bim sua/.test(text);
  const asksPregnancy =
    semantic.topic === "pregnancy" ||
    /me bau|ba bau|pa pau|ba pau|dang bau|phu nu bau|mang thai|bau bi|co bau/.test(text);
  const currentMessageMentionsChild =
    /\b(?:tre|te)\s*(?:em|e|nho)?\b|\bbe(?: trai| gai| nha|minh|\s*\d+\s*tuoi)?\b|\bcon (?:trai|gai)\b/.test(
      text,
    );
  const asksChild =
    !asksBreastfeeding &&
    !asksPregnancy &&
    (semantic.topic === "child_age" ||
      semantic.subject === "child" ||
      /\b(?:tre|te)\s*(?:em|e|nho)?\b|\bbe\b|duoi 12|12 tuoi/.test(text));
  const asksSensitiveSkin =
    semantic.topic === "sensitive_skin" ||
    /da (?:minh )?mong|da nhay cam|nhay cam|da yeu|de kich ung/.test(text);
  const asksHypotheticalIrritation =
    (semantic.topic === "irritation" && semantic.scenario === "hypothetical") ||
    isHypotheticalIrritationQuestion(text);
  const asksDarkening = /tham nach|sam nach|den nach|kho tham/.test(text);
  const asksGeneralAudience = /nhung doi tuong|doi tuong nao|ai (?:co the )?(?:dung|su dung) duoc/.test(text);
  const mentionedAge = semantic.age ?? extractAgeMention(text) ?? context.confirmedChildAge;
  const answers: GroundedReply[] = [];

  if (
    context.confirmedChildAge !== undefined &&
    !currentMessageMentionsChild &&
    !asksPregnancy &&
    !asksBreastfeeding &&
    !asksGeneralAudience
  ) {
    return confirmedChildSafetyReply(context.confirmedChildAge);
  }

  if (asksChild) {
    if (mentionedAge === undefined) {
      answers.push({
        reply:
          "Dạ Stopirex không dùng cho bé dưới 12 tuổi ạ.\n\nMình cho em biết bé bao nhiêu tuổi để em kiểm tra đúng hướng dẫn nhé ạ?",
        knowledgeEntityIds: ["audience-child-under-12"],
      });
    } else if (mentionedAge < 12) {
      answers.push({
        reply: `Dạ bé ${mentionedAge} tuổi chưa dùng được Stopirex ạ, vì sản phẩm không dùng cho trẻ dưới 12 tuổi.`,
        knowledgeEntityIds: ["audience-child-under-12"],
      });
    } else {
      answers.push({
        reply: `Dạ bé ${mentionedAge} tuổi dùng được rồi ạ 😊\n\nNếu mình cần, em gửi thêm cách dùng phù hợp để bé sử dụng đúng ngay từ đầu nhé ạ.`,
        knowledgeEntityIds: ["audience-child-12-plus"],
      });
    }
  }
  if (asksPregnancy) {
    answers.push({
      reply: knowledgeContent(
        "audience-pregnancy",
        "Dạ phụ nữ đang mang thai nên tham khảo ý kiến bác sĩ trước khi sử dụng Stopirex ạ.",
      ),
      knowledgeEntityIds: ["audience-pregnancy"],
    });
  }
  if (asksBreastfeeding) {
    answers.push({
      reply: knowledgeContent(
        "audience-breastfeeding",
        "Dạ phụ nữ đang cho con bú nên tham khảo ý kiến bác sĩ trước khi sử dụng Stopirex ạ.",
      ),
      knowledgeEntityIds: ["audience-breastfeeding"],
    });
  }
  if (asksSensitiveSkin && asksHypotheticalIrritation) {
    answers.push({
      reply: asksDarkening
        ? "Dạ Stopirex có công thức dịu nhẹ, phù hợp da nhạy cảm; da mỏng vẫn có thể dùng khi da đang lành và dùng đúng hướng dẫn nên mình có thể yên tâm hơn ạ. Mình lăn một lớp mỏng buổi tối trên da sạch, khô; nếu thấy khó chịu hoặc đổi màu thì tạm ngưng và nhắn em kiểm tra nhé."
        : "Dạ Stopirex có công thức dịu nhẹ, phù hợp da nhạy cảm; da mỏng vẫn có thể dùng khi da đang lành và dùng đúng hướng dẫn nên mình có thể yên tâm hơn ạ. Mình lăn một lớp mỏng buổi tối trên da sạch, khô; nếu thấy rát, ngứa hoặc đỏ thì tạm ngưng và nhắn em kiểm tra nhé.",
      knowledgeEntityIds: ["audience-sensitive-skin", "safety-irritation-hypothetical"],
    });
  } else if (asksSensitiveSkin) {
    answers.push({
      reply: knowledgeContent(
        "audience-sensitive-skin",
        "Dạ với da mỏng hoặc nhạy cảm, mình vẫn có thể dùng Stopirex khi da đang lành và sử dụng đúng hướng dẫn ạ. Sản phẩm có công thức dịu nhẹ, phù hợp với làn da nhạy cảm.",
      ),
      knowledgeEntityIds: ["audience-sensitive-skin"],
    });
  }
  if (asksHypotheticalIrritation && !asksSensitiveSkin) {
    answers.push({
      reply: asksDarkening
        ? "Dạ Stopirex có công thức dịu nhẹ, phù hợp với da nhạy cảm khi dùng đúng hướng dẫn nên mình có thể yên tâm hơn ạ. Mình lăn một lớp mỏng vào buổi tối khi da sạch, khô; không dùng trên da đang trầy, rát hoặc ngứa và chờ ít nhất 24 giờ sau cạo hoặc wax. Nếu da khó chịu hay đổi màu, mình tạm ngưng và nhắn bên em kiểm tra nhé ạ."
        : "Dạ nếu sau khi lăn mà vùng da xuất hiện rát, ngứa hoặc đỏ, mình nên tạm ngưng sử dụng và không lăn lại khi da còn khó chịu. Mình nhắn lại bên em để kiểm tra tình trạng cụ thể trước khi dùng tiếp nhé ạ.",
      knowledgeEntityIds: ["safety-irritation-hypothetical"],
    });
  }

  if (answers.length > 0) {
    return {
      reply: answers.map((item) => item.reply).join("\n\n"),
      knowledgeEntityIds: [...new Set(answers.flatMap((item) => item.knowledgeEntityIds))],
    };
  }
  if (asksGeneralAudience) {
    return {
      reply:
        "Dạ Stopirex có công thức dịu nhẹ, phù hợp với cả làn da nhạy cảm khi sử dụng đúng hướng dẫn ạ.\n\nSản phẩm không dùng cho trẻ em dưới 12 tuổi.\n\nPhụ nữ đang mang thai hoặc cho con bú nên tham khảo ý kiến bác sĩ trước khi sử dụng ạ.",
      knowledgeEntityIds: [
        "audience-sensitive-skin",
        "audience-child-under-12",
        "audience-pregnancy",
        "audience-breastfeeding",
      ],
    };
  }
  return {
    reply: "Dạ mình đang hỏi cho bé, phụ nữ mang thai/cho con bú hay người có da nhạy cảm ạ?",
    knowledgeEntityIds: [],
  };
}

function confirmedChildSafetyReply(age: number): GroundedReply {
  if (age < 12) {
    return {
      reply: `Dạ bé ${age} tuổi chưa dùng được Stopirex ạ, vì sản phẩm không dùng cho trẻ dưới 12 tuổi.`,
      knowledgeEntityIds: ["audience-child-under-12"],
    };
  }
  return {
    reply: `Dạ với bé ${age} tuổi, Stopirex có thể dùng theo đúng hướng dẫn ạ. Mẫu thử có mức kích ứng da “không đáng kể” theo ISO 10993-23:2021, nhưng đây không phải bảo đảm không kích ứng với mọi làn da.\n\nChỉ dùng khi da lành, sạch và khô hoàn toàn; nếu vùng nách đang đỏ, rát hoặc trầy thì chờ da ổn hẳn mới dùng ạ.`,
    knowledgeEntityIds: [
      "audience-child-12-plus",
      "product-composition-tolerance-approved",
      "lab-test-2025-skin-irritation",
    ],
  };
}

function confirmedChildAgeFromSession(session: DemoSession): number | undefined {
  const age = session.customerProfile.age;
  if (age === undefined) return undefined;
  const recentCustomerText = normalize(
    session.history
      .filter((turn) => turn.role === "user")
      .slice(-6)
      .map((turn) => turn.text)
      .join(" "),
  );
  const mentionsChild =
    /\b(?:tre|te)\s*(?:em|e|nho)?\b|\bbe(?: trai| gai| nha|minh|\s*\d+\s*tuoi)?\b|\bcon (?:trai|gai)\b/.test(
      recentCustomerText,
    );
  return mentionsChild ? age : undefined;
}

function knowledgeContent(id: string, fallback: string): string {
  return demoKnowledge.find((entity) => entity.id === id)?.content ?? fallback;
}

function childUsageGuidanceReply(): string {
  return [
    "Dạ bé dùng Stopirex vào buổi tối, khi da sạch và khô hoàn toàn ạ.",
    "Lăn một lớp mỏng, dùng 2–3 lần/tuần. Sau cạo hoặc wax cần chờ ít nhất 24 giờ.",
    "Không dùng khi da trầy, rát hoặc ngứa; nếu khó chịu thì tạm ngưng và nhắn bên em nhé ạ.",
  ].join("\n\n");
}

function generalUsageGuidanceReply(): string {
  return [
    "Dạ mình dùng Stopirex vào buổi tối, khi da sạch và khô hoàn toàn ạ.",
    "Lăn một lớp mỏng, dùng 2–3 lần/tuần. Sau cạo hoặc wax cần chờ ít nhất 24 giờ.",
    "Không dùng khi da trầy, rát hoặc ngứa; nếu khó chịu thì tạm ngưng và nhắn bên em nhé ạ.",
  ].join("\n\n");
}

function morningFragranceLayeringReply(): string {
  return [
    "Dạ Stopirex có cồn (Alcohol) làm dung môi và có mùi đặc trưng nhẹ, nhưng mùi bay nhanh ạ.",
    "Mình dùng từ buổi tối nên sáng vùng nách đã khô ráo; dùng nước hoa bình thường và không bị lẫn mùi nhé.",
  ].join("\n\n");
}

function bottleLongevityReply(customerText = ""): string {
  const catalogNote = /size|kich thuoc|lo be|lo nho|lo to/.test(normalize(customerText))
    ? "danh mục hiện tại chỉ có một quy cách chai Stopirex 30 ml. "
    : "";
  return catalogNote
    ? `Dạ ${catalogNote}Một lọ thường dùng khoảng 3–4 tháng khi mình lăn mỏng 2–3 lần/tuần ạ.`
    : "Dạ một lọ thường dùng khoảng 3–4 tháng khi mình lăn mỏng 2–3 lần/tuần ạ.";
}

function usageDurationAndFrequencyReply(customerText = ""): string {
  const normalized = normalize(customerText);
  const alsoAsksDailyUse = /ngay nao cung|hang ngay|moi ngay|boi hang ngay|dung hang ngay/.test(normalized);
  if (isEffectivenessJourneyQuestion(customerText) && !alsoAsksDailyUse) {
    return "Dạ thường mình bắt đầu cảm nhận vùng nách khô thoáng hơn trong tuần đầu ạ. Mình theo dõi đủ 1–2 tuần khi dùng đúng hướng dẫn để đánh giá rõ hơn nhé.";
  }
  return "Dạ mình không cần bôi hằng ngày ạ. Dùng buổi tối khi da sạch, khô hoàn toàn; lăn mỏng 2–3 lần/tuần.\n\nMình theo dõi mức ướt áo trong 2 tuần đầu; nếu chưa cải thiện, nhắn bên em kiểm tra lại cách dùng nhé ạ.";
}

function isEffectivenessJourneyQuestion(value: string): boolean {
  const text = normalize(value);
  return (
    /\b(?:bao lau|tuan dau|khi nao|may ngay)\b.*\b(?:kho|hieu qua|tac dung|do|giam)\b/.test(text) ||
    (/\b(?:khoi|vinh vien|khong bao gio bi lai)\b/.test(text) && /\b(?:bao lau|1 lo|mot lo)\b/.test(text))
  );
}

function isKnowledgeFullyCoveredQuestion(text: string, semantic: SemanticUnderstanding): boolean {
  if (isUsedIneffectiveRefundQuestion(text)) return true;
  if (isNamedCompetitorPriceObjection(text) || isDeliveryInspectionQuestion(text)) return true;
  if (isPermanentControlQuestion(text) && /tai phat|sau 1 nam|bao nhieu phan tram|ty le|ti le/.test(text)) {
    return true;
  }
  if (isMissedEveningApplicationQuestion(text)) return true;
  const cited = new Set(semantic.knowledgeIds ?? []);
  if (cited.size === 0) return false;
  if (isPriceAndShippingPolicyQuestion(text)) {
    return cited.has("pricing-approved-options-2026-08");
  }
  if (isDomesticDeliveryInspectionQuestion(text)) {
    return cited.has("domestic-delivery-inspection-policy");
  }
  if (/\b(?:be|tre)\b.*\b(?:1[2-9]|[2-9]\d)\s+tuoi\b/.test(text)) {
    return cited.has("audience-child-12-plus");
  }
  if (/\b(?:cho con bu|dang cho bu|me bim sua|me sua)\b/.test(text)) {
    return cited.has("audience-breastfeeding");
  }
  if (semantic.topic === "pregnancy") {
    return cited.has("audience-pregnancy");
  }
  if (/\b(?:da nhay cam|nhay cam)\b/.test(text)) {
    return cited.has("audience-sensitive-skin") || cited.has("lab-test-2025-skin-irritation");
  }
  return false;
}

function isAffirmativeFollowup(text: string): boolean {
  return /^(?:da )?(?:ok|okay|oke|duoc|dc|co|gui (?:(?:cho )?(?:minh|em|chi|anh|c|a)|di)|huong dan (?:di|minh|em)|vang|uh|u)(?: a| nhe)?$/.test(
    text,
  );
}

function authenticityLegalSummaryReply(): string {
  return "Dạ, thông tin pháp lý tóm tắt của Stopirex: Phiếu công bố sản phẩm mỹ phẩm số 181339/22/CBMP-QLD, tiếp nhận ngày 12/09/2022 và có giá trị 5 năm kể từ ngày cấp. Hồ sơ ghi sản phẩm được sản xuất, đóng gói và xuất khẩu từ Pháp bởi PREVOST LABORATORY CONCEPT. Sản phẩm có Phiếu kết quả thử nghiệm VNTEST mã DV142210268/01 ngày 17/09/2025 ạ.";
}

function formatVnd(amount: number): string {
  return `${new Intl.NumberFormat("vi-VN").format(amount)}đ`;
}

function signalForIssue(issue: IssueType): SignalTag {
  if (issue === "irritation") return "CT.An toàn";
  if (issue === "ineffective") return "CT.Hiệu quả";
  if (issue === "missing_or_damaged") return "SC.Hàng hỏng";
  if (issue === "delivery") return "SC.Giao hàng";
  if (issue === "counterfeit") return "SC.Hàng giả";
  if (issue === "complaint") return "SC.Khiếu nại";
  return "SC.Đánh giá";
}

function salesBreakpoint(session: DemoSession): string {
  if (session.pipeline === "0.Chưa tư vấn") return "Chưa tiếp nhận";
  if (session.pipeline === "1.Phân loại") return "Chưa rõ ý định khách";
  if (session.pipeline === "2.Đang tư vấn") {
    return session.consultation.stage === "S5.guidance" ? "Đang hướng dẫn sử dụng" : "Đang khai thác nhu cầu";
  }
  if (session.pipeline === "3.Đã báo giá") return "Chờ phản hồi sau giá";
  if (session.pipeline === "4.XL băn khoăn") return session.signal ?? "Chưa rõ băn khoăn";
  if (session.pipeline === "5.Chờ TT KH")
    return missingOrderFields(session.order).join(", ") || "Chờ xác nhận";
  if (session.pipeline === "7.Chờ followup") return session.signal ?? "Chờ follow-up 3/6/9h";
  if (session.pipeline === "N.Nuôi dưỡng") return "Hết vòng follow-up/chưa mua";
  if (session.pipeline === "R.Đã rớt") return session.signal ?? "Từ chối/không phù hợp";
  return "Đã hoàn tất";
}

export function isPriceConcern(text: string): boolean {
  return /dat qua|(?:hoi )?mac(?: (?:the|nhe|nhi|qua))?|gia (?:hoi |qua )?cao|phi ship cao|tong tien cao|khong du tien|(?:ben|cho|shop) khac.*(?:re hon|gia re)|(?:re hon|gia re).*(?:ben|cho|shop) khac/.test(
    text,
  );
}

function isNamedCompetitorPriceObjection(value: string): boolean {
  const text = normalize(value);
  const namesKnownCompetitor = /\b(?:etiaxil|perspirex)\b/.test(text);
  const comparesPrice =
    isPriceConcern(text) ||
    /\b(?:gia|tien)\b.{0,30}\b(?:etiaxil|perspirex)\b|\b(?:etiaxil|perspirex)\b.{0,45}\b(?:gia|tien|\d+\s*k)\b/.test(
      text,
    );
  return namesKnownCompetitor && comparesPrice;
}

/**
 * Phần đầu chỉ xác nhận đã xem giá; câu hỏi thật nằm sau “nhưng/tuy nhiên”.
 * Ví dụ: “Mình nhận được giá rồi, nhưng mồ hôi nặng thì dùng có đỡ không?”.
 */
export function isPriceAcknowledgementWithEffectQuestion(value: string): boolean {
  const text = normalize(value);
  const contrast = text.match(/\b(?:nhung|tuy nhien)\b/);
  if (contrast?.index === undefined) return false;
  const before = text.slice(0, contrast.index);
  const after = text.slice(contrast.index + contrast[0].length);
  const acknowledgedPrice =
    /\b(?:da )?nhan duoc\b.*\b(?:gia|uu dai)\b|\b(?:da )?(?:xem|biet) (?:bao )?gia\b|\b(?:gia|uu dai)\b.*\b(?:roi|r)\b/.test(
      before,
    );
  return acknowledgedPrice && Boolean(productEffectTopic(after, {}));
}

/** Nhận câu hỏi về bao lâu có tác dụng hoặc có phải dùng mỗi ngày hay không. */
export function isUsageDurationOrFrequencyQuestion(value: string): boolean {
  const text = normalize(value);
  const asksDuration =
    /\b(?:boi|lan|dung|su dung) bao lau\b.*\b(?:kho|kho thoang|do|giam|hieu qua|tac dung)\b|\bbao lau\b.*\b(?:kho|kho thoang|do|giam|hieu qua|tac dung)\b/.test(
      text,
    );
  const mentionsDailyUse =
    /\b(?:co phai )?(?:ngay nao cung|hang ngay|moi ngay)\b.*\b(?:boi|lan|dung|su dung)\b|\b(?:boi|lan|dung|su dung)\b.*\b(?:ngay nao cung|hang ngay|moi ngay)\b/.test(
      text,
    );
  const asksDailyUse =
    mentionsDailyUse &&
    (/[?？]/u.test(value) || /\b(?:co phai|co can|phai|can)\b.*\b(?:khong|ko|k)\b/.test(text));
  return asksDuration || asksDailyUse || asksWeeklyFrequency(text);
}

function asksWeeklyFrequency(value: string): boolean {
  const text = normalize(value);
  return /(?:1|mot) tuan.*(?:boi|lan|dung).*may lan|(?:boi|lan|dung).*may lan.*tuan|may lan\s*\/\s*tuan/.test(
    text,
  );
}

export function isMorningFragranceLayeringQuestion(value: string): boolean {
  const text = normalize(value);
  const morningOrLayering = /(?:sang|buoi sang|sang ra)|(?:dung|xit|lan|boi).*(?:them|chong|de|ket hop)/.test(
    text,
  );
  const fragranceProduct =
    /nuoc hoa|perfume|lan (?:khu mui|co huong|mui huong)|khu mui (?:co huong|mui huong)|deodorant/.test(text);
  const asksCompatibility =
    /co duoc|duoc khong|duoc k|co bi|lan mui|lon mui|tron mui|mui khong|ket hop|dung them|xit them|de len/.test(
      text,
    );
  return morningOrLayering && fragranceProduct && asksCompatibility;
}

/** Khách hỏi một lọ/chai dùng được bao lâu hoặc bao nhiêu tháng. */
export function isBottleLongevityQuestion(value: string): boolean {
  const text = normalize(value);
  const mentionsOneContainer = /\b(?:mot|1|moi) (?:lo|chai)\b|\b(?:lo|chai) nay\b/.test(text);
  const asksLongevity =
    /\b(?:dung|xai|boi|lan)\b.*\b(?:duoc )?(?:bao lau|may thang)\b|\b(?:bao lau|may thang)\b.*\b(?:dung|xai|boi|lan|can)\b/.test(
      text,
    );
  return mentionsOneContainer && asksLongevity;
}

/** Tin vừa đổi số lượng/điểm giao, vừa hỏi kiểm hàng hoặc thời gian nhận. */
export function isCompoundOrderUpdateQuestion(value: string): boolean {
  const text = normalize(value);
  const updatesOrder = detectQuantity(text) !== undefined && /\b(?:gui|giao|lay|chot|dat|thu)\b/.test(text);
  const asksReceivingPolicy =
    /\b(?:kiem tra|kiem hang|mo hang)\b.*\b(?:thanh toan|cod|nhan hang)\b|\b(?:bao gio|khi nao|bao lau|may ngay)\b.*\b(?:nhan|giao|toi)\b/.test(
      text,
    );
  return updatesOrder && asksReceivingPolicy;
}

function isExplicitPriceDecline(text: string): boolean {
  return /(?:dat qua|gia cao|khong du tien).*(?:khong lay|khong mua|thoi|bo)|(?:khong lay|khong mua).*(?:dat|gia|tien)/.test(
    text,
  );
}

function isPurchaseDecline(text: string): boolean {
  return (
    isExplicitOrderCancellation(text) ||
    /^(?:thoi\s+)?(?:khong|ko|k)\s+(?:mua|lay|chot)(?:\s+(?:nua|dau|a))?|^(?:thoi|bo|huy)(?:\s+(?:don|mua|lay))?(?:\s+nua)?$/.test(
      text,
    )
  );
}

function isExplicitOrderCancellation(text: string): boolean {
  return /\b(?:huy|bo)\s+(?:het\s+)?(?:me\s+)?(?:don|don hang)\b|\bkhong\s+mua\s+ban\s+gi\s+nua\b|\b(?:huy|bo)\s+het\b.{0,25}\b(?:don|mua|dat hang)\b/.test(
    text,
  );
}

function isUnclearPriceReference(text: string, session: DemoSession): boolean {
  if (session.pipeline !== "3.Đã báo giá" && session.pipeline !== "4.XL băn khoăn") {
    return false;
  }
  if (isPriceRequest(text) || isPriceConcern(text) || isExplicitPriceDecline(text) || detectQuantity(text)) {
    return false;
  }
  return /\d{2,}|\btram\b|\bnghin\b|\btrieu\b/.test(text);
}

function isPriceRequest(text: string): boolean {
  return /\bgia\b|bang gia|phi ship|xem gia|bao nhieu (?:tien|dong|nghin|trieu)|(?:tien|gia) bao nhieu/.test(
    text,
  );
}

function isOrderRecapRequest(text: string): boolean {
  return /\b(?:nhac lai|xem lai|check lai|kiem tra lai|tom tat|tong ket)\b.{0,40}\b(?:don|don hang|thong tin don)\b|\b(?:bao nhieu tien|bao tien)\b.{0,20}\b(?:don|don nay|don hang)\b|\bdoc lai\b.{0,100}\b(?:(?:chot|lay).{0,30}(?:may|bao nhieu)\s*lo|tien bao nhieu|ship ve dau)\b/.test(
    text,
  );
}

function isOrderPhoneUpdatePreparation(text: string): boolean {
  return /\b(?:khoan|doi|thay|cap nhat)\b.{0,35}\b(?:sdt|so dien thoai|so phone)\b/.test(text) &&
    !/(?<!\d)0\d{9}(?!\d)/u.test(text);
}

function orderStateRecallReply(session: DemoSession, text: string): string | undefined {
  if (/\b(?:ban dau|luc dau|truoc do)\b.{0,45}\b(?:dat|chot|lay)\b.{0,25}\b(?:may|bao nhieu)\s*lo\b|\bban dau minh dat may lo\b/.test(text)) {
    return session.selectedQuantity
      ? `Dạ ban đầu mình đặt ${quantityLabel(session.selectedQuantity)} ạ.`
      : undefined;
  }
  if (/\b(?:nguoi nhan|ten nguoi nhan)\b.{0,30}\b(?:ai|gi|nhi|nhe)\b|^nguoi nhan la ai/.test(text)) {
    return session.order.recipientName
      ? `Dạ người nhận hiện tại là ${session.order.recipientName} ạ.`
      : "Dạ đơn hiện chưa có tên người nhận ạ.";
  }
  if (/\b(?:so|sdt|so dien thoai)\b.{0,25}\b(?:luc dau|ban dau|dau tien|cu)\b|\b(?:luc dau|ban dau)\b.{0,25}\b(?:so|sdt|so dien thoai)\b/.test(text)) {
    const historical = session.conversationMemory.phoneHistory.find(
      (item) => item.status === "historical",
    )?.value;
    const current = session.order.phone;
    if (historical && current) {
      return `Dạ số ban đầu mình gửi là ${historical}; sau đó mình đã đổi sang ${current}. Hiện đơn đang dùng số ${current} ạ.`;
    }
    if (current) return `Dạ từ đầu đơn đang dùng số ${current} ạ.`;
  }
  if (/^(?:so dien thoai|sdt|so phone)(?: la gi)?(?: nhi| nhe| a)?\??$/.test(text)) {
    return session.order.phone
      ? `Dạ số điện thoại hiện đang dùng cho đơn là ${session.order.phone} ạ.`
      : "Dạ đơn hiện chưa có số điện thoại ạ.";
  }
  if (/\b(?:cu|van|giu)\b.{0,25}\b(?:so moi|sdt moi|so dien thoai moi)\b|\b(?:so moi|sdt moi)\b.{0,20}\b(?:nhe|nha|a|dung|nguyen)\b/.test(text)) {
    return session.order.phone
      ? `Dạ em giữ nguyên số mới ${session.order.phone} cho đơn ạ.`
      : "Dạ đơn hiện chưa có số điện thoại mới để giữ lại ạ.";
  }
  if (/\bdia chi\b.{0,30}\b(?:luc nay|truoc do|la gi|dau|nao)\b/.test(text)) {
    return session.order.legacyAddress
      ? `Dạ địa chỉ hiện đang dùng cho đơn là ${session.order.legacyAddress} ạ.`
      : "Dạ đơn hiện chưa có địa chỉ nhận hàng ạ.";
  }
  if (
    session.pipeline === "6.Đã tạo đơn" &&
    /^(?:dung roi|dong y|ok|oke|uh|u|vang|da)(?: nhe| nha| a)?$/.test(text)
  ) {
    return "Dạ đơn đã được ghi nhận đúng theo thông tin mình vừa gửi ạ. Khi có mã vận đơn, bên em sẽ gửi lại cho mình.";
  }
  return undefined;
}

function isRecommendationRequest(text: string): boolean {
  if (extractExplicitOrderQuantity(text)) return false;
  return /\b(?:theo (?:ban|em)|tu van)\b.{0,40}\b(?:nen|chon|lay)\b|\bnen (?:lay|chon) (?:loai|combo|phuong an) nao\b/.test(
    text,
  );
}

function isRecommendedOfferReference(text: string): boolean {
  return /\b(?:quay lai|noi lai|nhac lai)\b.{0,50}\bcombo\b.{0,40}\b(?:khuyen|tu van|noi)\b|\bcombo\b.{0,40}\b(?:vua khuyen|vua tu van)\b/.test(
    text,
  );
}

function isRecommendedOfferPurchase(text: string): boolean {
  return /\b(?:lay|chot|dat|mua|gui)\b.{0,35}\b(?:combo|phuong an)\s*(?:do|ay|vua khuyen|vua tu van)\b/.test(
    text,
  );
}

function isRecommendationSuitabilityQuestion(text: string): boolean {
  return /\b(?:no|combo|phuong an|loai do)\b.{0,35}\b(?:co )?hop\b.{0,35}\b(?:tinh trang|minh|toi)\b|\bco hop voi tinh trang\b/.test(
    text,
  );
}

function recommendationReply(session: DemoSession): string {
  const facts = session.conversationMemory.consultationFacts;
  const reasons = [
    facts.sweatConcern ? "mình đang ưu tiên kiểm soát mồ hôi" : undefined,
    facts.triggers.includes("stress") || facts.triggers.includes("meeting")
      ? "tình trạng rõ hơn khi căng thẳng hoặc họp"
      : undefined,
    facts.odorSeverity === "mild" ? "mùi không phải vấn đề chính" : undefined,
    facts.sensitiveSkin ? "da hơi nhạy cảm nên cần bắt đầu mỏng và theo dõi" : undefined,
  ].filter((item): item is string => Boolean(item));
  return `Dạ với ${reasons.join(", ") || "nhu cầu mình đã chia sẻ"}, em nghiêng về combo 2 lọ 510.000đ, miễn phí giao và tặng 1 túi đa năng ạ. Hai lọ cùng một sản phẩm; combo phù hợp nếu mình muốn dùng ổn định và tiết kiệm hơn, còn muốn thử trước thì 1 lọ vẫn được ạ.`;
}

function recommendedOfferReferenceReply(quantity: SupportedOrderQuantity): string {
  const selected = quote(quantity);
  return `Dạ combo em vừa khuyên là ${quantityLabel(quantity)} giá ${formatVnd(selected.total.amount)}, miễn phí giao và tặng 1 túi đa năng vải dệt Stopirex ạ.`;
}

function recommendationSuitabilityReply(session: DemoSession): string {
  const facts = session.conversationMemory.consultationFacts;
  const context = [
    facts.sweatConcern ? "mồ hôi nách khá nhiều" : undefined,
    facts.triggers.includes("stress") ? "rõ hơn khi căng thẳng" : undefined,
    facts.triggers.includes("meeting") ? "hoặc lúc họp" : undefined,
    facts.odorSeverity === "mild" ? "mùi không nặng" : undefined,
    facts.sensitiveSkin ? "da hơi nhạy cảm" : undefined,
  ].filter((item): item is string => Boolean(item));
  return `Dạ phù hợp với nhu cầu mình đã mô tả: ${context.join(", ")} ạ. Stopirex hướng đến hỗ trợ kiểm soát mồ hôi; vì da hơi nhạy cảm, mình lăn thật mỏng trên da lành, sạch và khô, rồi theo dõi phản ứng trong giai đoạn đầu nhé.`;
}

function isBeneficiaryUsageResolution(text: string): boolean {
  // Only resolve an already discussed beneficiary. Generic purchase language
  // such as “thôi cho mình 1 lọ dùng thử” must remain an order mutation.
  if (extractExplicitOrderQuantity(text)) return false;
  return /\b(?:thoi|van)\s+(?:de|cho)\s+(?:em gai|em minh|vo|me|bo|con)\s+(?:dung rieng|dung)\b/.test(text);
}

function beneficiaryUsageResolutionReply(session: DemoSession): string {
  const beneficiary = session.conversationMemory.beneficiaries.find(
    (item) => item.id === session.conversationMemory.activeBeneficiaryId,
  );
  const label = beneficiary?.label || "người mình đang hỏi giúp";
  return `Dạ em ghi nhận mình giữ sản phẩm để ${label} dùng riêng ạ; thông tin đơn hiện tại vẫn được giữ nguyên.`;
}

function isUnverifiedGiftClaim(text: string): boolean {
  return /\b(?:tang|qua|tang kem)\b.{0,40}\b(?:sua tam|qua tang)\b|\b(?:sua tam)\b.{0,35}\b(?:tang|kem)\b/.test(
    text,
  );
}

function isGuidancePriceChoice(text: string): boolean {
  return (
    isPriceRequest(text) ||
    /^(?:1 lo|mot lo|ca hai|ca 2|gui ca hai|combo|2 lo|hai lo)$/.test(text) ||
    /gui (?:ca hai|ca 2|hai phuong an|2 phuong an|phuong an|minh)|1 lo dung thu|mot lo dung thu/.test(text)
  );
}

function offersPriceChoice(question: string): boolean {
  const text = normalize(question);
  return (
    /1 lo/.test(text) && /combo|ca 1 lo va combo|ca hai/.test(text) && /gui|phuong an|so sanh/.test(text)
  );
}

function isBuyingIntent(text: string): boolean {
  return /\b(?:muon|cần|can) mua\b|\bmua stopirex\b|\bmua [1-9]\d*\s*(?:lo|hop)\b|\bchot\b|dat hang|lay [1-9]\d*|combo|[1-9]\d* (?:lo|hop)|tiep tuc (?:don|dat|mua)|lam tiep don/.test(
    text,
  );
}

function isCorrectConfirmation(text: string): boolean {
  return (
    /^(dung|dung roi|xac nhan dung|dong y|toi dong y|xac nhan dong y|dong y tao don)$/.test(text) ||
    /\b(?:dung|dung roi|dung thong tin|thong tin dung|xac nhan dung)\b.{0,60}\b(?:gui|giao|len don|chot)\b/.test(
      text,
    )
  );
}

function isResumeExistingRetailOrder(session: DemoSession, text: string): boolean {
  if (!session.selectedQuantity || session.orderId) return false;
  return /\b(?:dua thoi|noi vui thoi|noi dua thoi|dung nhap si nua)\b.{0,35}\b(?:cu|tiep tuc)\s+(?:giao|don le|don nay)|\bcu giao don le nay truoc di\b/.test(
    text,
  );
}

function extractRequestedQuantity(text: string): number | undefined {
  const numeric = text
    .match(/\b([1-9]\d*)\s+(?:lo|hop)\b|\b(?:lay|chon|chot|mua|gui)\s+([1-9]\d*)\b/)
    ?.slice(1)
    .find(Boolean);
  if (numeric) return Number(numeric);
  const words: ReadonlyArray<[RegExp, number]> = [
    [/\bnam\s+(?:lo|hop)\b/, 5],
    [/\bbon\s+(?:lo|hop)\b/, 4],
    [/\bba\s+(?:lo|hop)\b/, 3],
    [/\b(?:hai)\s+(?:lo|hop)\b/, 2],
    [/\b(?:mot)\s+(?:lo|hop)\b/, 1],
  ];
  return words.find(([pattern]) => pattern.test(text))?.[1];
}

/**
 * Resolves an explicit sequence such as “3 lọ → lấy 4 lọ → trừ phần một
 * người”. It is intentionally narrow: household headcount alone never becomes
 * order quantity, and the reducer only commits when the message contains at
 * least one explicit bottle selection plus a later correction.
 */
function extractCompoundFinalQuantity(text: string): SupportedOrderQuantity | undefined {
  const explicitSelections = [
    ...text.matchAll(
      /\b(?:combo|mua|lay|chon|chot|doi thanh|chuyen thanh|hay thoi lay)\s+([1-5]|mot|hai|ba|bon|nam)\s*lo\b/g,
    ),
  ];
  if (explicitSelections.length < 2) return undefined;
  const words: Record<string, number> = { mot: 1, hai: 2, ba: 3, bon: 4, nam: 5 };
  const lastToken = explicitSelections.at(-1)?.[1];
  if (!lastToken) return undefined;
  let quantity = words[lastToken] ?? Number(lastToken);
  const subtractOnePerson =
    /\b(?:chong|vo|lao|ba chi|ong anh|mot nguoi)\b.{0,70}\b(?:khong dung|khong lay|khong mua)\b/.test(text) ||
    /\b(?:tru|bot|bo)\b.{0,25}\b(?:lao|chong|vo|mot nguoi|phan cua)\b/.test(text);
  if (subtractOnePerson) quantity -= 1;
  return Number.isInteger(quantity) && quantity >= 1 && quantity <= 5
    ? (quantity as SupportedOrderQuantity)
    : undefined;
}

/** A quantity becomes order state only when the customer uses a buying action. */
function extractExplicitOrderQuantity(text: string): number | undefined {
  const hasPurchaseAction =
    /(?:^|\b)(?:cho|gui|lay|chon|chot|dat|mua)(?:\s+(?:minh|menh|toi|anh|a|chi|em))?\b/.test(text);
  if (!hasPurchaseAction) return undefined;
  return extractRequestedQuantity(text);
}

function extractQuantityOperation(text: string): QuantityOperation | undefined {
  const readNumber = (token: string | undefined): number | undefined => {
    if (!token) return undefined;
    const words: Record<string, number> = { mot: 1, hai: 2, ba: 3, bon: 4, nam: 5 };
    return words[token] ?? Number(token);
  };
  const subtract = text.match(/\b(?:tru|bot|bo)\s+(?:di\s+)?(\d+|mot|hai|ba|bon|nam)\s*lo\b/);
  if (subtract) return { operation: "subtract", operand: readNumber(subtract[1]) ?? 0 };
  const add = text.match(/\b(?:them|cong)\s+(?:vao\s+)?(\d+|mot|hai|ba|bon|nam)\s*lo\b/);
  if (add) return { operation: "add", operand: readNumber(add[1]) ?? 0 };
  const replace = text.match(
    /\b(?:doi thanh|chuyen thanh|sua thanh|chot lai|giu lai|lay)\s+(\d+|mot|hai|ba|bon|nam)\s*lo\b/,
  );
  if (replace) return { operation: "replace", operand: readNumber(replace[1]) ?? 0 };
  return undefined;
}

function applyQuantityOperation(
  current: SupportedOrderQuantity,
  command: QuantityOperation,
): SupportedOrderQuantity | undefined {
  const next =
    command.operation === "replace"
      ? command.operand
      : command.operation === "add"
        ? current + command.operand
        : current - command.operand;
  return Number.isInteger(next) && next >= 1 && next <= 5 ? (next as SupportedOrderQuantity) : undefined;
}

function quantityUpdatePriceReply(quantity: SupportedOrderQuantity): string {
  const selected = quote(quantity);
  return quantity === 1
    ? "Dạ em đã đổi đơn còn 1 lọ: 285.000đ + 30.000đ phí giao ạ."
    : `Dạ em đã cập nhật đơn thành ${quantity} lọ: ${formatVnd(selected.total.amount)}, miễn phí giao ạ.`;
}

function detectQuantity(text: string): SupportedOrderQuantity | undefined {
  const explicit = extractRequestedQuantity(text);
  if (explicit && explicit <= 5) return explicit as SupportedOrderQuantity;
  if (/\b(?:lay|chon|chot|mua|dat|gui)\b.{0,20}\bcombo\b/.test(text) && !explicit) return 2;
  return undefined;
}

function isBareQuantityReply(text: string): boolean {
  return /^[1-5]$/.test(text);
}

function resolveQuantitySelection(
  text: string,
  semantic: SemanticUnderstanding,
  session: DemoSession,
): SupportedOrderQuantity | undefined {
  const explicit = detectQuantity(text);
  if (explicit) return explicit;
  const expectsQuantity =
    session.pendingAction === "choose_quantity" ||
    session.pendingQuestionTopic === "quantity" ||
    semantic.replyTo === "choose_quantity" ||
    (semantic.intent === "buying" && semantic.affirmation === true);
  if (text === "combo" && expectsQuantity) return 2;
  if (!isBareQuantityReply(text)) return undefined;
  if (!expectsQuantity) return undefined;
  return Number(text) as SupportedOrderQuantity;
}

function isExplicitQuantitySelection(text: string): boolean {
  if (isPriceRequest(text) || /[?？]/u.test(text)) return false;
  return /^(?:the\s+)?(?:(?:minh|anh|a|chi|em)\s+)?(?:(?:cho|lay|chon|chot|gui)\s+(?:(?:minh|anh|a|chi|em)\s+)?)?(?:(?:[1-5]|mot|hai|ba|bon|nam)\s+lo|combo)(?:\s+(?:di|nhe|nha|a))?$/.test(
    text,
  );
}

function orderInformationRequestReply(quantity: SupportedOrderQuantity): string {
  const gift = stopirexGiftForQuantity(quantity);
  return [
    `Dạ, em ghi nhận mình chọn ${quantityLabel(quantity)} nhé.`,
    ...(gift ? [`Đơn này được tặng ${gift}.`] : []),
    "Để em lên đơn chính xác, mình gửi giúp em các thông tin sau (có thể gửi từng tin):",
    "1. Tên người nhận\n2. SĐT 10 số\n3. Địa chỉ trước sáp nhập đầy đủ số nhà/đường/thôn, phường/xã, quận/huyện và tỉnh/thành phố ạ.",
  ].join("\n\n");
}

function multiActionOrderInformationRequestReply(quantity: SupportedOrderQuantity): string {
  const selected = quote(quantity);
  const gift = stopirexGiftForQuantity(quantity);
  const price =
    quantity === 1
      ? `${formatVnd(selected.productPrice.amount)} + ${formatVnd(selected.shippingFee.amount)} phí giao`
      : `${formatVnd(selected.total.amount)}, miễn phí giao`;
  return `Dạ, em ghi nhận mình lấy ${quantityLabel(quantity)} ạ. Đơn hiện là ${price}${gift ? ` và được tặng ${gift}` : ""}. Mình gửi giúp em tên người nhận, SĐT và địa chỉ trước sáp nhập đầy đủ để em lên đơn; SĐT gồm 10 số và mình có thể gửi từng phần ạ.`;
}

function multiActionAnswer(
  topics: readonly SemanticTopic[],
  raw: string,
  semanticSlots: ConsultationSlots,
): string {
  const text = normalize(raw);
  const uniqueTopics = [...new Set(topics)];
  const answers: string[] = [];

  if (isPriorOtherProductAdverseExperience(text) || isPriorSweatProcedureEffectQuestion(text)) {
    return productComparisonReply(false, text);
  }
  const returnsPolicyQuestion = isReturnsPolicyQuestion(text);
  if (
    returnsPolicyQuestion &&
    uniqueTopics.every((topic) => ["order", "other"].includes(topic)) &&
    !isApplicationFeelOrClothingConcern(text)
  ) {
    return returnsPolicyReply(text);
  }
  if (isProductCompositionMythQuestion(text)) {
    return isIndustrialAlcoholMythQuestion(text)
      ? "Dạ hồ sơ công bố của Stopirex có thành phần Alcohol dùng trong công thức mỹ phẩm, không có dữ liệu nào ghi sản phẩm chứa ‘cồn công nghiệp’ ạ. Stopirex hỗ trợ kiểm soát mồ hôi và không làm teo tuyến mồ hôi vĩnh viễn."
      : "Dạ thông tin này chưa đúng với hồ sơ sản phẩm chính thức bên em ạ. Stopirex không có phiên bản nắp vàng chứa nọc rắn hay thông tin 50% muối nhôm. Riêng lo ngại y khoa, em không tự đưa kết luận hoặc số liệu ngoài nguồn đã duyệt.";
  }
  if (isShelfLifeQuestion(text)) {
    return "Dạ hạn 3 năm là hạn của sản phẩm còn nguyên và bảo quản đúng ạ. Sau khi mở, mình xem ký hiệu trên chai; bên em chưa có mốc tháng đã duyệt nên không tự báo 6 hay 12 tháng.";
  }
  if (isMissedEveningApplicationQuestion(text)) return missedEveningApplicationReply();
  if (uniqueTopics.includes("comparison") && uniqueTopics.includes("usage")) {
    return [
      "Dạ, Stopirex khác lăn khử mùi thông thường ở chỗ sản phẩm hỗ trợ kiểm soát tiết mồ hôi, thay vì chủ yếu khử hoặc che mùi bằng hương thơm ạ.",
      "Mình không cần lăn 1 lần mỗi ngày; lúc mới dùng, mình lăn một lớp mỏng 2–3 lần/tuần vào buổi tối trên da sạch, khô ạ.",
    ].join("\n\n");
  }
  if (isMorningFragranceLayeringQuestion(text) && isCurrentCatalogSoapQuestion(text)) {
    return "Dạ Stopirex không dùng hương thơm để che mùi nên sáng mình dùng nước hoa sẽ không bị lẫn hương ạ. Hiện gian hàng chưa bán xà phòng trị thâm nách nên em không tự gợi ý sản phẩm ngoài danh mục.";
  }
  if (isMorningFragranceLayeringQuestion(text) && asksWeeklyFrequency(text)) {
    return "Dạ mình lăn Stopirex 2–3 lần/tuần vào buổi tối trên da sạch, khô ạ. Stopirex không dùng hương thơm để che mùi nên sáng mình dùng thêm lăn khử mùi Romano sẽ không bị lộn hương ạ.";
  }
  // Effect onset/permanence is about the treatment journey, even when the
  // customer mentions “một lọ”. It must win over container longevity.
  if (isPermanentControlQuestion(text)) {
    return productEffectReply("sweat", undefined, text);
  }
  if (isBottleLongevityQuestion(text) && isUsageDurationOrFrequencyQuestion(text)) {
    return "Dạ một lọ thường dùng khoảng 3–4 tháng ạ. Mình không cần bôi hằng ngày; lúc mới dùng chỉ lăn một lớp mỏng 2–3 lần/tuần vào buổi tối trên da sạch, khô hoàn toàn.";
  }
  if (isBottleLongevityQuestion(text) && asksAboutProductScent(text)) {
    return [
      bottleLongevityReply(raw),
      "Sản phẩm có mùi dược tính đặc trưng nhẹ và bay hơi rất nhanh, nên mình dùng nước hoa vẫn không bị lẫn mùi ạ.",
    ].join("\n\n");
  }
  const hasEffectAnswer = uniqueTopics.some((topic) => ["effectiveness", "sweat", "odor"].includes(topic));
  if (hasEffectAnswer) {
    const effectTopic = productEffectTopic(text, semanticSlots) ?? semanticSlots.primarySymptom ?? "both";
    answers.push(productEffectReply(effectTopic, undefined, text, semanticSlots.workContext));
  }
  if (uniqueTopics.includes("usage")) {
    answers.push(
      isMorningSoapWashQuestion(text)
        ? "Dạ sáng hôm sau mình tắm và vệ sinh bằng xà phòng bình thường, không làm mất tác dụng của lần dùng tối hôm trước ạ."
        : isMorningFragranceLayeringQuestion(text)
          ? morningFragranceLayeringReply()
          : isBottleLongevityQuestion(text)
            ? (bottleLongevityReply(raw).split("\n\n")[0] ?? bottleLongevityReply(raw))
            : "Dạ mình dùng Stopirex vào buổi tối khi da sạch, khô hoàn toàn; lăn một lớp mỏng khoảng 2–3 lần/tuần ạ.",
    );
  }
  if (isApplicationFeelOrClothingConcern(text) && !hasEffectAnswer) {
    answers.push(productEffectReply("both", undefined, text, semanticSlots.workContext));
  }
  if (returnsPolicyQuestion) answers.push(returnsPolicyReply(text));
  if (uniqueTopics.includes("comparison")) {
    answers.push(
      /hang gia|nghi gia|chinh hang|hang that|fake|nguon goc/.test(text)
        ? "Dạ sản phẩm Stopirex bên em cung cấp là hàng chính hãng. Khi nhận hàng, mình đối chiếu bao bì, tem, đúng tên sản phẩm và thông tin người gửi; nếu không khớp, mình có quyền từ chối nhận và liên hệ bên em kiểm tra ạ."
        : "Dạ lăn thông thường thường dùng hằng ngày để khử hoặc che mùi; Stopirex hỗ trợ kiểm soát tiết mồ hôi, dùng buổi tối và không dùng hương thơm để che mùi ạ.",
    );
  }
  if (uniqueTopics.includes("price") || uniqueTopics.includes("shipping")) {
    const requested = detectQuantity(text);
    if (requested) {
      const selected = quote(requested);
      const deliveryContext = resolveDeliveryContext(raw).normalized;
      const destination = deliveryContext
        ? [deliveryContext.district, deliveryContext.city].filter(Boolean).join(", ")
        : undefined;
      const destinationReply =
        uniqueTopics.includes("shipping") && destination
          ? `Dạ bên em giao được đến ${destination}. `
          : "";
      answers.push(
        requested === 1
          ? `${destinationReply || "Dạ "}1 lọ giá 285.000đ + 30.000đ phí giao ạ.`
          : `${destinationReply || "Dạ "}${quantityLabel(requested)} giá ${formatVnd(selected.total.amount)}, miễn phí giao và tặng ${stopirexGiftForQuantity(requested)} ạ.`,
      );
    } else {
      // Multi-action turns use the same approved catalog renderer as the
      // direct price route. This prevents an order interruption or a second
      // question from silently dropping the body-wash combo and follow-up.
      answers.push(priceReply());
    }
  }
  if (uniqueTopics.some((topic) => ["order", "delivery"].includes(topic))) {
    answers.push(
      /kiem hang|hang that|chinh hang|hang gia/.test(text)
        ? "Dạ sản phẩm Stopirex bên em cung cấp là hàng chính hãng; khi nhận mình có thể đối chiếu bao bì, tem, đúng tên sản phẩm và thông tin người gửi ạ."
        : domesticDeliveryEtaPolicyReply(),
    );
  }
  if (uniqueTopics.includes("child_age")) {
    answers.push(
      "Dạ Stopirex không dùng cho trẻ dưới 12 tuổi; trẻ từ đủ 12 tuổi có thể dùng theo đúng hướng dẫn ạ.",
    );
  }
  if (uniqueTopics.includes("pregnancy")) {
    answers.push("Dạ phụ nữ đang mang thai nên tham khảo ý kiến bác sĩ trước khi dùng Stopirex ạ.");
  }
  if (uniqueTopics.includes("breastfeeding")) {
    answers.push("Dạ phụ nữ đang cho con bú nên tham khảo ý kiến bác sĩ trước khi dùng Stopirex ạ.");
  }
  if (uniqueTopics.includes("sensitive_skin")) {
    answers.push(
      "Dạ Stopirex có công thức dịu nhẹ, phù hợp với da nhạy cảm khi dùng đúng hướng dẫn; không dùng trên da đang trầy, rát hoặc ngứa ạ.",
    );
  }
  if (uniqueTopics.includes("irritation")) {
    answers.push(
      "Dạ nếu sau khi dùng vùng da bị rát, ngứa hoặc đỏ thì mình tạm ngưng, không lăn lại khi da còn khó chịu và nhắn bên em kiểm tra tình trạng ạ.",
    );
  }

  return answers.join("\n\n") || "Dạ em đã ghi nhận đúng câu hỏi hiện tại của mình ạ.";
}

function isApprovedProductAnswerFallback(text: string): boolean {
  return (
    (isMorningFragranceLayeringQuestion(text) && isCurrentCatalogSoapQuestion(text)) ||
    isBottleLongevityQuestion(text) ||
    isShelfLifeQuestion(text) ||
    isProductCompositionMythQuestion(text) ||
    isPermanentControlQuestion(text) ||
    isMissedEveningApplicationQuestion(text) ||
    isApplicationFeelOrClothingConcern(text) ||
    isMorningSoapWashQuestion(text)
  );
}

function llmFailureKnowledgeAnswer(
  raw: string,
  semanticSlots: ConsultationSlots,
): { reply: string; knowledgeIds: string[]; intent: CustomerIntent } | undefined {
  const text = normalize(raw);
  let topics: SemanticTopic[] | undefined;
  let intent: CustomerIntent = "product_effect";
  const directIntent = detectDirectIntent(text);
  if (isDeliveryInspectionQuestion(text)) {
    return {
      reply:
        "Dạ khi nhận hàng, mình được kiểm tra bao bì ngoài, tem và đúng lọ Stopirex; mình không mở seal sản phẩm trước khi xác nhận nhận hàng nhé ạ.",
      knowledgeIds: ["domestic-delivery-inspection-policy"],
      intent: "order_support",
    };
  }
  if (directIntent === "price_request") {
    const effectTopic = productEffectTopic(text, semanticSlots);
    const answerTopics: SemanticTopic[] = effectTopic ? ["price", "effectiveness"] : ["price"];
    return {
      reply: multiActionAnswer(answerTopics, raw, semanticSlots),
      knowledgeIds: [
        "pricing-approved-options-2026-08",
        ...(effectTopic ? ["product-comparison-traditional-rollon"] : []),
      ],
      intent: effectTopic ? "product_effect" : "price_request",
    };
  }
  if (directIntent === "price_objection") {
    return {
      reply: [
        "Dạ em hiểu mình đang cân nhắc về giá ạ. Stopirex là dòng ngăn tiết mồ hôi chuyên sâu, dùng buổi tối và sau giai đoạn làm quen thường dùng giãn cách 2–3 ngày/lần tùy tình trạng.",
        "1 lọ hiện là 285.000đ + 30.000đ phí giao; combo 2 lọ 510.000đ, miễn phí giao. Mình muốn cân nhắc 1 lọ hay combo 2 lọ ạ?",
      ].join("\n\n"),
      knowledgeIds: [
        "pricing-approved-options-2026-08",
        "product-comparison-traditional-rollon",
        "usage-general",
      ],
      intent: "price_objection",
    };
  }
  if (directIntent === "safety") {
    const answer = audienceSafetyReply(text, { slots: semanticSlots });
    if (answer.knowledgeEntityIds.length > 0) {
      return {
        reply: answer.reply,
        knowledgeIds: answer.knowledgeEntityIds,
        intent: "safety",
      };
    }
  }
  if (isBottleLongevityQuestion(text) && asksAboutProductScent(text)) {
    return {
      reply: [
        bottleLongevityReply(raw),
        "Sản phẩm có mùi dược tính đặc trưng nhẹ và bay hơi rất nhanh, nên mình dùng nước hoa vẫn không bị lẫn mùi ạ.",
      ].join("\n\n"),
      knowledgeIds: [
        "usage-bottle-duration",
        "business-approved-alcohol-odor-guidance-2026-08",
        "usage-morning-fragrance-layering",
      ],
      intent: "usage_frequency",
    };
  }
  if (isAlcoholAndPermanentPremiseQuestion(text)) {
    return {
      reply: alcoholAndPermanentReply(),
      knowledgeIds: [
        "business-approved-alcohol-odor-guidance-2026-08",
        "product-official-ingredient-list-2022",
        "mechanism-control-not-permanent",
      ],
      intent: "product_effect",
    };
  }
  if (isAlcoholAndScentPremiseQuestion(text)) {
    return {
      reply:
        "Dạ em xin thông tin chính xác đến mình ạ: Stopirex vẫn có chứa cồn (Alcohol) đóng vai trò làm dung môi trong ngưỡng an toàn, giúp da nhanh khô ráo. Sản phẩm có mùi dược tính đặc trưng nhẹ chứ không hoàn toàn không mùi như nước lọc, nhưng mùi sẽ bay hơi rất nhanh. Mình hoàn toàn yên tâm dùng chung với nước hoa mà không sợ bị lộn mùi đâu ạ.",
      knowledgeIds: [
        "business-approved-alcohol-odor-guidance-2026-08",
        "product-official-ingredient-list-2022",
        "usage-morning-fragrance-layering",
      ],
      intent: "product_comparison",
    };
  }
  if (isHairRemovalMorningClothingQuestion(text)) {
    return {
      reply:
        "Dạ mình chưa bôi ngay sáng nay ạ. Sau nhổ, cạo, wax hoặc triệt lông, mình chờ 24–48 giờ và chỉ dùng khi da đã ổn. Stopirex dùng buổi tối trên da sạch, khô, lăn mỏng; chờ khô rồi mặc áo. Dùng đúng hướng dẫn, sản phẩm không bết và không gây ố vàng nách áo.",
      knowledgeIds: ["usage-after-hair-removal", "usage-application-feel-clothing"],
      intent: "usage_guidance",
    };
  }
  if (isMorningApplicationQuestion(text)) {
    return {
      reply: [
        "Dạ mình không bôi Stopirex vào buổi sáng ạ. Sản phẩm dùng buổi tối trên vùng da sạch, khô hoàn toàn và chỉ lăn một lớp mỏng.",
        ...(isApplicationFeelOrClothingConcern(text)
          ? [
              "Mình chờ sản phẩm khô rồi mặc áo; khi dùng đúng lượng, sản phẩm không bết và không gây ố vàng nách áo ạ.",
            ]
          : []),
      ].join("\n\n"),
      knowledgeIds: [
        "usage-general",
        ...(isApplicationFeelOrClothingConcern(text) ? ["usage-application-feel-clothing"] : []),
      ],
      intent: "usage_time",
    };
  }
  if (isReturnsPolicyQuestion(text) && isApplicationFeelOrClothingConcern(text)) {
    const asksShippingDestination = /\b(?:ship|giao)\s+(?:ve|toi)\b/.test(text);
    return {
      reply: [
        "Dạ mình dùng Stopirex buổi tối trên da sạch, khô hoàn toàn; lăn một lớp mỏng 2–3 lần/tuần ạ.",
        "Lúc mới lăn da có thể hơi ẩm nhẹ nhưng sản phẩm khô nhanh và không bết khi dùng đúng lượng; mình chờ khô rồi mặc áo nhé.",
        "Nếu dùng đúng hướng dẫn đủ 2 tuần mà chưa hiệu quả, bên em hỗ trợ hoàn tiền; hồ sơ gồm thông tin tài khoản và clip nhúng hủy sản phẩm, không cần gửi lại sản phẩm ạ.",
        ...(asksShippingDestination ? [domesticDeliveryEtaPolicyReply()] : []),
      ].join("\n\n"),
      knowledgeIds: [
        "usage-general",
        "usage-application-feel-clothing",
        "refund-used-ineffective",
        ...(asksShippingDestination ? ["domestic-delivery-inspection-policy"] : []),
      ],
      intent: "usage_guidance",
    };
  }
  if (isReturnsPolicyQuestion(text)) {
    const usedIneffectiveRefund = isUsedIneffectiveRefundQuestion(text);
    return {
      reply: returnsPolicyReply(text),
      knowledgeIds: usedIneffectiveRefund
        ? ["refund-used-ineffective"]
        : ["returns-eligibility", "returns-exclusions", "returns-process-fees-refund"],
      intent: "order_support",
    };
  }
  if (isPriorOtherProductAdverseExperience(text)) {
    return {
      reply: productComparisonReply(false, text),
      knowledgeIds: [
        "product-comparison-traditional-rollon",
        "safety-irritation-hypothetical",
        ...(isNamedCompetitorChallenge(text)
          ? [
              "competitor-neutral-advice",
              "product-composition-tolerance-approved",
              "product-official-ingredient-list-2022",
              "lab-test-2025-skin-irritation",
            ]
          : []),
      ],
      intent: "product_comparison",
    };
  }
  if (isEligibleChildAgeQuestion(text)) {
    const age = extractAgeMention(text) ?? 12;
    return {
      reply: `Dạ bé ${age} tuổi dùng được Stopirex rồi ạ. Mình hướng dẫn bé dùng buổi tối trên da sạch, khô hoàn toàn; lăn mỏng 2–3 lần/tuần và không dùng khi da đang trầy hoặc rát nhé.`,
      knowledgeIds: ["audience-child-12-plus"],
      intent: "safety",
    };
  }
  if (
    isMorningSoapWashQuestion(text) ||
    isMissedEveningApplicationQuestion(text) ||
    isBottleLongevityQuestion(text) ||
    isShelfLifeQuestion(text) ||
    (isMorningFragranceLayeringQuestion(text) && isCurrentCatalogSoapQuestion(text))
  ) {
    topics = ["usage"];
    intent = isBottleLongevityQuestion(text)
      ? "usage_frequency"
      : isMissedEveningApplicationQuestion(text)
        ? "usage_time"
        : "usage_guidance";
  } else if (
    isProductCompositionMythQuestion(text) ||
    isPermanentControlQuestion(text) ||
    isApplicationFeelOrClothingConcern(text) ||
    isSweatWashOffConcern(text) ||
    isReturnsPolicyQuestion(text)
  ) {
    topics = ["effectiveness"];
  }
  if (!topics) return undefined;
  return {
    reply: multiActionAnswer(topics, raw, semanticSlots),
    knowledgeIds: knowledgeForActionTopics(topics, text),
    intent,
  };
}

function asksAboutProductScent(text: string): boolean {
  return /\b(?:mui gi|co mui|khong mui|mui huong|mui nong|huong hoa|lon mui|lan mui|nuoc hoa)\b/.test(text);
}

function knowledgeForActionTopics(topics: readonly SemanticTopic[], text: string): string[] {
  const ids = new Set<string>();
  if (isBottleLongevityQuestion(text) && asksAboutProductScent(text)) {
    ids.add("usage-bottle-duration");
    ids.add("business-approved-alcohol-odor-guidance-2026-08");
    ids.add("usage-morning-fragrance-layering");
  }
  if (isReturnsPolicyQuestion(text)) {
    if (isUsedIneffectiveRefundQuestion(text)) ids.add("refund-used-ineffective");
    else ids.add("returns-process-fees-refund");
  }
  if (isProductCompositionMythQuestion(text)) {
    ids.add("product-official-version-and-false-ingredients");
    if (isIndustrialAlcoholMythQuestion(text)) {
      ids.add("product-composition-tolerance-approved");
      ids.add("product-official-ingredient-list-2022");
      ids.add("mechanism-control-not-permanent");
    }
  }
  if (isNamedCompetitorChallenge(text)) {
    ids.add("competitor-neutral-advice");
    ids.add("product-composition-tolerance-approved");
    ids.add("product-official-ingredient-list-2022");
    ids.add("lab-test-2025-skin-irritation");
  }
  if (isBottleLongevityQuestion(text) && /size|kich thuoc|lo be|lo nho|lo to/.test(text)) {
    ids.add("catalog-single-standard-sku");
  }
  if (isShelfLifeQuestion(text)) ids.add("shelf-life-and-after-opening");
  if (isPermanentControlQuestion(text)) ids.add("mechanism-control-not-permanent");
  if (isAlcoholAndPermanentPremiseQuestion(text)) {
    ids.add("business-approved-alcohol-odor-guidance-2026-08");
    ids.add("product-official-ingredient-list-2022");
  }
  if (isMissedEveningApplicationQuestion(text)) {
    ids.add("usage-timing-missed-evening-application");
  }
  if (isEffectivenessJourneyQuestion(text)) {
    ids.add("effectiveness-usage-journey");
    ids.add("product-training-72h-conditional-claim");
    ids.add("usage-general");
  }
  if (isCurrentCatalogSoapQuestion(text)) ids.add("catalog-no-underarm-darkening-soap");
  if (isApplicationFeelOrClothingConcern(text)) {
    ids.add("usage-application-feel-clothing");
  }
  if (isFragranceAndWetnessPreference(text)) {
    ids.add("usage-morning-fragrance-layering");
    ids.add("usage-application-feel-clothing");
    ids.add("product-official-ingredient-list-2022");
  }
  for (const topic of topics) {
    if (
      ["effectiveness", "sweat", "odor", "comparison"].includes(topic) &&
      !isEffectivenessJourneyQuestion(text)
    ) {
      ids.add("product-comparison-traditional-rollon");
    }
    if (topic === "usage") {
      ids.add(
        isMorningSoapWashQuestion(text)
          ? "usage-morning-wash-with-soap"
          : isMissedEveningApplicationQuestion(text)
            ? "usage-timing-missed-evening-application"
            : isMorningFragranceLayeringQuestion(text)
              ? "usage-morning-fragrance-layering"
              : isBottleLongevityQuestion(text)
                ? "usage-bottle-duration"
                : "usage-general",
      );
      if (isMorningFragranceLayeringQuestion(text) && asksWeeklyFrequency(text)) {
        ids.add("usage-general");
      }
    }
    if (["order", "delivery"].includes(topic)) {
      ids.add(
        isDomesticDeliveryInspectionQuestion(text)
          ? "domestic-delivery-inspection-policy"
          : "authenticity-before-purchase",
      );
    }
    if (topic === "child_age") ids.add("audience-child-12-plus");
    if (topic === "pregnancy") ids.add("audience-pregnancy");
    if (topic === "breastfeeding") ids.add("audience-breastfeeding");
    if (topic === "sensitive_skin") ids.add("audience-sensitive-skin");
    if (topic === "irritation") ids.add("safety-irritation-hypothetical");
  }
  return [...ids];
}

function isMorningSoapWashQuestion(value: string): boolean {
  const text = normalize(value);
  const morning = /\b(?:sang|sang hom sau|hom sau|sang ngu day|sang day)\b/.test(text);
  const washing = /\b(?:tam|rua|ve sinh|xa phong|soap)\b/.test(text);
  const priorEveningLayer =
    /\b(?:lop lan|lop boi|boi|lan)\b.{0,40}\b(?:toi hom truoc|tu toi|buoi toi|dem truoc)\b/.test(text);
  const asksNeedOrEffect =
    /\b(?:co can|can phai|phai|khong can)\b.{0,55}\b(?:tam|rua|ve sinh|xa phong|soap)\b/.test(text) ||
    /\b(?:mat tac dung|troi|con tac dung|anh huong)\b/.test(text);
  return morning && washing && (priorEveningLayer || asksNeedOrEffect);
}

function unsupportedQuestionHandoffReply(
  customerMessage: string,
  unsupportedQuestions: readonly string[],
): string {
  const text = normalize(`${customerMessage} ${unsupportedQuestions.join(" ")}`);
  if (/vat|hoa don/.test(text)) {
    return "Về hóa đơn VAT, em xin phép chuyển thông tin về bộ phận liên quan hỗ trợ trực tiếp cho mình ạ.";
  }
  if (/chiet khau|nhap si|dai ly|tu ke|banner/.test(text)) {
    return "Về chính sách sỉ và vật phẩm hỗ trợ, em chuyển bộ phận liên quan tư vấn đúng phương án cho mình ạ.";
  }
  if (/vo hop|boc rach|vut (?:vo|hop)|mat vo|khong con vo|buu dien|qua lay/.test(text)) {
    if (isUsedIneffectiveRefundQuestion(text)) {
      return "Trường hợp hoàn tiền này mình không cần giữ vỏ hộp hay gửi sản phẩm về ạ.";
    }
    return "Về việc không còn vỏ hộp và cách gửi trả, em chuyển bộ phận liên quan kiểm tra đơn cụ thể rồi hướng dẫn mình ạ.";
  }
  if (/tai phat|1 nam|bao nhieu phan tram|ty le/.test(text)) {
    return "Sản phẩm được dùng duy trì để kiểm soát mồ hôi nên khái niệm tỷ lệ tái phát sau một năm không áp dụng ạ.";
  }
  return "Phần chưa có thông tin xác nhận, em chuyển bộ phận liên quan kiểm tra và phản hồi mình ạ.";
}

function isUnknownAnswer(text: string): boolean {
  return /khong biet|ko biet|k biet|chua de y|khong ro|ko ro/.test(text);
}

function isYesAnswer(text: string): boolean {
  return /^(co|co a|co nhe|co bi|bi|dung|dung roi|uh|uhm|ok)(?:\s+(?:uot|o ao|mo hoi|mui))?$/.test(text);
}

function isNoAnswer(text: string): boolean {
  return /^(khong|ko|k|hong|hok|hom|hem|chua)(?:\s+(?:bi|co))?(?:\s+(?:uot|o ao|mo hoi|mui|mui co the))?(?:\s+a)?$/.test(
    text,
  );
}

function contextualSlotsFromSemanticAnswer(
  semantic: SemanticUnderstanding,
  state: ConsultationState,
  text: string,
): ConsultationSlots {
  const semanticPolarity =
    typeof semantic.affirmation === "boolean" &&
    semantic.needsClarification !== true &&
    (semantic.confidence ?? 1) >= 0.7
      ? semantic.affirmation
      : undefined;
  const polarity = semanticPolarity ?? (isYesAnswer(text) ? true : isNoAnswer(text) ? false : undefined);

  if (polarity === undefined) return {};

  if (state.stage === "S1.context") {
    return {
      workContext: polarity ? "rest_or_stress" : "outdoor_heavy",
    };
  }
  if (state.stage === "S2.sweat") return { sweatPresent: polarity };
  if (state.stage === "S2.odor") return { odorPresent: polarity };
  if (state.stage === "S3.prior_use") {
    return { priorProduct: polarity ? "daily_rollon" : "none" };
  }
  if (state.stage === "S4.safety") return { activeIrritation: polarity };
  return {};
}

function extractConsultationSlots(
  text: string,
  state: ConsultationState,
  variantId: OpeningVariantId,
): ConsultationSlots {
  const slots: ConsultationSlots = {};
  const outdoor =
    /ngoai troi|van dong|lao dong|cong trinh|nang nhoc|tap the thao|luc choi|khi choi|choi (?:pick|pickle|pickleball|the thao|cau long|tennis|bong)|tap gym|chay bo|di nang|ra ngoai/.test(
      text,
    ) ||
    (state.stage === "S1.context" && /\bchoi\b|\btap\b/.test(text));
  const resting =
    /phong lanh|dieu hoa|van phong|ngoi yen|ngoi mat|ngoi (?:khong|ko|k)(?: cung)?|cang thang|it van dong/.test(
      text,
    );
  if (state.stage === "S1.context" && (text === "1" || isYesAnswer(text))) {
    slots.workContext = "rest_or_stress";
  } else if (state.stage === "S1.context" && (text === "2" || isNoAnswer(text))) {
    slots.workContext = "outdoor_heavy";
  } else if (state.stage === "S1.context" && text === "3") slots.workContext = "both";
  else if (outdoor && resting) slots.workContext = "both";
  else if (outdoor) slots.workContext = "outdoor_heavy";
  else if (resting) slots.workContext = "rest_or_stress";

  const sweat = /mo hoi|\buot\b|uot ao|o ao|tiet mo hoi/.test(text);
  const odor = /\bmui\b|mui co the|hoi nach/.test(text);
  const deniesSweat = /(?:khong|ko|k)\s+(?:(?:bi|co)\s+)?(?:uot|uot ao|o ao|mo hoi)/.test(text);
  const deniesOdor = /(?:khong|ko|k)\s+(?:(?:bi|co)\s+)?(?:mui|mui co the|hoi nach)/.test(text);
  const choosesBothSymptoms = /^(?:ca\s*(?:hai|2)|hai cai|2 cai|deu bi|bi ca\s*(?:hai|2))$/u.test(text);
  if (state.stage === "S2.sweat" && !isUnknownAnswer(text)) {
    if (deniesSweat || isNoAnswer(text)) slots.sweatPresent = false;
    else if (sweat && odor) slots.primarySymptom = "both";
    else if (isYesAnswer(text) || sweat) slots.sweatPresent = true;
    else if (odor) slots.primarySymptom = "odor";
  } else if (state.stage === "S2.odor" && !isUnknownAnswer(text)) {
    if (deniesOdor || isNoAnswer(text)) slots.odorPresent = false;
    else if (sweat && odor) slots.primarySymptom = "both";
    else if (isYesAnswer(text) || odor) slots.odorPresent = true;
    else if (sweat) slots.primarySymptom = "sweat";
  } else if (state.stage === "S2.symptom" && choosesBothSymptoms) slots.primarySymptom = "both";
  else if (state.stage === "S2.symptom" && text === "1") slots.primarySymptom = "sweat";
  else if (state.stage === "S2.symptom" && text === "2") slots.primarySymptom = "odor";
  else if (
    state.stage === "S2.symptom" &&
    text === "3" &&
    variantId === "E.number" &&
    !state.slots.priorIrritation
  ) {
    slots.priorIrritation = true;
    slots.priorProduct = "daily_rollon";
  } else if (state.stage === "S2.symptom" && text === "3") slots.primarySymptom = "both";
  else if (state.stage === "S2.symptom" && deniesSweat) slots.sweatPresent = false;
  else if (state.stage === "S2.symptom" && deniesOdor) slots.odorPresent = false;
  else if (sweat && odor && !deniesSweat && !deniesOdor) slots.primarySymptom = "both";
  else if (sweat && !deniesSweat) slots.primarySymptom = "sweat";
  else if (odor && !deniesOdor) slots.primarySymptom = "odor";

  if (state.stage === "S3.prior_use" && text === "1") slots.priorProduct = "daily_rollon";
  else if (state.stage === "S3.prior_use" && text === "2") slots.priorProduct = "none";
  else if (/lan hang ngay|lan thuong|boi hang ngay/.test(text)) slots.priorProduct = "daily_rollon";
  else if (/chuyen sau|gian cach/.test(text)) slots.priorProduct = "specialized";
  else if (/chua dung|khong dung|chua tung/.test(text)) slots.priorProduct = "none";

  if (/tung bi rat|loai cu.*rat|bi ngua|gay rat|gay ngua/.test(text)) slots.priorIrritation = true;
  if (/het rat|khong con rat|da binh thuong|hien tai khong/.test(text)) slots.activeIrritation = false;
  if (state.stage === "S4.safety" && /\bkhong\b|binh thuong|on roi/.test(text)) {
    slots.activeIrritation = false;
    slots.damagedSkin = false;
    slots.recentShaveWaxLaser = false;
  }
  if (state.stage === "S4.safety" && isYesAnswer(text)) {
    slots.activeIrritation = true;
  }
  return slots;
}

function nextScenarioAction(variantId: OpeningVariantId, state: ConsultationState): NextAction {
  const slots = state.slots;

  if (variantId === "E.number" && slots.priorIrritation && slots.activeIrritation === undefined) {
    return {
      stage: "S4.safety",
      reply: "Dạ vì loại cũ từng làm mình khó chịu, em kiểm tra an toàn trước để không hướng dẫn vội ạ.",
      question:
        "Hiện vùng da của mình còn đỏ, rát, ngứa hoặc trầy xước không ạ? Mình trả lời Có hoặc Không là được ạ.",
    };
  }

  if (
    variantId === "E.number" &&
    slots.priorIrritation &&
    slots.activeIrritation === false &&
    !slots.primarySymptom
  ) {
    return {
      stage: "S2.symptom",
      reply: "Dạ em ghi nhận hiện da mình đã ổn ạ.",
      question:
        "Với sản phẩm mới, mình muốn ưu tiên:\n1. Giảm ướt hoặc ố áo\n2. Kiểm soát mùi\n3. Cả hai tình trạng",
    };
  }

  if (variantId === "C.prior" && slots.priorProduct && !slots.primarySymptom) {
    const priorReply =
      slots.priorProduct === "daily_rollon"
        ? "Dạ em hiểu, trước giờ mình dùng lăn hằng ngày ạ. Stopirex là dòng ngăn tiết mồ hôi chuyên sâu và được dùng giãn cách, nên cách dùng sẽ khác loại lăn hằng ngày."
        : slots.priorProduct === "specialized"
          ? "Dạ mình đã quen với dòng dùng giãn cách rồi ạ. Em sẽ tập trung xác định vấn đề chính để hướng dẫn phù hợp hơn."
          : "Dạ em hiểu, trước giờ mình không dùng lăn nách hằng ngày ạ. Em sẽ hướng dẫn từ bước cơ bản để mình dễ áp dụng ngay.";
    return {
      stage: "S2.symptom",
      reply: priorReply,
      question:
        "Để em tập trung đúng vấn đề, mình chọn giúp em ý gần nhất nhé:\n1. Mồ hôi làm ướt hoặc ố áo\n2. Mùi cơ thể\n3. Gặp cả hai tình trạng",
    };
  }

  if (variantId === "E.number" && slots.primarySymptom && !slots.priorIrritation) {
    const benefit =
      slots.primarySymptom === "sweat"
        ? "Dạ em hiểu, mình đang ưu tiên giảm tình trạng ướt hoặc ố áo ạ. Stopirex là dòng ngăn tiết mồ hôi chuyên sâu, phù hợp để hỗ trợ kiểm soát lượng mồ hôi tiết ra."
        : slots.primarySymptom === "odor"
          ? "Dạ em hiểu, mình đang ưu tiên kiểm soát mùi ạ. Khi vùng nách bớt ẩm, vi khuẩn gây mùi sẽ có ít điều kiện phát triển hơn; Stopirex không dùng hương thơm để che mùi."
          : "Dạ em hiểu, mình muốn hỗ trợ cả tình trạng ướt áo và mùi cơ thể ạ.";
    return {
      stage: "S5.guidance",
      reply: benefit,
      question:
        "Mình muốn em gửi cách dùng ngắn trước hay xem bảng giá trước ạ? Mình chỉ cần nhắn “Cách dùng” hoặc “Xem giá” giúp em.",
    };
  }

  return nextConsultationAction(state);
}

function continuationAfterRepeatedQuestion(state: ConsultationState): NextAction {
  if (!state.slots.primarySymptom) {
    return {
      stage: "S2.symptom",
      reply:
        "Dạ, có thể câu vừa rồi chưa đúng điều mình muốn trao đổi. Em đổi sang cách hỏi dễ chọn hơn nhé.",
      question:
        "Mình đang muốn xử lý vấn đề nào trước:\n1. Mồ hôi làm ướt hoặc ố áo\n2. Mùi cơ thể\n3. Gặp cả hai tình trạng?",
    };
  }
  return {
    stage: "S5.guidance",
    reply: productEffectReply(state.slots.primarySymptom),
    question: "Mình muốn em hướng dẫn cách dùng trước hay gửi bảng giá để tham khảo ạ?",
  };
}

const internalCopyPatterns = [
  /\bluồng bán hàng\b/i,
  /\bbot\b/i,
  /\bpipeline\b/i,
  /\bslot\b/i,
  /\bstate machine\b/i,
  /\bbreakpoint\b/i,
  /\b(?:localhost|sandbox)\b/i,
  /\b(?:đơn|mã đơn|mã vận đơn)\s+(?:thử|test|demo)\b/iu,
  /\b(?:DEMO-|VTP-DEMO)\b/i,
] as const;

function assertCustomerFacingCopy(reply: string): void {
  const leaked = internalCopyPatterns.find((pattern) => pattern.test(reply));
  if (leaked) {
    throw new Error(`internal_copy_leak:${leaked.source}`);
  }
}

type PriceContinuation = "discover_symptom" | "choose_quantity";

function showPrice(session: DemoSession, forcedContinuation?: PriceContinuation): PriceContinuation {
  if (session.pipeline !== "3.Đã báo giá") {
    if (session.pipeline === "0.Chưa tư vấn") session.pipeline = "1.Phân loại";
    try {
      session.pipeline = transitionPipeline(session.pipeline, "price_sent");
    } catch {
      session.pipeline = "3.Đã báo giá";
    }
  }
  const continuation = forcedContinuation ?? priceContinuationFor(session);
  if (continuation === "discover_symptom") {
    session.consultation = { ...session.consultation, stage: "S2.symptom" };
    delete session.pendingAction;
    if (session.lastDecision) delete session.lastDecision.pendingActionAfter;
    return continuation;
  }
  session.consultation = { ...session.consultation, stage: "S7.waiting" };
  session.pendingAction = "choose_quantity";
  if (session.lastDecision) session.lastDecision.pendingActionAfter = "choose_quantity";
  return continuation;
}

function priceContinuationFor(session: DemoSession): PriceContinuation {
  if (session.selectedQuantity) return "choose_quantity";
  const slots = session.consultation.slots;
  const symptomKnown =
    Boolean(slots.primarySymptom) ||
    slots.sweatPresent !== undefined ||
    slots.odorPresent !== undefined ||
    session.answeredTopics.includes("symptom");
  const consultationDelivered = session.consultation.stage === "S5.guidance";
  return symptomKnown && consultationDelivered ? "choose_quantity" : "discover_symptom";
}

function continuationQuestion(continuation: PriceContinuation): string {
  return continuation === "discover_symptom"
    ? "Để em tư vấn sát hơn, hiện mình khó chịu chủ yếu vì mồ hôi làm ướt hoặc ố áo, mùi cơ thể hay cả hai tình trạng ạ?"
    : "Anh/chị muốn chọn phương án mấy lọ ạ?";
}

function priceReply(nextQuestion = continuationQuestion("choose_quantity")): string {
  const single = quote(1);
  const combo = quote(2);
  const visibleAdditionalOffers = [quote(3)];
  const rollOnOffer = formatPriceOffer(single, combo, visibleAdditionalOffers, "");
  const bodyCareOffer = [
    "Combo chăm sóc mùi cơ thể:",
    "• 1 lăn Stopirex + 1 chai Herbal Body Wash 500ml: 525.000đ, miễn phí giao.",
    "• Herbal Body Wash hiện chưa bán lẻ.",
    nextQuestion,
  ].join("\n");
  return `${rollOnOffer}\n\n${bodyCareOffer}`;
}

function priceReplyForRequest(text: string, nextQuestion = continuationQuestion("choose_quantity")): string {
  const requestedQuantity = detectQuantity(text);
  return requestedQuantity
    ? `${selectedOrderPriceReply(requestedQuantity)}\n\n${nextQuestion}`
    : priceReply(nextQuestion);
}

function quote(quantity: SupportedOrderQuantity) {
  return demoCatalog.quote({
    tenantId: demoTenant,
    channel: "facebook",
    sku: "STOPIREX",
    quantity,
    at: demoCommerceEffectiveAt,
  });
}

function selectQuantity(
  session: DemoSession,
  quantity: SupportedOrderQuantity,
  sourceAction?: ConversationAction,
): void {
  commitOrderMutations(session, [{
    type: "set_quantity",
    quantity,
    evidence: sourceAction?.rawEvidence ?? sourceAction?.evidence[0] ?? "resolved_quantity_action",
    ...(sourceAction?.propositionId ? { propositionId: sourceAction.propositionId } : {}),
    source: sourceAction?.source === "llm" ? "llm_extraction" : "deterministic_parser",
    confidence: sourceAction?.confidence ?? 1,
  }]);
  session.orderCollectionPaused = false;
  session.consultation = { ...session.consultation, stage: "S8.order" };
}

function commitOrderMutations(
  session: DemoSession,
  actions: readonly OrderMutationAction[],
): ReturnType<typeof reduceOrderTransaction> {
  const previousPhone = session.order.phone;
  const transaction = reduceOrderTransaction(
    {
      ...(session.selectedQuantity ? { selectedQuantity: session.selectedQuantity } : {}),
      order: session.order,
    },
    actions,
    {
      sku: "STOPIREX",
      paymentMethod: "cod",
      totalForQuantity: (quantity) => {
        const selected = quote(quantity);
        return quantity === 1 && session.freeShippingApproved
          ? selected.productPrice.amount
          : selected.total.amount;
      },
    },
  );
  if (transaction.after.selectedQuantity) {
    session.selectedQuantity = transaction.after.selectedQuantity;
  } else {
    delete session.selectedQuantity;
  }
  if (transaction.after.order.legacyAddress) {
    transaction.after.order.legacyAddress = canonicalizeLegacyAddress(transaction.after.order.legacyAddress);
  }
  session.order = transaction.after.order;
  if (session.order.phone && session.order.phone !== previousPhone) {
    session.conversationMemory.phoneHistory = [
      ...session.conversationMemory.phoneHistory.map((item) => ({
        ...item,
        status: "historical" as const,
      })),
      {
        value: session.order.phone,
        status: "current" as const,
        evidence:
          actions.find((action) => action.type === "set_phone")?.evidence ?? "Cập nhật SĐT đơn hàng",
        sourceTurn: session.messages + 1,
      },
    ]
      .filter((item, index, all) =>
        all.slice(index + 1).every((candidate) => candidate.value !== item.value),
      )
      .slice(-6);
  }
  const priorTrace = session.orderTransactionTrace;
  session.orderTransactionTrace = {
    acceptedActions: [
      ...(priorTrace?.acceptedActions ?? []),
      ...transaction.accepted.map((action) => ({ type: action.type, evidence: action.evidence })),
    ],
    acceptedMutations: [
      ...(priorTrace?.acceptedMutations ?? []),
      ...transaction.accepted.map((action) => ({
        type: action.type,
        ...(action.propositionId ? { propositionId: action.propositionId } : {}),
        evidenceRef: workflowEvidenceRef(action.evidence),
        source: action.source ?? "deterministic_parser",
        confidence: action.confidence ?? 1,
        from: maskedOrderMutationValue(action, transaction.before),
        toMasked: maskedOrderMutationValue(action, transaction.after),
      })),
    ],
    rejectedMutations: [
      ...(priorTrace?.rejectedMutations ?? []),
      ...transaction.rejected.map((item) => ({
        type: item.action.type,
        ...(item.action.propositionId ? { propositionId: item.action.propositionId } : {}),
        evidenceRef: workflowEvidenceRef(item.action.evidence),
        reason: item.reason,
      })),
    ],
    unchangedFields: [
      ...new Set([
        ...(priorTrace?.unchangedFields ?? []),
        ...transaction.unchanged.map(orderMutationField),
      ]),
    ],
    missingFields: [...transaction.missingFields],
    changedFields: [
      ...new Set([...(priorTrace?.changedFields ?? []), ...transaction.changedFields.map(String)]),
    ],
    conflicts: [...new Set([...(priorTrace?.conflicts ?? []), ...transaction.conflicts])],
  };
  if (transaction.changedFields.length > 0) {
    session.workflowState = reduceWorkflowStateMeta(
      session.workflowState,
      {
        type: "order_mutated",
        evidence: workflowEvidenceRef(
          transaction.accepted.map((action) => action.evidence).filter(Boolean).join(" | "),
        ),
        changedFields: transaction.changedFields.map(String),
      },
      {
        ...(session.selectedQuantity ? { selectedQuantity: session.selectedQuantity } : {}),
        draft: session.order,
        ...(session.trackingNumber ? { trackingNumber: session.trackingNumber } : {}),
      },
    );
  }
  if (transaction.accepted.some((action) => action.type === "confirm_order")) {
    session.workflowState = reduceWorkflowStateMeta(
      session.workflowState,
      { type: "order_submitted", evidence: workflowEvidenceRef("order_confirmation_committed") },
      {
        ...(session.selectedQuantity ? { selectedQuantity: session.selectedQuantity } : {}),
        draft: session.order,
        ...(session.trackingNumber ? { trackingNumber: session.trackingNumber } : {}),
      },
    );
    if (!session.trackingNumber) {
      session.workflowState = reduceWorkflowStateMeta(
        session.workflowState,
        { type: "tracking_pending", evidence: workflowEvidenceRef("awaiting_tracking_number") },
        {
          ...(session.selectedQuantity ? { selectedQuantity: session.selectedQuantity } : {}),
          draft: session.order,
        },
      );
    }
  }
  return transaction;
}

function orderMutationField(action: OrderMutationAction): string {
  switch (action.type) {
    case "set_quantity": return "quantity";
    case "set_phone": return "phone";
    case "set_recipient_name": return "recipientName";
    case "set_address": return "legacyAddress";
    case "set_delivery_note": return "deliveryNote";
    case "confirm_order": return "customerConfirmedAt";
  }
}

function maskedOrderMutationValue(
  action: OrderMutationAction,
  state: { selectedQuantity?: SupportedOrderQuantity; order: OrderDraft },
): unknown {
  switch (action.type) {
    case "set_quantity":
      return state.selectedQuantity ?? null;
    case "set_phone": {
      const phone = state.order.phone;
      return phone ? `${phone.slice(0, 4)}***${phone.slice(-3)}` : null;
    }
    case "set_recipient_name":
      return state.order.recipientName ? "[recipient_name]" : null;
    case "set_address":
      return state.order.legacyAddress ? "[delivery_address]" : null;
    case "set_delivery_note":
      return state.order.deliveryNote ? "[delivery_note]" : null;
    case "confirm_order":
      return state.order.customerConfirmedAt ? "[confirmed_at]" : null;
  }
}

function approveSingleShipping(session: DemoSession): void {
  session.freeShippingApproved = true;
  if (session.selectedQuantity === 1) {
    selectQuantity(session, 1);
  }
}

function quantityLabel(quantity: SupportedOrderQuantity): string {
  return quantity === 1 ? "1 lọ" : `combo ${quantity} lọ`;
}

function selectedOrderPriceReply(quantity: SupportedOrderQuantity): string {
  const selected = quote(quantity);
  const gift = stopirexGiftForQuantity(quantity);
  return quantity === 1
    ? `Dạ giá 1 lọ là ${formatVnd(selected.productPrice.amount)} + ${formatVnd(selected.shippingFee.amount)} phí giao, tổng ${formatVnd(selected.total.amount)} ạ.`
    : `Dạ combo ${quantity} lọ là ${formatVnd(selected.total.amount)}, được miễn phí giao và tặng ${gift} ạ.`;
}

function clearOrderDraft(session: DemoSession): void {
  const hadOrderState = Boolean(
    session.selectedQuantity ||
      session.orderId ||
      session.trackingNumber ||
      Object.keys(session.order).length > 0,
  );
  session.order = {};
  session.conversationMemory.phoneHistory = [];
  session.orderCollectionPaused = false;
  delete session.selectedQuantity;
  delete session.orderId;
  delete session.trackingNumber;
  delete session.pendingAction;
  session.freeShippingApproved = false;
  if (hadOrderState) {
    session.workflowState = reduceWorkflowStateMeta(
      session.workflowState,
      { type: "draft_discarded", evidence: "clear_order_draft" },
      { draft: session.order },
    );
  }
}

function workflowEvidenceRef(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex").slice(0, 16)}`;
}

function applySemanticOrderUpdates(
  session: DemoSession,
  actions: readonly ConversationAction[],
  raw: string,
): boolean {
  const mutations: OrderMutationAction[] = [];
  for (const action of actions) {
    if (action.type !== "update_order") continue;
    const { recipientName, phone, legacyAddress, deliveryNote } = action.fields;
    const metadata = {
      ...(action.propositionId ? { propositionId: action.propositionId } : {}),
      source: "llm_extraction" as const,
      confidence: action.confidence,
    };
    if (phone) {
      const normalizedPhone = normalizeVietnamesePhone(raw);
      if (normalizedPhone.valid && normalizedPhone.normalized) {
        mutations.push({
          type: "set_phone",
          phone: normalizedPhone.normalized,
          evidence: action.rawEvidence ?? raw,
          ...metadata,
        });
      }
    }
    if (
      recipientName &&
      looksLikeOrderRecipientCandidate(recipientName) &&
      !isAmbiguousAddressIntroductionName(recipientName, action.rawEvidence ?? raw)
    ) {
      mutations.push({
        type: "set_recipient_name",
        recipientName: formatRecipientName(recipientName),
        evidence: action.rawEvidence ?? raw,
        ...metadata,
      });
    }
    if (legacyAddress && looksLikeAddress(legacyAddress)) {
      const normalizedAddress = normalizeVietnameseAddress(
        action.rawEvidence ?? raw,
        session.locationMemory.addressContext,
      );
      if (normalizedAddress.valid && normalizedAddress.normalized) {
        session.locationMemory.addressContext = normalizedAddress.normalized;
      }
      const canonical = normalizedAddress.normalized?.street
        ? formatVietnameseAddress(normalizedAddress.normalized)
        : canonicalizeLegacyAddress(legacyAddress);
      const replacesExisting =
        !session.order.legacyAddress ||
        /(?:đổi|doi|thay|chuyển|chuyen).{0,24}(?:địa chỉ|dia chi|giao|ship)/iu.test(raw);
      // A region mention such as "q1 sg" is useful context, but it is not yet
      // a confirmed shipping address and must not be committed as one.
      if (normalizedAddress.normalized?.street || looksLikeAddress(legacyAddress) && /\d/u.test(legacyAddress)) {
        mutations.push({
          type: "set_address",
          address: canonical,
          ...(normalizedAddress.normalized ? { structured: normalizedAddress.normalized } : {}),
          operation: replacesExisting ? "replace" : "append",
          evidence: action.rawEvidence ?? raw,
          ...metadata,
        });
      }
    }
    if (deliveryNote) {
      const notes = normalizeDeliveryNotes(action.rawEvidence ?? raw);
      mutations.push({
        type: "set_delivery_note",
        deliveryNote: notes.valid && notes.normalized
          ? mergeDeliveryNotes(session.order.deliveryNote, notes.normalized)
          : deliveryNote,
        evidence: action.rawEvidence ?? raw,
        ...metadata,
      });
    }
  }
  if (mutations.length === 0) return false;
  const transaction = commitOrderMutations(session, mutations);
  return transaction.changedFields.length > 0;
}

function isAmbiguousAddressIntroductionName(value: string, evidence: string): boolean {
  const candidate = normalize(value);
  const raw = normalize(evidence);
  return (
    /\b(?:dc|dia chi)\s+(?:m|minh)\s+la\b/u.test(raw) &&
    /^(?:(?:dc|dia chi)\s+)?(?:m|minh)\s+la$/u.test(candidate)
  );
}

function rememberMentionedDeliveryContext(session: DemoSession, raw: string): void {
  const resolved = resolveDeliveryContext(raw);
  if (!resolved.valid || !resolved.normalized) return;
  const current = session.locationMemory.addressContext;
  const district = resolved.normalized.district ?? current?.district;
  const city = resolved.normalized.city ?? current?.city;
  session.locationMemory.addressContext = {
    ...(current?.street ? { street: current.street } : {}),
    ...(current?.ward ? { ward: current.ward } : {}),
    ...(district ? { district } : {}),
    ...(city ? { city } : {}),
    rawParts: [
      ...(current?.rawParts ?? []),
      ...resolved.normalized.rawParts,
    ].filter((value, index, all) => all.indexOf(value) === index),
    status: "mentioned",
  };
}

function mergeOrderData(session: DemoSession, raw: string): boolean {
  const orderRaw = stripOrderSelectionPrefix(raw);
  const addressBefore = session.order.legacyAddress;
  let found = false;
  const addressUpdate = resolveAddressUpdate(session, raw);
  let addressHandled = Boolean(addressUpdate);
  if (addressUpdate?.address) {
    if (addressUpdate.operation === "append") {
      found = commitLegacyAddress(session, addressUpdate.address, "append", raw) || found;
    } else {
      found = commitLegacyAddress(session, addressUpdate.address, "replace", raw) || found;
    }
  }
  if (!addressHandled) {
    const deliveryDestination = extractDeliveryDestination(raw);
    if (deliveryDestination) {
      found = commitLegacyAddress(session, deliveryDestination, "append", raw) || found;
      addressHandled = true;
    }
  }
  const phoneMatch = orderRaw.match(/(?<!\d)(0\d{9})(?!\d)/);
  const invalidPhoneMatch = phoneMatch ? undefined : orderRaw.match(/(?<!\d)(0\d{7,10})(?!\d)/u);
  const phone = phoneMatch?.[1] ?? extractPhoneNumber(raw);
  if (phone) {
    commitOrderMutations(session, [{ type: "set_phone", phone, evidence: raw }]);
    found = true;
  }
  if (invalidPhoneMatch?.[1] && invalidPhoneMatch.index !== undefined) {
    const beforeCandidate = cleanLabel(
      orderRaw.slice(0, invalidPhoneMatch.index).replace(/[,;:\s-]+$/gu, ""),
    );
    const afterCandidate = cleanLabel(
      orderRaw.slice(invalidPhoneMatch.index + invalidPhoneMatch[1].length).replace(/^[,;:\s-]+/gu, ""),
    );
    if (!addressHandled && looksLikeAddress(beforeCandidate)) {
      found = commitLegacyAddress(session, beforeCandidate, "append", raw) || found;
      addressHandled = true;
    }
    if (!session.order.recipientName && looksLikeOrderRecipientCandidate(afterCandidate)) {
      commitOrderMutations(session, [
        {
          type: "set_recipient_name",
          recipientName: formatRecipientName(afterCandidate),
          evidence: raw,
        },
      ]);
      found = true;
    }
  }
  const deliveryNote = extractDeliveryNote(raw);
  if (deliveryNote) {
    commitOrderMutations(session, [{ type: "set_delivery_note", deliveryNote, evidence: raw }]);
    found = true;
  }
  const parts = orderRaw
    .split(/[,;\n]/)
    .map((part) => part.trim())
    .filter(Boolean);
  const administrativeFragment = addressHandled
    ? undefined
    : parseAdministrativeAddressFragment(orderRaw, session.order);
  if (administrativeFragment) {
    found =
      commitLegacyAddress(
        session,
        `Phường/xã ${administrativeFragment.ward}, Quận/huyện ${administrativeFragment.district}`,
        "append",
        raw,
      ) || found;
  }
  const explicitName = extractRecipientName(orderRaw);
  const explicitAddress = addressHandled
    ? undefined
    : orderRaw.match(/(?:dia chi|địa chỉ)\s*[:-]?\s*(.+)$/i)?.[1];
  if (explicitName && !/^0\d{9}$/.test(explicitName.trim())) {
    commitOrderMutations(session, [
      {
        type: "set_recipient_name",
        recipientName: formatRecipientName(cleanExplicitRecipientName(explicitName)),
        evidence: raw,
      },
    ]);
    found = true;
  }
  if (explicitAddress) {
    found = commitLegacyAddress(session, explicitAddress.trim(), "append", raw) || found;
  }
  const bareWard = extractBareWard(orderRaw);
  if (bareWard && session.order.legacyAddress) {
    found = commitLegacyAddress(session, `Phường ${bareWard}`, "append", raw) || found;
  }
  if (phone && phoneMatch?.index !== undefined) {
    const beforePhone = cleanLabel(orderRaw.slice(0, phoneMatch.index).replace(/[,;:-]+$/g, ""));
    const afterPhone = cleanLabel(orderRaw.slice(phoneMatch.index + phone.length).replace(/^[,;:\s-]+/g, ""));
    const combinedBeforePhone = splitUnlabelledNameAndAddress(beforePhone);
    if (!session.order.recipientName && combinedBeforePhone) {
      commitOrderMutations(session, [
        {
          type: "set_recipient_name",
          recipientName: formatRecipientName(combinedBeforePhone.recipientName),
          evidence: raw,
        },
      ]);
      found = true;
    } else if (!session.order.recipientName && looksLikeOrderRecipientCandidate(beforePhone)) {
      commitOrderMutations(session, [
        {
          type: "set_recipient_name",
          recipientName: formatRecipientName(beforePhone),
          evidence: raw,
        },
      ]);
      found = true;
    }
    if (!addressHandled && combinedBeforePhone) {
      found = commitLegacyAddress(session, combinedBeforePhone.address, "append", raw) || found;
      addressHandled = true;
    } else if (!addressHandled && isAcceptableDeliveryAddress(afterPhone)) {
      found = commitLegacyAddress(session, afterPhone, "append", raw) || found;
    }
  }
  if (!addressHandled && phone && parts.length >= 3) {
    const nonPhone = parts.filter((part) => !part.includes(phone));
    const firstPartIsRecipient = Boolean(
      !session.order.recipientName &&
        nonPhone[0] &&
        !looksLikeAddress(nonPhone[0]) &&
        looksLikeOrderRecipientCandidate(nonPhone[0]),
    );
    if (firstPartIsRecipient && nonPhone[0]) {
      commitOrderMutations(session, [
        {
          type: "set_recipient_name",
          recipientName: formatRecipientName(cleanLabel(nonPhone[0])),
          evidence: raw,
        },
      ]);
    }
    const addressParts = firstPartIsRecipient ? nonPhone.slice(1) : nonPhone;
    if (addressParts.length > 0) {
      commitLegacyAddress(session, cleanLabel(addressParts.join(", ")), "append", raw);
    }
    found = true;
  }
  if (!addressHandled && !phone && parts.length === 1) {
    if (
      !session.order.recipientName &&
      looksLikeOrderRecipientCandidate(orderRaw) &&
      looksLikeStandaloneRecipientName(orderRaw) &&
      !looksLikeCustomerQuestion(orderRaw)
    ) {
      commitOrderMutations(session, [
        {
          type: "set_recipient_name",
          recipientName: formatRecipientName(orderRaw.trim()),
          evidence: raw,
        },
      ]);
      found = true;
    } else if (
      session.order.recipientName &&
      session.order.phone &&
      missingLegacyAddressComponents(session.order.legacyAddress).length > 0 &&
      orderRaw.length >= 5
    ) {
      const address = stripRepeatedRecipientName(cleanLabel(orderRaw), session.order.recipientName);
      if (looksLikeAddress(address)) {
        found = commitLegacyAddress(session, address, "append", raw) || found;
      }
    }
  }
  if (
    !addressHandled &&
    !phone &&
    parts.length > 1 &&
    session.order.phone &&
    missingLegacyAddressComponents(session.order.legacyAddress).length > 0
  ) {
    const withoutRepeatedName = stripRepeatedRecipientName(
      parts.map(cleanLabel).join(", "),
      session.order.recipientName,
    );
    if (looksLikeAddress(withoutRepeatedName)) {
      found = commitLegacyAddress(session, withoutRepeatedName, "append", raw) || found;
    }
  }
  if (session.order.legacyAddress && session.order.legacyAddress !== addressBefore) {
    if (addressBefore) rememberLocation(session, addressBefore, addressBefore);
    rememberLocation(session, session.order.legacyAddress, session.order.legacyAddress);
  }
  return found;
}

type AddressOperation = "replace" | "append" | "reference";

type AddressUpdate = {
  operation: AddressOperation;
  address?: string;
};

function commitReconciledObservations(input: {
  session: DemoSession;
  projection: DemoSession;
  candidates: ObservedEntityChanges;
  raw: string;
  acceptOrderChanges: boolean;
  semanticOwnedFields?: readonly OrderObservationField[];
}): ObservedEntityChanges {
  const { session, projection, candidates, raw } = input;
  session.customerProfile = { ...projection.customerProfile };
  if (projection.identity.salutation) {
    session.identity = { ...session.identity, salutation: projection.identity.salutation };
  }

  const proposed: OrderMutationAction[] = [];
  if (projection.order.phone && projection.order.phone !== session.order.phone) {
    proposed.push({ type: "set_phone", phone: projection.order.phone, evidence: raw });
  }
  if (
    projection.order.recipientName &&
    projection.order.recipientName !== session.order.recipientName
  ) {
    proposed.push({
      type: "set_recipient_name",
      recipientName: projection.order.recipientName,
      evidence: raw,
    });
  }
  if (
    projection.order.legacyAddress &&
    projection.order.legacyAddress !== session.order.legacyAddress
  ) {
    proposed.push({
      type: "set_address",
      address: projection.order.legacyAddress,
      operation: "replace",
      evidence: raw,
    });
  }
  if (
    projection.order.deliveryNote &&
    projection.order.deliveryNote !== session.order.deliveryNote
  ) {
    proposed.push({
      type: "set_delivery_note",
      deliveryNote: projection.order.deliveryNote,
      evidence: raw,
    });
  }

  // A field extracted by an accepted proposition is normalized and committed
  // later by applySemanticOrderUpdates. The legacy observation parser remains
  // useful as a cross-check, but must not write that same field first; doing so
  // creates a double mutation and can corrupt incremental values such as an
  // address assembled from an earlier Q1/SG mention.
  const semanticOwnedFields = new Set(input.semanticOwnedFields ?? []);
  const eligibleProposed = proposed.filter(
    (action) => !semanticOwnedFields.has(orderObservationField(action)),
  );

  const acceptedChanges: ObservedEntityChanges = {};
  if (input.acceptOrderChanges && eligibleProposed.length > 0) {
    const transaction = commitOrderMutations(session, eligibleProposed);
    if (transaction.changedFields.includes("phone") && session.order.phone) {
      acceptedChanges.phone = session.order.phone;
    }
    if (transaction.changedFields.includes("recipientName") && session.order.recipientName) {
      acceptedChanges.recipientName = session.order.recipientName;
    }
    if (transaction.changedFields.includes("deliveryNote") && session.order.deliveryNote) {
      acceptedChanges.deliveryNote = session.order.deliveryNote;
    }
    if (transaction.changedFields.includes("legacyAddress") && session.order.legacyAddress) {
      rememberLocation(session, session.order.legacyAddress, raw);
      acceptedChanges.address = session.order.legacyAddress;
    }
  } else if (eligibleProposed.length > 0) {
    session.orderTransactionTrace = {
      acceptedActions: [],
      acceptedMutations: [],
      changedFields: [],
      conflicts: [
          `observation_rejected_by_semantic_plan:${[...new Set(eligibleProposed.map((action) => action.type))].join(",")}`,
      ],
    };
  }
  if (candidates.location && (input.acceptOrderChanges || proposed.length === 0)) {
    rememberLocation(session, candidates.location, raw);
    acceptedChanges.location = candidates.location;
  }
  return acceptedChanges;
}

type OrderObservationField = "recipientName" | "phone" | "legacyAddress" | "deliveryNote";

function isOrderObservationField(value: string): value is OrderObservationField {
  return ["recipientName", "phone", "legacyAddress", "deliveryNote"].includes(value);
}

function orderObservationField(action: OrderMutationAction): OrderObservationField {
  switch (action.type) {
    case "set_recipient_name": return "recipientName";
    case "set_phone": return "phone";
    case "set_address": return "legacyAddress";
    case "set_delivery_note": return "deliveryNote";
    case "set_quantity":
    case "confirm_order":
      throw new Error(`not_an_observation_field:${action.type}`);
  }
}

function observeGlobalEntities(
  session: DemoSession,
  raw: string,
  allowOrderMutations = true,
): ObservedEntityChanges {
  const changes: ObservedEntityChanges = {};
  const text = normalize(raw);
  if (/\b(?:minh|toi|em|anh)\s+la\s+nam\b|\bnam gioi\b/.test(text)) {
    session.customerProfile.gender = "male";
    session.identity.salutation = "anh";
  } else if (/\b(?:minh|toi|em|chi)\s+la\s+nu\b|\bnu gioi\b|\bminh con gai\b/.test(text)) {
    session.customerProfile.gender = "female";
    session.identity.salutation = "chị";
  }

  const age = text.match(/\b(\d{1,3})\s*(?:tuoi|t)\b/)?.[1];
  const parsedAge = Number(age);
  if (Number.isInteger(parsedAge) && parsedAge >= 0 && parsedAge <= 120) {
    session.customerProfile.age = parsedAge;
  }

  // Strong order entities are observed globally, before deterministic routes.
  // This lets an ETA/policy question also complete a draft without letting a
  // generic phrase such as "nghe ổn đấy" become the recipient name.
  const collectingOrderBeforeTurn = Boolean(session.selectedQuantity);
  const shouldObserveOrder =
    allowOrderMutations && (collectingOrderBeforeTurn || isOrderCaptureMessage(raw));
  if (shouldObserveOrder) {
    const mayCaptureAddress = collectingOrderBeforeTurn || isOrderCaptureMessage(raw);
    const actions: OrderMutationAction[] = [];
    const normalizedPhone = normalizeVietnamesePhone(raw);
    const phone = normalizedPhone.valid && normalizedPhone.normalized
      ? normalizedPhone.normalized
      : extractPhoneNumber(raw);
    if (phone) {
      actions.push({ type: "set_phone", phone, evidence: raw });
    }
    const explicitName = extractRecipientName(raw);
    const cleanedExplicitName = explicitName ? cleanExplicitRecipientName(explicitName) : undefined;
    if (cleanedExplicitName && looksLikeOrderRecipientCandidate(cleanedExplicitName)) {
      actions.push({
        type: "set_recipient_name",
        recipientName: formatRecipientName(cleanedExplicitName),
        evidence: raw,
      });
    }
    if (phone) {
      const phoneIndex = raw.indexOf(phone);
      const beforePhone = phoneIndex >= 0 ? cleanLabel(raw.slice(0, phoneIndex).replace(/[,;:\s-]+$/gu, "")) : "";
      const afterPhone =
        phoneIndex >= 0
          ? cleanLabel(raw.slice(phoneIndex + phone.length).replace(/^[,;:\s-]+/gu, ""))
          : "";
      const combined = splitUnlabelledNameAndAddress(beforePhone);
      const candidateName = combined?.recipientName ?? beforePhone;
      if (
        !session.order.recipientName &&
        !cleanedExplicitName &&
        candidateName &&
        looksLikeOrderRecipientCandidate(candidateName)
      ) {
        actions.push({
          type: "set_recipient_name",
          recipientName: formatRecipientName(candidateName),
          evidence: raw,
        });
      }
      if (combined?.address && !session.order.legacyAddress) {
        actions.push({
          type: "set_address",
          address: canonicalizeLegacyAddress(combined.address),
          operation: "replace",
          evidence: raw,
        });
      } else if (afterPhone && !session.order.legacyAddress && isAcceptableDeliveryAddress(afterPhone)) {
        actions.push({
          type: "set_address",
          address: canonicalizeLegacyAddress(afterPhone),
          operation: "replace",
          evidence: raw,
        });
      }
    }
    const normalizedDeliveryNotes = normalizeDeliveryNotes(raw);
    const observedDeliveryNote = normalizedDeliveryNotes.valid && normalizedDeliveryNotes.normalized
      ? mergeDeliveryNotes(session.order.deliveryNote, normalizedDeliveryNotes.normalized)
      : extractDeliveryNote(raw);
    if (observedDeliveryNote) {
      actions.push({ type: "set_delivery_note", deliveryNote: observedDeliveryNote, evidence: raw });
    }
    const changedDestination = extractChangedAddress(raw);
    const explicitDestination = changedDestination ?? extractDeliveryDestination(raw);
    const standaloneOrderAddress =
      collectingOrderBeforeTurn &&
      !phone &&
      !isPriorAddressReference(raw) &&
      !explicitDestination &&
      missingLegacyAddressComponents(canonicalizeLegacyAddress(raw)).length === 0
        ? cleanAddressCandidate(raw)
        : undefined;
    const destination = explicitDestination ?? standaloneOrderAddress;
    const normalizedAddress = normalizeVietnameseAddress(raw, session.locationMemory.addressContext);
    const deterministicAddress = normalizedAddress.valid && normalizedAddress.normalized?.street
      ? formatVietnameseAddress(normalizedAddress.normalized)
      : undefined;
    const administrativeAddress = extractExplicitAdministrativeAddress(raw);
    const singleMissingAdministrativeAddress = collectingOrderBeforeTurn
      ? extractSingleMissingAdministrativeAddress(raw, session.order)
      : undefined;
    if (mayCaptureAddress && destination) {
      if (session.order.legacyAddress) {
        rememberLocation(session, session.order.legacyAddress, session.order.legacyAddress);
      }
      actions.push({
        type: "set_address",
        address: canonicalizeLegacyAddress(destination),
        operation: "replace",
        evidence: raw,
      });
    }
    if (mayCaptureAddress && deterministicAddress && !destination) {
      actions.push({
        type: "set_address",
        address: deterministicAddress,
        ...(normalizedAddress.normalized ? { structured: normalizedAddress.normalized } : {}),
        operation: session.order.legacyAddress ? "append" : "replace",
        evidence: raw,
      });
    }
    if (mayCaptureAddress && administrativeAddress && (destination || session.order.legacyAddress)) {
      actions.push({
        type: "set_address",
        address: administrativeAddress,
        operation: "append",
        evidence: raw,
      });
    }
    if (
      collectingOrderBeforeTurn &&
      singleMissingAdministrativeAddress &&
      !administrativeAddress &&
      !destination
    ) {
      actions.push({
        type: "set_address",
        address: singleMissingAdministrativeAddress,
        operation: "append",
        evidence: raw,
      });
    }

    if (actions.length > 0) {
      commitOrderMutations(session, actions);
      if (phone && session.order.phone) changes.phone = session.order.phone;
      if (actions.some((action) => action.type === "set_recipient_name") && session.order.recipientName) {
        changes.recipientName = session.order.recipientName;
      }
      if (observedDeliveryNote && session.order.deliveryNote) {
        changes.deliveryNote = session.order.deliveryNote;
      }
      if (
        (destination ||
          administrativeAddress ||
          singleMissingAdministrativeAddress ||
          deterministicAddress ||
          actions.some((action) => action.type === "set_address")) &&
        session.order.legacyAddress
      ) {
        rememberLocation(
          session,
          session.order.legacyAddress,
          destination ??
            deterministicAddress ??
            administrativeAddress ??
            singleMissingAdministrativeAddress ??
            session.order.legacyAddress,
        );
        changes.address = session.order.legacyAddress;
      }
    }
  }

  // A referential phrase ("như ban nãy") must resolve against history; it is
  // not a new literal address candidate.
  if (isPriorAddressReference(raw)) return changes;
  const changedAddress = extractChangedAddress(raw);
  const mentionedLocation = changedAddress ?? extractShippingLocationMention(raw);
  if (!mentionedLocation) return changes;
  const canonical = canonicalizeLegacyAddress(mentionedLocation);
  if (!looksLikeAddress(canonical)) return changes;
  rememberLocation(session, canonical, mentionedLocation);
  changes.location = canonical;
  return changes;
}

function rememberLocation(session: DemoSession, address: string, evidence: string): void {
  const canonical = canonicalizeLegacyAddress(address);
  const history = [...(session.locationMemory.history ?? [])];
  if (
    !history.some((item) => normalizeForComparison(item.legacyAddress) === normalizeForComparison(canonical))
  ) {
    history.push({ legacyAddress: canonical, evidence, sourceTurn: session.messages + 1 });
  }
  session.locationMemory = {
    legacyAddress: canonical,
    evidence,
    sourceTurn: session.messages + 1,
    history: history.slice(-8),
  };
}

function resolveAddressUpdate(session: DemoSession, raw: string): AddressUpdate | undefined {
  if (isPriorAddressReference(raw)) {
    const referenced = resolveRememberedAddress(session, raw);
    return {
      operation: "reference",
      ...(referenced ? { address: referenced } : {}),
    };
  }

  const changed = extractChangedAddress(raw);
  if (changed) return { operation: "replace", address: changed };

  const explicit = raw.match(/(?:địa chỉ|dia chi)\s*[:：-]\s*([^.!?\n]+)/iu)?.[1];
  if (explicit) {
    const address = cleanAddressCandidate(explicit);
    if (address) return { operation: "replace", address };
  }

  const appended = raw.match(
    /(?:bổ sung|bo sung|thêm|them)\s+(?:địa chỉ|dia chi|phường|phuong|xã|xa|quận|quan|huyện|huyen)\s*[:：-]?\s*([^.!?\n]+)/iu,
  )?.[1];
  if (appended) {
    const address = cleanAddressCandidate(appended);
    if (address) return { operation: "append", address };
  }
  return undefined;
}

export function isPriorAddressReference(raw: string): boolean {
  const text = normalize(raw);
  return (
    /\bnhu (?:minh|toi|em|anh|chi)?\s*(?:noi|gui|nhan)?\s*(?:ban nay|luc truoc|truoc do)\b|\bquay ve\b.{0,60}\bnhu ban nay\b/.test(
      text,
    ) ||
    /\b(?:gui|guit|giao|ship|chuyen|dung|lay)\b.{0,50}\b(?:ve|toi|den|theo)\b.{0,35}\b(?:tren|dia chi\s+cu|truoc|vua gui|vua noi|luc truoc|truoc do)\b/.test(
      text,
    ) ||
    /\bdia chi\b.{0,25}\b(?:van|giu)\b.{0,15}\b(?:nhu cu|nguyen|nhu luc truoc)\b|\bdia chi\b.{0,25}\bgiu nguyen\b/.test(
      text,
    )
  );
}

function resolveRememberedAddress(session: DemoSession, raw: string): string | undefined {
  const text = normalize(raw);
  const history = session.locationMemory.history ?? [];
  const currentAddress = session.order.legacyAddress;
  if (currentAddress && isPriorAddressReference(raw)) {
    const missing = missingLegacyAddressComponents(currentAddress);
    if (missing.length === 1) {
      const recentFragment = session.history
        .slice(0, -1)
        .reverse()
        .filter((turn) => turn.role === "user")
        .map((turn) => extractSingleMissingAdministrativeAddress(turn.text, session.order))
        .find((fragment): fragment is string => Boolean(fragment));
      if (recentFragment) {
        return canonicalizeLegacyAddress(`${currentAddress}, ${recentFragment}`);
      }
    }
  }
  const explicitReference = text.match(
    /(?:quay ve|tro ve|nhan o|giao ve)\s+(?:nhan\s+o\s+|o\s+)?(.+?)(?=\s+nhu ban nay|,|$)/,
  )?.[1];
  if (explicitReference) {
    const referenced = history
      .slice()
      .reverse()
      .find((item) => normalizeForComparison(item.legacyAddress).includes(explicitReference.trim()));
    if (referenced) return referenced.legacyAddress;
  }
  const named = history
    .slice()
    .reverse()
    .find((item) => {
      const tokens = normalizeForComparison(item.legacyAddress)
        .split(" ")
        .filter((token) => token.length >= 4);
      return tokens.some((token) => text.includes(token));
    });
  if (named) return named.legacyAddress;
  const latestComplete = history
    .slice()
    .reverse()
    .find((item) => missingLegacyAddressComponents(item.legacyAddress).length === 0);
  return (
    latestComplete?.legacyAddress ?? history.at(-2)?.legacyAddress ?? session.locationMemory.legacyAddress
  );
}

function extractChangedAddress(raw: string): string | undefined {
  const homeReplacement = raw.match(
    /(?:giao|ship|gửi|gui)\s+(?:về|ve)\s+(?:nhà|nha)\s+(?:mình|minh|tôi|toi)(?:\s+đi|\s+di)?\s*[,;:-]?\s*(.+?)(?=\s+(?:Vẫn|Van)\s+giữ|\s+(?:đổi|doi)\s+tên|[.!?\n]|$)/iu,
  )?.[1];
  if (homeReplacement) return cleanAddressCandidate(homeReplacement);
  const match = raw.match(
    /(?:đổi|doi|thay|chuyển|chuyen)(?:\s+(?:(?:địa chỉ|dia chi)(?:\s+(?:giao|ship))?|giao|ship))?\s+(?:sang|qua|về|ve|tới|toi|đến|den)\s+(.+?)(?=[.!?\n]|$)/iu,
  )?.[1];
  return match ? cleanAddressCandidate(match) : undefined;
}

function extractShippingLocationMention(raw: string): string | undefined {
  const direct = extractDeliveryDestination(raw);
  if (direct) return direct;
  const match = raw.match(
    /(?:^|[,.]\s*|\s)(?:ở|o)\s+([^,.!?\n]{2,80}?)(?=\s+(?:thì|thi)\s+(?:ship|giao|nhận|nhan)|[,.!?\n]|$)/iu,
  )?.[1];
  if (match) return cleanAddressCandidate(match);
  const text = normalize(raw);
  if (/\b(?:ship|giao|nhan)\b/.test(text) && /\bha noi\b/.test(text)) return "Hà Nội";
  return undefined;
}

function cleanAddressCandidate(value: string): string | undefined {
  const cleaned = value
    .replace(
      /^(?:địa chỉ|dia chi|công ty(?:\s+(?:của\s+)?(?:mình|tôi|chồng mình|vợ mình))?\s+ở|cong ty(?:\s+(?:cua\s+)?(?:minh|toi|chong minh|vo minh))?\s+o|cơ quan(?:\s+của)?\s+(?:mình|minh|tôi|toi)\s+ở|co quan(?:\s+cua)?\s+(?:minh|toi)\s+o|nhà\s+(?:mình|tôi)\s+ở|nha\s+(?:minh|toi)\s+o)\s*/iu,
      "",
    )
    .replace(/\s+(?:nhé|nhe|nha|ạ|a|ấy|ay|giúp mình|giup minh)\s*$/iu, "")
    .replace(/[.;,\s]+$/gu, "")
    .trim();
  if (!cleaned || cleaned.length > 160) return undefined;
  const canonical = canonicalizeLegacyAddress(cleaned);
  return looksLikeAddress(canonical) ? canonical : undefined;
}

function mergeRetailEscapeOrderData(session: DemoSession, raw: string): void {
  const phone = extractPhoneNumber(raw);
  const deliveryNote = extractDeliveryNote(raw);
  const actions: OrderMutationAction[] = [];
  if (phone) actions.push({ type: "set_phone", phone, evidence: raw });
  if (deliveryNote) {
    actions.push({ type: "set_delivery_note", deliveryNote, evidence: raw });
  }
  if (actions.length > 0) commitOrderMutations(session, actions);
}

export function extractPhoneNumber(raw: string): string | undefined {
  const direct = raw.match(/(?<!\d)(0\d{9})(?!\d)/u)?.[1];
  if (direct) return direct;
  const normalizedRaw = normalize(raw)
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  const label = normalizedRaw.match(/\b(?:sdt|so dien thoai)\b/);
  if (!label || label.index === undefined) return undefined;
  const spoken = normalizedRaw.slice(label.index + label[0].length).split(/\bten(?: nguoi nhan)?\b/, 1)[0];
  if (!spoken) return undefined;
  const digitWords: Record<string, string> = {
    khong: "0",
    mot: "1",
    hai: "2",
    ba: "3",
    bon: "4",
    tu: "4",
    nam: "5",
    sau: "6",
    bay: "7",
    tam: "8",
    chin: "9",
  };
  const digits = normalize(spoken)
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .map((token) => digitWords[token])
    .filter((token): token is string => token !== undefined)
    .join("");
  return /^0\d{9}$/.test(digits) ? digits : undefined;
}

function extractRetailEscapeDestination(raw: string): string | undefined {
  const match = raw.match(
    /(?:ship|giao|gửi|gui)\s+(?:về|ve|đến|den)\s+(.+?)(?=(?:[.;]\s*)?(?:SĐT|SDT|số điện thoại|so dien thoai|0\d{9})|[!?]|$)/iu,
  )?.[1];
  if (!match) return undefined;
  return match.replace(/[.;,\s]+$/gu, "").trim();
}

function stripOrderSelectionPrefix(raw: string): string {
  return raw
    .replace(
      /^\s*(?:(?:cho|gửi|gui|lấy|lay|chốt|chot)\s+(?:anh|chị|chi|em|mình|minh)\s+)?(?:(?:anh|chị|chi|em|mình|minh)\s+)?(?:lấy|lay|chọn|chon|chốt|chot|gửi|gui)?\s*(?:combo\s*)?(?:1|một|mot|2|hai)?\s*lọ?\s*[-,;:]?\s*/iu,
      "",
    )
    .replace(/^\s*(?:freeship|free ship|miễn phí (?:giao|ship))\s*(?:nhé|nhe|ạ|a)?\s*[-,;:]?\s*/iu, "")
    .trim();
}

export function extractDeliveryDestination(raw: string): string | undefined {
  if (isPriorAddressReference(raw)) return undefined;
  const match = raw
    .match(
      /(?:^|[\s,.])(?:(?:gửi|gui|giao|ship|lấy|lay|chốt|chot|đặt|dat)(?=\s)|cho\s+(?:mình|minh|tôi|toi|anh|chị|chi|em)\b)[^.!?\n]{0,80}?(?:về|ve|tới|toi|đến|den)\s+([^.!?\n]+?)(?=\s+(?:SĐT|SDT|số điện thoại|so dien thoai|Tên|Ten)\b|\s+(?:nhé|nhe|ạ|a)\b|[.!?\n]|$)/iu,
    )?.[1]
    ?.trim();
  if (!match) return undefined;
  const destination = match
    .replace(/\s+(?:cho\s+(?:anh|chị|chi|em|mình|minh)\s+)?(?:nhé|nhe|ạ|a)\s*$/iu, "")
    .replace(/\s+cho\s+(?:anh|chị|chi|em|mình|minh)\s*$/iu, "")
    .replace(/\s+(?:mất|mat)?\s*(?:bao lâu|bao lau|mấy ngày|may ngay|khi nào|khi nao|bao giờ|bao gio).*$/iu, "")
    .trim();
  const normalized = normalize(destination);
  if (normalized === "cau giay" || normalized === "quan cau giay") {
    return "Quận Cầu Giấy, Hà Nội";
  }
  // “Chung cư + mã tòa + khu đô thị” is a complete Vietnamese delivery
  // detail even when it contains no literal street/ward prefix.
  if (/\bchung cu\b/.test(normalized) && /\d/.test(normalized)) {
    return canonicalizeLegacyAddress(destination);
  }
  return cleanAddressCandidate(destination);
}

function extractDeliveryNote(raw: string): string | undefined {
  const normalized = normalize(raw);
  if (/\b(?:gio hanh chinh|trong gio hanh chinh)\b/.test(normalized)) {
    return "Gọi và giao trong giờ hành chính";
  }
  const explicit = raw.match(/(?:ghi chú|ghi chu|note)\s*[:：-]?\s*([^.!?\n]+)/iu)?.[1]?.trim();
  return explicit ? explicit.slice(0, 160) : undefined;
}

function extractBareWard(raw: string): string | undefined {
  const ward = raw
    .match(/(?:phường|phuong)\s+([\p{L}\s]{2,60}?)(?=\s+(?:nhé|nhe|nha|ạ|a)\b|[,;.?!\n]|$)/iu)?.[1]
    ?.trim();
  return ward?.replace(/\s+(?:nhé|nhe|nha|ạ|a)\s*$/iu, "").trim() || undefined;
}

function extractExplicitAdministrativeAddress(raw: string): string | undefined {
  const ward = extractBareWard(raw);
  const district = raw
    .match(
      /(?:quận|quan|huyện|huyen|thị xã|thi xa)\s+([\p{L}\s]{2,60}?)(?=\s+(?:nhé|nhe|nha|ạ|a)\b|[,;.?!\n]|$)/iu,
    )?.[1]
    ?.replace(/\s+(?:nhé|nhe|nha|ạ|a)\s*$/iu, "")
    .trim();
  const parts: string[] = [];
  if (ward) parts.push(`Phường ${ward}`);
  if (district) parts.push(`Quận ${district}`);
  return parts.length > 0 ? parts.join(", ") : undefined;
}

function isLikelyOrderData(raw: string, order: OrderDraft): boolean {
  if (/(?<!\d)0\d{9}(?!\d)/.test(raw)) return true;
  if (/(?:ten|tên)\s*(?:nguoi nhan|người nhận)?\s*[:-]/i.test(raw)) return true;
  if (/(?:sdt|sđt|so dien thoai|số điện thoại)\s*[:-]/i.test(raw)) return true;
  if (/(?:dia chi|địa chỉ)\s*[:-]/i.test(raw)) return true;
  if (parseAdministrativeAddressFragment(raw, order)) return true;
  if (!order.legacyAddress && looksLikeAddress(raw)) return true;

  const parts = raw
    .split(/[,;\n]/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length >= 2 && parts.some((part) => looksLikeAddress(part))) return true;

  if (!order.recipientName && parts.length === 1) {
    return (
      looksLikeRecipientName(raw) && looksLikeStandaloneRecipientName(raw) && !looksLikeCustomerQuestion(raw)
    );
  }
  return false;
}

function parseAdministrativeAddressFragment(
  raw: string,
  order: OrderDraft,
): { ward: string; district: string } | undefined {
  const missing = missingLegacyAddressComponents(order.legacyAddress);
  if (
    !order.legacyAddress ||
    !missing.includes("ward") ||
    !missing.includes("district") ||
    looksLikeCustomerQuestion(raw)
  ) {
    return undefined;
  }
  const parts = raw
    .split(/[,;]/u)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length !== 2) return undefined;
  if (
    parts.some((part) =>
      /^(?:phường|phuong|xã|xa|thị trấn|thi tran|quận|quan|huyện|huyen|thị xã|thi xa)\b/iu.test(part),
    )
  ) {
    return undefined;
  }
  if (
    parts.some((part) => !/^[\p{L}\s.-]{2,60}$/u.test(part) || part.split(/\s+/u).filter(Boolean).length > 6)
  ) {
    return undefined;
  }
  const [ward, district] = parts;
  if (!ward || !district) return undefined;
  return {
    ward: formatAdministrativeName(ward),
    district: formatAdministrativeName(district),
  };
}

function extractSingleMissingAdministrativeAddress(raw: string, order: OrderDraft): string | undefined {
  if (!order.recipientName || !/^0\d{9}$/u.test(order.phone ?? "") || !order.quantity) {
    return undefined;
  }
  const missing = missingLegacyAddressComponents(order.legacyAddress);
  if (missing.length !== 1 || looksLikeCustomerQuestion(raw)) return undefined;
  const [component] = missing;
  if (component !== "ward" && component !== "district" && component !== "province") {
    return undefined;
  }
  const compact = raw.replace(/\s+/gu, " ").trim();
  if (
    !/^[\p{L}\s.-]{2,60}$/u.test(compact) ||
    /^(?:phường|phuong|xã|xa|thị trấn|thi tran|quận|quan|huyện|huyen|thị xã|thi xa|tỉnh|tinh|thành phố|thanh pho)\b/iu.test(
      compact,
    )
  ) {
    return undefined;
  }
  const normalized = normalize(compact);
  const words = normalized.split(/\s+/u).filter(Boolean);
  if (
    words.length < 2 ||
    words.length > 6 ||
    /\b(?:cam on|ok|uh|u|vang|da|dung|sai|khong|chua|thoi|minh|toi|em|anh|chi|shop|nhe|nha|gia|ship|combo|san pham|mo hoi|mui)\b/u.test(
      normalized,
    )
  ) {
    return undefined;
  }
  const value = formatAdministrativeName(compact);
  if (component === "ward") return `Phường/xã ${value}`;
  if (component === "district") return `Quận/huyện ${value}`;
  return `Tỉnh/thành phố ${value}`;
}

function formatAdministrativeName(value: string): string {
  return value
    .trim()
    .split(/\s+/u)
    .map((part) => part.charAt(0).toLocaleUpperCase("vi-VN") + part.slice(1).toLocaleLowerCase("vi-VN"))
    .join(" ");
}

function looksLikeCustomerQuestion(raw: string): boolean {
  const text = normalize(raw);
  return (
    /(?:\?| khong$| ko$| k$| duoc khong| dc k| nua k| sao$)/.test(text) ||
    /\b(gia|giam|ship|free|combo|san pham|dung|lan|boi|hieu qua|mui|mo hoi|rat|ngua|an toan|bao hanh|doi tra|giao hang)\b/.test(
      text,
    )
  );
}

export function isLikelyAdministrativeFragment(raw: string): boolean {
  const normalized = normalize(raw);
  if (
    !normalized ||
    looksLikeCustomerQuestion(raw) ||
    /\b(?:thoi tiet|hom nay|the nao|la gi|vi sao|prompt|cho .* biet|cua (?:anh|chi|em|toi|minh))\b/.test(
      normalized,
    )
  ) {
    return false;
  }
  const commaParts = raw
    .split(/[,;]/u)
    .map((part) => part.trim())
    .filter(Boolean);
  if (commaParts.length === 2 && commaParts.every((part) => /^[\p{L}\s.-]{2,60}$/u.test(part))) {
    return true;
  }
  const words = normalized.split(/\s+/u).filter(Boolean);
  if (words.length < 3 || words.length > 10) return false;
  for (let size = 1; size <= Math.floor((words.length - 1) / 2); size += 1) {
    if (words.slice(0, size).join(" ") === words.slice(words.length - size).join(" ")) {
      return true;
    }
  }
  return false;
}

export function isOrderCaptureMessage(value: string): boolean {
  const text = normalize(value);
  const hasPurchase =
    /\b(?:cho|gui|lay|chot|dat|mua)\b.{0,30}\b(?:[1-5]|mot|hai|ba|bon|nam)\s+(?:lo|hop)\b/.test(text);
  const hasPhone = /(?<!\d)0\d{9}(?!\d)/u.test(value);
  const hasDestination = /\b(?:ve|giao den|gui den)\b/.test(text) && /\d/u.test(value);
  return hasPurchase && hasPhone && hasDestination;
}

function cleanLabel(value: string): string {
  return value
    .replace(/^(ten|tên|sdt|sđt|so dien thoai|số điện thoại|dia chi|địa chỉ)\s*[:-]?\s*/i, "")
    .trim();
}

function looksLikeRecipientName(value: string): boolean {
  return /^[a-zA-ZÀ-ỹĐđ\s]{2,50}$/u.test(value) && value.trim().split(/\s+/).length <= 6;
}

function cleanExplicitRecipientName(value: string): string {
  return value.replace(/\s+(?:nhé|nhe|ạ|a)\s*$/iu, "").trim();
}

/**
 * Extracts only an explicitly labelled recipient name. This observer is
 * intentionally independent from intent so a message can complete an order
 * while also asking a product or delivery question.
 */
function extractRecipientName(raw: string): string | undefined {
  if (
    /\b(?:nguoi nhan|ten nguoi nhan)\b.{0,25}\b(?:ai|gi|nhi)\b/.test(normalize(raw))
  ) {
    return undefined;
  }
  const recipientLabel = raw.match(
    /(?:^|[.!?]\s*)(?:tên\s+người nhận|ten\s+nguoi nhan|người nhận|nguoi nhan)\s*(?:(?:là|la|tên|ten)\s+|[:：-]\s*)([\p{L}][\p{L}\s]{0,48}?)(?=[,;.?!\n]|\s+(?:nhé|nhe|nha|ạ|a)\b|$)/iu,
  )?.[1];
  const changedName = raw.match(
    /(?:đổi|doi)\s+(?:tên|ten)(?:\s+(?:người nhận|nguoi nhan))?\s+(?:thành|thanh|là|la)\s+([\p{L}][\p{L}\s]{0,48}?)(?=[,;.?!\n]|\s+(?:nhé|nhe|nha|ạ|a)\b|$)/iu,
  )?.[1];
  const match =
    recipientLabel ??
    changedName ??
    raw.match(
      /(?:^|[.!?]\s*)(?:(?:mình|minh|tôi|toi|em|anh|chị|chi)\s+)?(?:đổi|doi)?\s*(?:tên|ten)(?:\s+(?:người nhận|nguoi nhan))?\s*(?:(?:là|la|thành|thanh)\s+|[:：-]\s*)?([\p{L}][\p{L}\s]{0,48}?)(?=[,;.?!\n]|\s+(?:nhé|nhe|nha|ạ|a)\b|$)/iu,
    )?.[1];
  if (!match) return undefined;
  const cleaned = cleanExplicitRecipientName(match);
  return looksLikeOrderRecipientCandidate(cleaned) ? cleaned : undefined;
}

function looksLikeOrderRecipientCandidate(value: string): boolean {
  if (!looksLikeRecipientName(value)) return false;
  const text = normalize(value);
  return !/\b(?:khoan|thoi|nghe|on|the|chot|lay|chon|mua|dat|gui|giao|ship|ve|dung thu|sdt|dia chi|nhe|nha|shop)\b/.test(
    text,
  );
}

function looksLikeStandaloneRecipientName(value: string): boolean {
  const words = value.trim().split(/\s+/).filter(Boolean);
  if (words.length < 2 || words.length > 5) return false;
  const normalized = normalize(value);
  if (/\b(y|kia|nay|co|shop|san pham|dung|duoc|khong|sao|nhe|nha|a)\b/.test(normalized)) {
    return false;
  }
  const commonSurname = /^(nguyen|tran|le|pham|hoang|huynh|phan|vu|vo|dang|bui|do|ho|ngo|duong|ly)\b/.test(
    normalized,
  );
  const capitalizedWords = words.filter((word) => /^\p{Lu}/u.test(word)).length;
  return commonSurname || capitalizedWords >= 2;
}

function splitUnlabelledNameAndAddress(
  value: string,
): { recipientName: string; address: string } | undefined {
  const firstDigit = value.search(/\d/u);
  if (firstDigit <= 0) return undefined;
  const prefix = value.slice(0, firstDigit).trim();
  const numericAddress = value.slice(firstDigit).trim();
  const prefixWords = prefix.split(/\s+/u).filter(Boolean);
  if (prefixWords.length < 2) return undefined;

  const possibleAddressAbbreviation = prefixWords.at(-1);
  const addressHasLeadingAbbreviation = Boolean(
    possibleAddressAbbreviation &&
    /^[A-ZĐ]{2,6}$/u.test(possibleAddressAbbreviation) &&
    prefixWords.length >= 3,
  );
  const recipientWords = addressHasLeadingAbbreviation ? prefixWords.slice(0, -1) : prefixWords;
  const recipientName = recipientWords.join(" ");
  const address = [addressHasLeadingAbbreviation ? possibleAddressAbbreviation : undefined, numericAddress]
    .filter(Boolean)
    .join(" ");
  const strongAbbreviatedAddress =
    addressHasLeadingAbbreviation &&
    /\d/u.test(address) &&
    /\b(?:Hà Nội|Ha Noi|Hồ Chí Minh|Ho Chi Minh|Hải Phòng|Hai Phong|Đà Nẵng|Da Nang|Cần Thơ|Can Tho|Huế|Hue)\b/iu.test(
      address,
    );
  if (!looksLikeOrderRecipientCandidate(recipientName) || (!looksLikeAddress(address) && !strongAbbreviatedAddress)) {
    return undefined;
  }
  return { recipientName, address };
}

function looksLikeAddress(value: string): boolean {
  const normalized = value
    .toLocaleLowerCase("vi-VN")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/đ/g, "d");
  if (looksLikeCustomerQuestion(value)) return false;
  if (
    /\b(?:sdt|so dien thoai|nho note|ghi chu|gio hanh chinh|lay\s+[1-5]\s+lo|chot\s+[1-5]\s+lo|doi giao)\b/.test(
      normalized,
    )
  ) {
    return false;
  }
  const hasAddressWord =
    /\b(so|duong|pho|ngo|ngach|hem|thon|xom|ap|to|khu|chung cu|toa nha|phuong|xa|thi tran|quan|huyen|thi xa|tinh|thanh pho|ha noi|ho chi minh|hai phong|da nang|can tho|hue|nam tu liem|hoang mai|dinh cong)\b/.test(
      normalized,
    );
  const hasStreetNumberAndName =
    /\d/.test(normalized) &&
    normalized
      .replace(/\d+/g, " ")
      .split(/\s+/)
      .filter((part) => /^[a-z]{2,}$/i.test(part)).length >= 2;
  return value.trim().length >= 4 && (hasAddressWord || hasStreetNumberAndName);
}

function isAcceptableDeliveryAddress(value: string): boolean {
  const canonical = canonicalizeLegacyAddress(value);
  return looksLikeAddress(canonical) || missingLegacyAddressComponents(canonical).length === 0;
}

function stripRepeatedRecipientName(value: string, recipientName?: string): string {
  if (!recipientName) return value.trim();
  const normalizedName = recipientName.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return value.replace(new RegExp(`^${normalizedName}\\s*[,;:\\-]?\\s*`, "iu"), "").trim();
}

function commitLegacyAddress(
  session: DemoSession,
  candidate: string,
  operation: "replace" | "append",
  evidence: string,
): boolean {
  const cleaned = cleanLabel(candidate);
  if (cleaned.length > 160 || !isAcceptableDeliveryAddress(cleaned)) return false;
  const canonical = canonicalizeLegacyAddress(cleaned);
  const before = session.order.legacyAddress;
  commitOrderMutations(session, [{ type: "set_address", address: canonical, operation, evidence }]);
  return session.order.legacyAddress !== before;
}

function canonicalizeLegacyAddress(value: string): string {
  const normalizedValue = normalizeForComparison(value);
  const expanded = value
    .replace(/(?:^|,\s*)HN\.?\s*$/iu, ", Hà Nội")
    .replace(
      /([\p{L}\d])\s+(Hà Nội|TP\.?\s*HCM|TP\.?\s*Hồ Chí Minh|Hồ Chí Minh|Hải Phòng|Đà Nẵng|Cần Thơ|Huế|Tỉnh\s+[\p{L}\s]+)$/iu,
      "$1, $2",
    )
    .replace(
      /(?<!Quận)\s+(Hà Đông|Cầu Giấy|Hoàng Mai|Nam Từ Liêm|Thanh Xuân|Ba Đình|Hai Bà Trưng)\s*,\s*(Hà Nội)$/iu,
      ", Quận $1, $2",
    )
    .replace(/^,\s*/, "");
  const segments = expanded
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  const hasHaDong = segments.some((segment) => normalizeForComparison(segment) === "ha dong");
  const hasCauGiay = segments.some((segment) =>
    ["cau giay", "quan cau giay"].includes(normalizeForComparison(segment)),
  );
  const hasDinhCong = segments.some((segment) =>
    /(?:^| )dinh cong(?: |$)/.test(normalizeForComparison(segment)),
  );
  const hasHoangMai = segments.some((segment) =>
    ["hoang mai", "quan hoang mai"].includes(normalizeForComparison(segment)),
  );
  const hasNamTuLiem = segments.some((segment) =>
    ["nam tu liem", "quan nam tu liem"].includes(normalizeForComparison(segment)),
  );
  const hasThanhXuan = segments.some((segment) =>
    ["thanh xuan", "quan thanh xuan"].includes(normalizeForComparison(segment)),
  );
  const hasBaDinh = segments.some((segment) =>
    ["ba dinh", "quan ba dinh"].includes(normalizeForComparison(segment)),
  );
  const hasHaiBaTrung = segments.some((segment) =>
    ["hai ba trung", "quan hai ba trung"].includes(normalizeForComparison(segment)),
  );
  const hasLinhDam = /(?:^| )linh dam(?: |$)/.test(normalizedValue);
  if (hasLinhDam && !segments.some((segment) => normalizeForComparison(segment) === "phuong hoang liet")) {
    segments.push("Phường Hoàng Liệt");
  }
  if (hasLinhDam && !segments.some((segment) => normalizeForComparison(segment) === "quan hoang mai")) {
    segments.push("Quận Hoàng Mai");
  }
  if (hasDinhCong && !segments.some((segment) => normalizeForComparison(segment) === "phuong dinh cong")) {
    segments.push("Phường Định Công");
  }
  if (
    (hasHaDong ||
      hasCauGiay ||
      hasHoangMai ||
      hasNamTuLiem ||
      hasThanhXuan ||
      hasBaDinh ||
      hasHaiBaTrung ||
      hasLinhDam) &&
    !segments.some((segment) => normalizeForComparison(segment) === "ha noi")
  ) {
    segments.push("Hà Nội");
  }
  const hasDaNang = segments.some((segment) => normalizeForComparison(segment) === "da nang");
  const uniqueSegments = segments.filter(
    (segment, index, all) =>
      all.findIndex((candidate) => normalizeForComparison(candidate) === normalizeForComparison(segment)) ===
      index,
  );
  return uniqueSegments
    .map((segment) =>
      hasDaNang && normalizeForComparison(segment) === "hai chau"
        ? "Quận Hải Châu"
        : normalizeForComparison(segment) === "van phu"
          ? "Phường Văn Phú"
          : normalizeForComparison(segment) === "ha dong"
            ? "Quận Hà Đông"
            : normalizeForComparison(segment) === "cau giay"
              ? "Quận Cầu Giấy"
              : normalizeForComparison(segment) === "hoang mai"
                ? "Quận Hoàng Mai"
                : normalizeForComparison(segment) === "nam tu liem"
                  ? "Quận Nam Từ Liêm"
                  : normalizeForComparison(segment) === "thanh xuan"
                    ? "Quận Thanh Xuân"
                    : normalizeForComparison(segment) === "ba dinh"
                      ? "Quận Ba Đình"
                      : normalizeForComparison(segment) === "hai ba trung"
                        ? "Quận Hai Bà Trưng"
                        : normalizeForComparison(segment) === "cong vi"
                          ? "Phường Cống Vị"
                          : normalizeForComparison(segment) === "vinh tuy"
                            ? "Phường Vĩnh Tuy"
                            : segment,
    )
    .map((segment, index) => ({ segment, index, rank: addressSegmentRank(segment) }))
    .sort((left, right) => left.rank - right.rank || left.index - right.index)
    .map(({ segment }) => segment)
    .join(", ");
}

function addressSegmentRank(value: string): number {
  const normalized = normalizeForComparison(value);
  if (/^(phuong|xa|thi tran|p|x)\b/.test(normalized)) return 1;
  if (/^(quan|huyen|thi xa)\b/.test(normalized)) return 2;
  if (/^(tinh|ha noi|ho chi minh|tp hcm|tp ho chi minh|hai phong|da nang|can tho|hue)\b/.test(normalized)) {
    return 3;
  }
  return 0;
}

function formatRecipientName(value: string): string {
  return value
    .trim()
    .split(/\s+/)
    .map((part) => part.charAt(0).toLocaleUpperCase("vi-VN") + part.slice(1).toLocaleLowerCase("vi-VN"))
    .join(" ");
}

function normalizeForComparison(value: string): string {
  return value
    .toLocaleLowerCase("vi-VN")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/đ/g, "d")
    .replace(/[^\p{L}\d]+/gu, " ")
    .trim();
}

function orderHasAllFields(order: OrderDraft): boolean {
  return missingOrderFields(order).length === 0;
}

function orderCollectionReply(session: DemoSession, raw = ""): string {
  applyProfileRecipientFallback(session, raw);
  if (orderHasAllFields(session.order)) {
    const updatingExistingOrder =
      session.orderConfirmationMode === "inbox" &&
      session.orderEditable === true &&
      Boolean(session.order.customerConfirmedAt) &&
      hasOrderTransactionChanges(session);
    const selected = quote(session.selectedQuantity ?? 1);
    const shippingFeeVnd =
      session.selectedQuantity === 1 && session.freeShippingApproved ? 0 : selected.shippingFee.amount;
    if (session.orderConfirmationMode === "inbox") {
      receiveCompleteInboxOrder(session, raw);
      if (updatingExistingOrder) return orderUpdatedReply(session);
      return formatInboxOrderReceipt(session.order, {
        productPriceVnd: selected.productPrice.amount,
        shippingFeeVnd,
      });
    }
    return `Dạ em tổng hợp đơn hàng như sau:\n${formatOrderConfirmation(session.order, {
      productPriceVnd: selected.productPrice.amount,
      shippingFeeVnd,
    })}`;
  }
  const labels: Record<string, string> = {
    recipientName: "Tên người nhận",
    phone: "SĐT 10 số",
    legacyAddress: "Địa chỉ giao hàng",
    sku: "Sản phẩm",
    quantity: "Số lượng",
    totalVnd: "Tổng tiền",
    paymentMethod: "Thanh toán",
  };
  const missingFields = missingOrderFields(session.order);
  const invalidPhoneLength = invalidPhoneDigitCount(raw);
  const missing = missingFields
    .filter((field) => field !== "legacyAddress")
    .map((field) =>
      field === "phone" && invalidPhoneLength
        ? `SĐT đủ 10 số (số vừa gửi có ${invalidPhoneLength} chữ số)`
        : (labels[field] ?? field),
    );
  const addressParts: Record<string, string> = {
    detail: "số nhà/đường/thôn",
    ward: "phường/xã/thị trấn",
    district: "quận/huyện/thị xã",
    province: "tỉnh/thành phố",
  };
  if (missingFields.includes("legacyAddress")) {
    const addressMissing = missingLegacyAddressComponents(session.order.legacyAddress).map(
      (part) => addressParts[part] ?? part,
    );
    missing.push(`địa chỉ trước sáp nhập còn thiếu ${addressMissing.join(", ")}`);
  }
  const recorded = [
    session.selectedQuantity ? quantityLabel(session.selectedQuantity) : undefined,
    session.selectedQuantity && stopirexGiftForQuantity(session.selectedQuantity)
      ? `quà tặng ${stopirexGiftForQuantity(session.selectedQuantity)} (1 túi/đơn)`
      : undefined,
    session.order.recipientName ? `tên người nhận ${session.order.recipientName}` : undefined,
    session.order.phone ? `SĐT ${session.order.phone}` : undefined,
    session.order.legacyAddress ? `địa chỉ ${session.order.legacyAddress}` : undefined,
    session.order.deliveryNote ? `ghi chú “${session.order.deliveryNote}”` : undefined,
  ].filter((item): item is string => Boolean(item));
  if (raw && isOrderRecapRequest(normalize(raw)) && session.selectedQuantity) {
    const selected = quote(session.selectedQuantity);
    const shippingFeeVnd =
      session.selectedQuantity === 1 && session.freeShippingApproved ? 0 : selected.shippingFee.amount;
    const totalVnd = selected.productPrice.amount + shippingFeeVnd;
    const recap = [
      `Dạ em đọc lại đơn: ${quantityLabel(session.selectedQuantity)}, tổng ${formatVnd(totalVnd)}${
        shippingFeeVnd > 0 ? ` (đã gồm ${formatVnd(shippingFeeVnd)} phí giao)` : ", miễn phí giao"
      } ạ.`,
      session.order.phone ? `SĐT: ${session.order.phone}.` : undefined,
      session.order.legacyAddress ? `Giao tới: ${session.order.legacyAddress}.` : undefined,
      missing.length > 0
        ? `Em còn thiếu ${missing.join(", ")}; khi tiện mình gửi bổ sung giúp em ạ.`
        : undefined,
      /\b(?:di hop|vao hop|hop)\b/.test(normalize(raw)) ? "Chúc mình họp thuận lợi ạ." : undefined,
    ].filter((item): item is string => Boolean(item));
    return recap.join("\n");
  }
  const acknowledgement = recorded.length
    ? `Dạ em đã ghi nhận ${recorded.join("; ")} ạ.`
    : "Dạ em đã ghi nhận thông tin vừa gửi.";
  return `${acknowledgement}\n\nMình bổ sung giúp em:\n• ${missing.join("\n• ")} ạ.`;
}

function applyProfileRecipientFallback(session: DemoSession, evidence: string): void {
  if (!session.selectedQuantity || session.order.recipientName) return;
  const profileName = session.identity.customerDisplayName?.trim();
  if (!profileName || !looksLikeOrderRecipientCandidate(profileName)) return;
  commitOrderMutations(session, [
    {
      type: "set_recipient_name",
      recipientName: formatRecipientName(profileName),
      evidence: evidence || "Tên hồ sơ Facebook của khách đang nhắn",
      source: "facebook_profile",
      confidence: 1,
    },
  ]);
}

function receiveCompleteInboxOrder(session: DemoSession, evidence: string): void {
  if (!session.order.customerConfirmedAt) {
    commitOrderMutations(session, [
      {
        type: "confirm_order",
        confirmedAt: new Date(),
        evidence: evidence || "Khách đã gửi đủ thông tin đơn hàng",
      },
    ]);
  }
  assertOrderReady(session.order);
  delete session.pendingAction;
  if (session.lastDecision) delete session.lastDecision.pendingActionAfter;
  session.orderCollectionPaused = false;
  session.pipeline = "6.Đã tạo đơn";
  session.consultation = { ...session.consultation, stage: "S8.order" };
  session.signal = undefined;
  session.lastIntent = "buying";
  session.orderEditable = true;
  session.activeSkill = "order-closing";
  session.skillReason =
    "Khách đã gửi đủ dữ liệu; hệ thống tiếp nhận đơn ngay và gửi bản tóm tắt để khách đối chiếu.";
}

function formatInboxOrderReceipt(order: OrderDraft, price: OrderPriceBreakdown): string {
  return [
    "Dạ em đã nhận đủ thông tin và ghi nhận đơn của mình rồi ạ ✅",
    `Người nhận: ${order.recipientName} – ${order.phone}`,
    `Địa chỉ: ${order.legacyAddress}`,
    `Sản phẩm: ${order.sku} × ${order.quantity}`,
    `Tiền hàng: ${price.productPriceVnd.toLocaleString("vi-VN")}đ`,
    `Phí giao: ${price.shippingFeeVnd === 0 ? "Miễn phí" : `${price.shippingFeeVnd.toLocaleString("vi-VN")}đ`}`,
    ...(order.quantity !== undefined && order.quantity >= 2
      ? ["Quà tặng: 1 túi đa năng vải dệt Stopirex (1 túi/đơn)"]
      : []),
    `Tổng thanh toán: ${order.totalVnd?.toLocaleString("vi-VN")}đ (${order.paymentMethod === "bank_transfer" ? "Chuyển khoản" : "COD"})`,
    "Khi có mã vận đơn, bên em sẽ gửi lại để mình theo dõi ạ.",
  ].join("\n");
}

function invalidPhoneDigitCount(raw: string): number | undefined {
  const candidate = raw.match(/(?<!\d)(0\d{7,10})(?!\d)/u)?.[1];
  return candidate && candidate.length !== 10 ? candidate.length : undefined;
}

function orderCollectionClarificationReply(session: DemoSession): string {
  const missing = missingOrderFields(session.order);
  const prompts: string[] = [];
  if (missing.includes("recipientName")) prompts.push("Tên người nhận");
  if (missing.includes("phone")) prompts.push("SĐT 10 số");
  if (missing.includes("legacyAddress")) {
    prompts.push("địa chỉ trước sáp nhập đầy đủ số nhà/đường/thôn, phường/xã, quận/huyện và tỉnh/thành phố");
  }
  return `Dạ em chưa thấy thông tin đơn trong tin nhắn vừa rồi ạ.\n\nMình gửi giúp em: ${prompts.join(", ")} ạ.`;
}

function compoundOrderUpdateReply(session: DemoSession, raw: string): string {
  const inspection = /kiểm tra|kiem tra|kiểm hàng|kiem hang|mở hàng|mo hang/iu.test(raw);
  const deliveryEta = /bao giờ|bao gio|khi nào|khi nao|bao lâu|bao lau|mấy ngày|may ngay/iu.test(raw);
  const destination = session.order.legacyAddress
    ? ` và đã ghi nhận khu vực ${session.order.legacyAddress}`
    : "";
  const first = `Dạ được ạ, em đã đổi sang ${quantityLabel(session.selectedQuantity ?? 1)}${destination}.`;
  const policy = inspection
    ? " Khi nhận, mình kiểm tra bao bì, tem và thông tin người gửi trước khi thanh toán; nếu không đúng thông tin Stopirex, mình có quyền từ chối nhận ạ."
    : "";
  const eta = deliveryEta ? "Thời gian giao cụ thể em sẽ báo theo vận đơn sau khi lên đơn. " : "";
  const missing = missingOrderFields(session.order);
  const prompts: string[] = [];
  if (missing.includes("recipientName")) prompts.push("tên người nhận");
  if (missing.includes("phone")) prompts.push("SĐT");
  if (missing.includes("legacyAddress")) {
    const addressLabels: Record<string, string> = {
      detail: "số nhà/đường/thôn",
      ward: "phường/xã/thị trấn",
      district: "quận/huyện/thị xã",
      province: "tỉnh/thành phố",
    };
    prompts.push(
      ...missingLegacyAddressComponents(session.order.legacyAddress).map(
        (part) => addressLabels[part] ?? part,
      ),
    );
  }
  const request = prompts.length
    ? `Mình gửi thêm ${prompts.join(", ")} giúp em ạ.`
    : "Mình kiểm tra lại thông tin đơn giúp em nhé ạ.";
  return `${first}${policy}\n\n${eta}${request}`;
}

function contextualOrderClarificationReply(session: DemoSession, raw: string): string {
  const compact = raw.replace(/\s+/gu, " ").trim().slice(0, 120);
  const quoted = compact ? `“${compact}”` : "phần mình vừa gửi";
  const normalized = normalize(compact);
  if (/\b(ship|phi giao|phi ship|giao hang|freeship|free ship)\b/.test(normalized)) {
    return `Dạ em chưa hiểu chắc ý ${quoted} ạ. Mình đang hỏi về phí giao hàng, hay đang bổ sung phần địa chỉ giao hàng giúp em ạ?`;
  }
  if (/\b(gia|giam|khuyen mai|uu dai|ma giam|voucher)\b/.test(normalized)) {
    return `Dạ em chưa hiểu chắc ý ${quoted} ạ. Mình nói rõ giúp em đang hỏi giá sản phẩm hay chương trình ưu đãi nào nhé ạ.`;
  }

  const missing = missingOrderFields(session.order);
  if (missing.includes("legacyAddress")) {
    const addressMissing = missingLegacyAddressComponents(session.order.legacyAddress);
    const needsWard = addressMissing.includes("ward");
    const needsDistrict = addressMissing.includes("district");
    if ((needsWard || needsDistrict) && isLikelyAdministrativeFragment(compact)) {
      const template = [
        needsWard ? "Phường/xã: …" : undefined,
        needsDistrict ? "Quận/huyện: …" : undefined,
      ].filter((value): value is string => Boolean(value));
      return `Dạ em hiểu ${quoted} có thể là phần địa chỉ, nhưng em chưa chắc cách tách nên chưa tự ghi vào đơn ạ. Mình nhắn lại giúp em theo mẫu: ${template.join("; ")} ạ.`;
    }
    if (isLikelyAdministrativeFragment(compact)) {
      return `Dạ em chưa hiểu chắc phần địa chỉ ${quoted} ạ. Mình ghi rõ lại đúng phần địa chỉ còn thiếu giúp em nhé.`;
    }
  }
  if (missing.includes("phone") && /\d/u.test(compact)) {
    return `Dạ em chưa xác nhận được SĐT từ ${quoted} ạ. Mình gửi lại giúp em số điện thoại gồm 10 chữ số nhé.`;
  }
  if (
    missing.includes("recipientName") &&
    looksLikeRecipientName(compact) &&
    looksLikeStandaloneRecipientName(compact)
  ) {
    return `Dạ em chưa chắc ${quoted} có phải tên người nhận không ạ. Mình nhắn lại theo mẫu “Tên người nhận: …” giúp em nhé.`;
  }
  return `Dạ em chưa hiểu chắc ý ${quoted} trong ngữ cảnh hiện tại ạ. Mình diễn đạt rõ thêm chính câu này giúp em để em trả lời đúng nhé.`;
}

function orderResumeReply(session: DemoSession): string {
  const selectedLabel = quantityLabel(session.selectedQuantity ?? 1);
  const missing = missingOrderFields(session.order);
  const prompts: string[] = [];
  if (missing.includes("recipientName")) prompts.push("Tên người nhận");
  if (missing.includes("phone")) prompts.push("SĐT 10 số");
  if (missing.includes("legacyAddress")) {
    prompts.push("địa chỉ trước sáp nhập đầy đủ số nhà/đường/thôn, phường/xã, quận/huyện và tỉnh/thành phố");
  }
  return `Dạ em tiếp tục ${selectedLabel} đang làm dở cho mình nhé. Mình gửi giúp em: ${prompts.join(", ")} ạ.`;
}

function resolveOrderFlowStatus(session: DemoSession): NonNullable<DemoChatState["orderFlowStatus"]> {
  if (session.orderId || session.pipeline === "6.Đã tạo đơn") return "created";
  if (session.care?.case.botPaused || session.orderCollectionPaused) return "paused";
  if (!session.selectedQuantity) return "idle";
  if (session.pendingAction === "confirm_order" || orderHasAllFields(session.order)) {
    return "awaiting_confirmation";
  }
  return "collecting";
}

function orderCreatedReply(session: DemoSession): string {
  const order = session.order;
  if (session.orderConfirmationMode === "inbox") {
    return [
      "Dạ em đã ghi nhận thông tin đơn của mình rồi ạ ✅",
      "",
      "Thông tin đã được chuyển vào danh sách xử lý. Khi có mã vận đơn, bên em sẽ gửi lại để mình theo dõi ạ.",
    ].join("\n");
  }
  return [
    "Dạ em đã ghi nhận thông tin đơn của mình rồi ạ ✅",
    "",
    `Sản phẩm: Stopirex × ${order.quantity}`,
    `Tổng thanh toán: ${order.totalVnd?.toLocaleString("vi-VN")}đ`,
    `Hình thức: ${order.paymentMethod === "cod" ? "Thanh toán khi nhận hàng (COD)" : "Chuyển khoản"}`,
    `Người nhận: ${order.recipientName} – ${order.phone}`,
    `Địa chỉ trước sáp nhập: ${order.legacyAddress}`,
    "",
    "Khi có mã vận đơn Viettel Post, bên em sẽ gửi lại để mình theo dõi ạ.",
  ].join("\n");
}

function orderUpdatedReply(session: DemoSession): string {
  const order = session.order;
  const changed = new Set(session.orderTransactionTrace?.changedFields ?? []);
  const lines = ["Dạ em đã cập nhật lại đơn theo thông tin mình vừa gửi ạ ✅"];
  if (changed.has("recipientName")) lines.push(`• Người nhận: ${order.recipientName}`);
  if (changed.has("phone")) lines.push(`• SĐT: ${order.phone}`);
  if (changed.has("legacyAddress")) lines.push(`• Địa chỉ: ${order.legacyAddress}`);
  if (changed.has("quantity") || changed.has("selectedQuantity")) {
    lines.push(`• Sản phẩm: Stopirex × ${order.quantity}`);
    lines.push(`• Tổng thanh toán: ${order.totalVnd?.toLocaleString("vi-VN")}đ`);
  }
  if (changed.has("deliveryNote")) lines.push(`• Ghi chú giao hàng: ${order.deliveryNote}`);
  lines.push("Đơn vẫn đang chờ mã vận đơn; thông tin thay đổi đã được lưu trên hệ thống ạ.");
  return lines.join("\n");
}

function hasOrderTransactionChanges(session: DemoSession): boolean {
  return (session.orderTransactionTrace?.changedFields.length ?? 0) > 0;
}

function orderCreatingReply(session: DemoSession): string {
  if (session.orderConfirmationMode === "inbox") {
    return "Dạ em đang ghi nhận thông tin đơn để chuyển bộ phận bán hàng xử lý ạ.";
  }
  return [
    "Dạ vâng, em xin phép lên đơn trên hệ thống cho mình ạ.",
    "",
    "Mình chờ em một chút; lên đơn xong em gửi lại mã vận đơn để mình tiện theo dõi nhé ạ.",
  ].join("\n");
}

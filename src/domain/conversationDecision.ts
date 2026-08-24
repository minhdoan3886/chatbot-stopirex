import type { CustomerIntent, SemanticUnderstanding } from "./consultation.js";
import type { ConversationSkillId } from "./chatSkills.js";
import type { IssueType } from "./customerCare.js";
import type { ConversationActionPlan } from "./conversationActions.js";
import type { ActionExecutionMode } from "./actionRollout.js";

export type PendingAction = "send_usage_guidance" | "send_price" | "choose_quantity" | "confirm_order";

export type DecisionRoute =
  | "opt_out"
  | "active_care"
  | "start_care"
  | "pending_action"
  | "order_confirmation"
  | "order_collection"
  | "clarification"
  | "direct_intent"
  | "consultation";

export type RuleMatch = {
  id: string;
  kind: "hard" | "soft";
  confidence: number;
  intent?: CustomerIntent;
  careIssue?: IssueType;
};

export type DecisionTrace = {
  semantic: {
    skill?: ConversationSkillId;
    intent?: CustomerIntent;
    topic?: SemanticUnderstanding["topic"];
    subject?: SemanticUnderstanding["subject"];
    replyTo?: SemanticUnderstanding["replyTo"];
    scenario?: SemanticUnderstanding["scenario"];
    affirmation?: boolean;
    confidence: number;
    needsClarification: boolean;
    evidence: string[];
  };
  pendingActionBefore?: PendingAction;
  pendingActionAfter?: PendingAction;
  ruleMatches: RuleMatch[];
  conflicts: string[];
  selectedRoute: DecisionRoute;
  selectedIntent?: CustomerIntent;
  /** Additional meaning carried by the same customer message. */
  secondaryIntents?: Array<"out_of_domain">;
  selectedCareIssue?: IssueType;
  reason: string;
  knowledgeEntityIds: string[];
  actionPlan?: ConversationActionPlan;
  actionExecutionMode?: ActionExecutionMode;
  final?: {
    intent?: CustomerIntent;
    pipeline: string;
    stage: string;
    signal?: string;
  };
};

export type ResolveConversationDecisionInput = {
  semantic: SemanticUnderstanding;
  pendingAction?: PendingAction;
  exactIntent?: CustomerIntent;
  exactIntentKind?: "hard" | "soft";
  careIssue?: IssueType;
  careScenario?: SemanticUnderstanding["scenario"];
  optOut: boolean;
  activeCare: boolean;
  interruptActiveCare?: boolean;
  orderConfirmation: boolean;
  collectingOrder: boolean;
  orderDataCandidate?: boolean;
  affirmativeFollowup: boolean;
};

export type ConversationDecision = {
  route: DecisionRoute;
  intent?: CustomerIntent;
  careIssue?: IssueType;
  trace: DecisionTrace;
};

export function resolveConversationDecision(input: ResolveConversationDecisionInput): ConversationDecision {
  const semanticConfidence = clampConfidence(
    input.semantic.confidence ?? (input.semantic.intent && input.semantic.intent !== "other" ? 0.82 : 0),
  );
  // `careScenario` is grounded from the customer's actual wording. When it is
  // available it must win over the LLM label in both directions: this prevents
  // an LLM "hypothetical" guess from downgrading "da đang đỏ rát", while still
  // preventing a hypothetical risk question from opening a real care case.
  const careScenario =
    input.careScenario ??
    (input.semantic.scenario && input.semantic.scenario !== "unknown" ? input.semantic.scenario : undefined);
  const ruleMatches: RuleMatch[] = [];
  if (input.optOut) ruleMatches.push({ id: "opt_out", kind: "hard", confidence: 1 });
  if (input.activeCare) {
    ruleMatches.push({ id: "active_care_session", kind: "hard", confidence: 1 });
  }
  if (input.activeCare && input.interruptActiveCare) {
    ruleMatches.push({
      id: "active_care_interrupted_by_direct_question",
      kind: "hard",
      confidence: 1,
      ...(input.exactIntent ? { intent: input.exactIntent } : {}),
    });
  }
  if (input.careIssue) {
    ruleMatches.push({
      id: `care_${input.careIssue}`,
      kind: careScenario === "hypothetical" ? "soft" : careRuleKind(input.careIssue),
      confidence: careScenario === "hypothetical" ? 0.65 : careRuleConfidence(input.careIssue),
      careIssue: input.careIssue,
    });
  }
  if (input.orderConfirmation) {
    ruleMatches.push({ id: "order_confirmation", kind: "hard", confidence: 1 });
  }
  if (input.collectingOrder && input.orderDataCandidate) {
    ruleMatches.push({ id: "order_collection", kind: "hard", confidence: 1 });
  }
  if (input.exactIntent) {
    ruleMatches.push({
      id: `intent_${input.exactIntent}`,
      kind: input.exactIntentKind ?? "soft",
      confidence: input.exactIntentKind === "hard" ? 1 : 0.9,
      intent: input.exactIntent,
    });
  }
  if (input.pendingAction && input.affirmativeFollowup) {
    ruleMatches.push({
      id: `pending_${input.pendingAction}`,
      kind: "hard",
      confidence: 1,
      intent: pendingIntent(input.pendingAction),
    });
  }

  const conflicts: string[] = [];
  if (
    input.exactIntent &&
    input.semantic.intent &&
    input.semantic.intent !== "other" &&
    input.exactIntent !== input.semantic.intent
  ) {
    conflicts.push(`rule:${input.exactIntent} ≠ semantic:${input.semantic.intent}`);
  }
  if (
    input.careIssue &&
    input.semantic.intent &&
    input.semantic.intent !== "other" &&
    !intentMatchesCare(input.semantic.intent, input.careIssue)
  ) {
    conflicts.push(`care:${input.careIssue} ≠ semantic:${input.semantic.intent}`);
  }

  const baseTrace = {
    semantic: {
      ...(input.semantic.skill ? { skill: input.semantic.skill } : {}),
      ...(input.semantic.intent ? { intent: input.semantic.intent } : {}),
      ...(input.semantic.topic ? { topic: input.semantic.topic } : {}),
      ...(input.semantic.subject ? { subject: input.semantic.subject } : {}),
      ...(input.semantic.replyTo ? { replyTo: input.semantic.replyTo } : {}),
      ...(input.semantic.scenario ? { scenario: input.semantic.scenario } : {}),
      ...(typeof input.semantic.affirmation === "boolean" ? { affirmation: input.semantic.affirmation } : {}),
      confidence: semanticConfidence,
      needsClarification: input.semantic.needsClarification === true,
      evidence: input.semantic.evidence ?? [],
    },
    ...(input.pendingAction ? { pendingActionBefore: input.pendingAction } : {}),
    ruleMatches,
    conflicts,
    knowledgeEntityIds: [],
  };

  if (input.optOut) {
    return decision("opt_out", "Yêu cầu dừng tin nhắn là quyền ưu tiên tuyệt đối.", baseTrace);
  }
  if (input.activeCare && !input.interruptActiveCare) {
    return decision("active_care", "Phiên CSKH đang hoạt động nên tiếp tục đúng hồ sơ sự cố.", baseTrace);
  }

  const criticalCare =
    input.careIssue === "irritation" ||
    input.careIssue === "missing_or_damaged" ||
    input.careIssue === "delivery" ||
    input.careIssue === "counterfeit" ||
    input.careIssue === "negative_review";
  if (criticalCare && careScenario !== "hypothetical") {
    return decision(
      "start_care",
      "Phát hiện sự cố CSKH có bằng chứng từ ngữ rõ ràng.",
      baseTrace,
      undefined,
      input.careIssue,
    );
  }

  if (input.orderConfirmation) {
    return decision("order_confirmation", "Khách xác nhận đơn đã đủ dữ liệu.", baseTrace, "buying");
  }

  const pendingAction = input.pendingAction;
  const directQuestionInterruptsPendingAction = Boolean(
    input.semantic.asksDirectAnswer === true &&
      input.semantic.intent &&
      input.semantic.intent !== "other" &&
      input.semantic.intent !== "buying" &&
      input.semantic.intent !== "order_support" &&
      semanticConfidence >= 0.65 &&
      input.semantic.needsClarification !== true,
  );
  const pendingMatches =
    pendingAction !== undefined &&
    !directQuestionInterruptsPendingAction &&
    (input.affirmativeFollowup ||
      input.semantic.replyTo === pendingReplyTo(pendingAction) ||
      (pendingAction === "send_usage_guidance" && input.semantic.intent === "usage_guidance"));
  if (pendingMatches && pendingAction) {
    return decision(
      "pending_action",
      "Câu ngắn đang trả lời đề nghị ngay trước đó, không mở lại luồng khai thác.",
      baseTrace,
      pendingIntent(pendingAction),
    );
  }

  if (input.exactIntent && input.exactIntentKind === "hard") {
    return decision(
      "direct_intent",
      "Guardrail tri thức đã duyệt giữ đúng chủ đề khách hỏi; LLM không được đổi sang luồng khác.",
      baseTrace,
      input.exactIntent,
    );
  }

  if (
    input.collectingOrder &&
    input.semantic.asksDirectAnswer === true &&
    input.semantic.intent &&
    input.semantic.intent !== "other" &&
    input.semantic.intent !== "order_support" &&
    semanticConfidence >= 0.65 &&
    input.semantic.needsClarification !== true
  ) {
    return decision(
      "direct_intent",
      "Khách đang thu đơn nhưng vừa hỏi trực tiếp một việc khác; ưu tiên trả lời câu hiện tại và không ghi nhầm thành dữ liệu đơn.",
      baseTrace,
      input.semantic.intent,
    );
  }
  if (input.collectingOrder && input.orderDataCandidate) {
    return decision(
      "order_collection",
      "Tin nhắn có dữ liệu tên, SĐT hoặc địa chỉ phù hợp với bước thu đơn.",
      baseTrace,
      "order_support",
    );
  }

  if (input.collectingOrder && input.exactIntent) {
    return decision(
      "direct_intent",
      "Khách đang thu đơn nhưng vừa đặt câu hỏi rõ ràng; trả lời ý định hiện tại trước và giữ nguyên dữ liệu đơn đang làm dở.",
      baseTrace,
      input.exactIntent,
    );
  }

  if (
    input.careIssue === "ineffective" &&
    careScenario !== "hypothetical" &&
    (!input.semantic.intent ||
      input.semantic.intent === "other" ||
      input.semantic.intent === "ineffective" ||
      semanticConfidence < 0.65)
  ) {
    return decision(
      "start_care",
      "Khách mô tả đã dùng nhưng không hiệu quả, chuyển sang chẩn đoán CSKH.",
      baseTrace,
      "ineffective",
      input.careIssue,
    );
  }

  const semanticReady =
    input.semantic.intent &&
    input.semantic.intent !== "other" &&
    semanticConfidence >= 0.65 &&
    input.semantic.needsClarification !== true;
  const exactConflictsWithSemantic =
    input.exactIntent && semanticReady && input.exactIntent !== input.semantic.intent;
  const commerceGuardConflict =
    exactConflictsWithSemantic && input.exactIntent !== undefined && isCommerceGuardIntent(input.exactIntent);
  const semanticConsistencyConflict =
    exactConflictsWithSemantic &&
    input.exactIntent !== undefined &&
    (input.exactIntentKind === "hard" || isSemanticConsistencyGuardIntent(input.exactIntent));

  if (semanticReady && !commerceGuardConflict && !semanticConsistencyConflict) {
    return decision(
      "direct_intent",
      conflicts.length
        ? "LLM là bộ máy định tuyến chính và được quyền ghi đè rule từ khoá mềm; rule chỉ giữ vai trò fallback."
        : "LLM xác định rõ ý định hiện tại với độ tin cậy đạt ngưỡng và điều hướng hội thoại.",
      baseTrace,
      input.semantic.intent,
    );
  }
  if (input.exactIntent) {
    return decision(
      "direct_intent",
      commerceGuardConflict
        ? "Guardrail thương mại giữ quyền kiểm soát yêu cầu giá, giảm giá hoặc ưu đãi; LLM không được tự thay đổi chính sách."
        : semanticConsistencyConflict
          ? "Semantic consistency guard từ chối intent LLM mâu thuẫn với tín hiệu ngữ nghĩa rõ ràng trong chính câu khách."
          : exactConflictsWithSemantic
            ? "LLM chưa đủ điều kiện sử dụng; dùng rule miền làm phương án dự phòng."
            : "Dùng rule dự phòng có độ chính xác cao vì LLM chưa đưa ra ý định đủ tin cậy.",
      baseTrace,
      input.exactIntent,
    );
  }
  if (input.collectingOrder) {
    return decision(
      "clarification",
      "Đơn đang tạm dở nhưng tin nhắn hiện tại không có bằng chứng là dữ liệu đơn; hỏi làm rõ thay vì tự kéo khách về bước thu đơn.",
      baseTrace,
    );
  }
  return decision(
    "consultation",
    input.semantic.needsClarification
      ? "Ý định chưa đủ chắc chắn; tiếp tục bằng một câu hỏi đơn giản."
      : "Không có ý định trực tiếp hoặc sự cố; tiếp tục tư vấn tự nhiên.",
    baseTrace,
  );
}

function decision(
  route: DecisionRoute,
  reason: string,
  base: Omit<DecisionTrace, "selectedRoute" | "reason" | "selectedIntent" | "selectedCareIssue">,
  intent?: CustomerIntent,
  careIssue?: IssueType,
): ConversationDecision {
  const trace: DecisionTrace = {
    ...base,
    selectedRoute: route,
    ...(intent ? { selectedIntent: intent } : {}),
    ...(careIssue ? { selectedCareIssue: careIssue } : {}),
    reason,
  };
  return {
    route,
    ...(intent ? { intent } : {}),
    ...(careIssue ? { careIssue } : {}),
    trace,
  };
}

function pendingIntent(action: PendingAction): CustomerIntent {
  if (action === "send_usage_guidance") return "usage_guidance";
  if (action === "send_price") return "price_request";
  return "buying";
}

function pendingReplyTo(action: PendingAction): SemanticUnderstanding["replyTo"] {
  if (action === "send_usage_guidance") return "offer_usage_guidance";
  if (action === "send_price") return "offer_price";
  if (action === "choose_quantity") return "choose_quantity";
  return "confirm_order";
}

function careRuleKind(issue: IssueType): "hard" | "soft" {
  return issue === "ineffective" ? "soft" : "hard";
}

function careRuleConfidence(issue: IssueType): number {
  return issue === "ineffective" ? 0.88 : 0.98;
}

function intentMatchesCare(intent: CustomerIntent, issue: IssueType): boolean {
  if (issue === "ineffective") return intent === "ineffective";
  if (issue === "irritation") return intent === "safety";
  return intent === "order_support";
}

function isCommerceGuardIntent(intent: CustomerIntent): boolean {
  return (
    intent === "price_change" ||
    intent === "price_request" ||
    intent === "promotion_inquiry" ||
    intent === "negotiation" ||
    intent === "decline_purchase"
  );
}

function isSemanticConsistencyGuardIntent(intent: CustomerIntent): boolean {
  return (
    intent === "product_comparison" || intent === "authenticity_question" || intent === "efficacy_objection"
  );
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

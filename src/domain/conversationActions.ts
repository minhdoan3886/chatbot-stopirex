import type { CustomerIntent, SemanticTopic, SemanticUnderstanding } from "./consultation.js";
import type { IssueType } from "./customerCare.js";

export type SupportedOrderQuantity = 1 | 2 | 3 | 4 | 5;

export type ConversationActionType =
  | "stop_bot"
  | "start_customer_care"
  | "handoff_to_human"
  | "answer_question"
  | "record_fact"
  | "select_quantity"
  | "update_order"
  | "continue_order_collection"
  | "pause_order"
  | "decline_purchase";

type ActionBase = {
  type: ConversationActionType;
  confidence: number;
  evidence: string[];
  source: "llm" | "guardrail" | "state";
};

export type ConversationAction =
  | (ActionBase & { type: "stop_bot" })
  | (ActionBase & { type: "start_customer_care"; issue: IssueType })
  | (ActionBase & { type: "handoff_to_human"; reason?: string })
  | (ActionBase & { type: "answer_question"; topic: SemanticTopic })
  | (ActionBase & { type: "record_fact"; field: string; value: string | number | boolean })
  | (ActionBase & { type: "select_quantity"; quantity: SupportedOrderQuantity })
  | (ActionBase & { type: "update_order"; fields: Record<string, string> })
  | (ActionBase & { type: "continue_order_collection" })
  | (ActionBase & { type: "pause_order"; reason?: string })
  | (ActionBase & { type: "decline_purchase" });

export type ProposedConversationAction = Omit<ConversationAction, "source"> & {
  source?: "llm" | "guardrail" | "state";
};

export type RejectedConversationAction = {
  action: ConversationAction;
  reason:
    | "low_confidence"
    | "missing_evidence"
    | "unsupported_quantity"
    | "invalid_fact"
    | "safety_precedence"
    | "policy_verification_required"
    | "conflicting_purchase_decision"
    | "invalid_order_update"
    | "wrong_product_attribution"
    | "non_current_care_scenario"
    | "unverifiable_purchase_condition"
    | "inapplicable_return_logistics"
    | "inapplicable_recurrence_statistic";
};

export type ConversationActionPlan = {
  accepted: ConversationAction[];
  rejected: RejectedConversationAction[];
  conflicts: string[];
  primaryIntent?: CustomerIntent;
  careIssue?: IssueType;
  answerTopics: SemanticTopic[];
  quantity?: SupportedOrderQuantity;
  shouldClarify: boolean;
  hasMultipleActions: boolean;
};

export function reconcileConversationActions(input: {
  customerMessage: string;
  semantic: SemanticUnderstanding;
  exactIntent?: CustomerIntent;
  exactAnswerTopic?: SemanticTopic;
  detectedCareIssue?: IssueType;
  careScenario?: SemanticUnderstanding["scenario"];
  priorOtherProductAdverseExperience?: boolean;
  conditionalNoIrritationPurchase?: boolean;
  optOut: boolean;
  collectingOrder: boolean;
}): ConversationActionPlan {
  const raw = input.customerMessage;
  const text = normalize(raw);
  const candidates: ConversationAction[] = (input.semantic.actions ?? []).map((action) => {
    const candidate = { ...action, source: action.source ?? "llm" } as ConversationAction;
    if (candidate.type === "record_fact" && typeof candidate.value === "string") {
      const orderField = canonicalOrderUpdateField(candidate.field);
      if (orderField) {
        return {
          type: "update_order",
          fields: groundedOrderUpdateFields({ [orderField]: candidate.value }, raw),
          confidence: candidate.confidence,
          evidence: candidate.evidence,
          source: candidate.source,
        };
      }
    }
    if (candidate.type !== "update_order" || candidate.source !== "llm") return candidate;
    return {
      ...candidate,
      fields: groundedOrderUpdateFields(candidate.fields, raw),
    };
  });

  if (
    (input.semantic.unsupportedQuestions?.length ?? 0) > 0 &&
    !candidates.some((action) => action.type === "handoff_to_human")
  ) {
    candidates.push({
      ...baseAction("handoff_to_human", "state", input.semantic.unsupportedQuestions ?? [raw]),
      reason: "Có phần câu hỏi chưa có dữ liệu được duyệt",
    });
  }

  if (input.exactAnswerTopic) {
    for (let index = candidates.length - 1; index >= 0; index -= 1) {
      const candidate = candidates[index];
      if (candidate?.type === "answer_question" && candidate.topic !== input.exactAnswerTopic) {
        candidates.splice(index, 1);
      }
    }
    if (!candidates.some((action) => action.type === "answer_question")) {
      candidates.push({
        ...baseAction("answer_question", "guardrail", [raw]),
        topic: input.exactAnswerTopic,
      });
    }
  }

  if (input.optOut) candidates.push(baseAction("stop_bot", "guardrail", [raw]));
  const currentCareScope =
    input.detectedCareIssue === "irritation"
      ? input.careScenario === "actual" && input.semantic.subject !== "product"
      : input.careScenario !== "hypothetical" && input.careScenario !== "past";
  if (input.detectedCareIssue && currentCareScope) {
    candidates.push({
      ...baseAction("start_customer_care", "guardrail", [raw]),
      issue: input.detectedCareIssue,
    });
    if (
      input.detectedCareIssue === "irritation" &&
      !candidates.some((action) => action.type === "answer_question")
    ) {
      candidates.push({
        ...baseAction("answer_question", "guardrail", [raw]),
        topic: "irritation",
      });
    }
  }

  const explicitQuantity = extractExplicitPurchaseQuantity(text);
  const trustedLlmQuantity = trustedLlmPurchaseQuantity({
    raw,
    semantic: input.semantic,
    candidates,
    collectingOrder: input.collectingOrder,
  });
  if (explicitQuantity) {
    candidates.push({
      ...baseAction("select_quantity", "guardrail", [quantityEvidence(raw)]),
      quantity: explicitQuantity,
    });
    candidates.push(baseAction("continue_order_collection", "state", [quantityEvidence(raw)]));
  } else if (
    trustedLlmQuantity &&
    !candidates.some((action) => action.type === "continue_order_collection")
  ) {
    // The LLM owns natural-language interpretation. Once a high-confidence,
    // verbatim-grounded quantity survives the linguistic trust gate, state may
    // complete the mechanical order action without requiring canonical words.
    candidates.push(baseAction("continue_order_collection", "state", [quantityEvidence(raw)]));
  }

  const answerTopic = inferredAnswerTopic(input.semantic, input.exactIntent, text);
  for (const line of batchedMessageLines(raw)) {
    const topic = inferredBatchedLineAnswerTopic(line.normalized);
    if (
      topic &&
      !candidates.some(
        (action) => action.type === "answer_question" && action.topic === topic,
      )
    ) {
      candidates.push({
        ...baseAction("answer_question", "state", [line.raw]),
        topic,
      });
    }
  }
  const mandatoryConditionalEffectAnswer =
    Boolean(explicitQuantity) &&
    /(?:^|\b)neu\b/.test(text) &&
    /dung nhu|nhu (?:loi|shop|em|tu van)|hieu qua|co tac dung|kiem soat|giam|do|het/.test(text);
  if (mandatoryConditionalEffectAnswer) {
    for (let index = candidates.length - 1; index >= 0; index -= 1) {
      const candidate = candidates[index];
      if (candidate?.type === "answer_question" && candidate.topic !== "effectiveness") {
        candidates.splice(index, 1);
      }
    }
  }
  if (
    answerTopic &&
    !candidates.some(
      (action) => action.type === "answer_question" && action.topic === answerTopic,
    )
  ) {
    candidates.push({
      ...baseAction("answer_question", input.exactIntent ? "guardrail" : "state", [raw]),
      topic: answerTopic,
    });
  }

  if (input.exactIntent === "decline_purchase") {
    candidates.push(baseAction("decline_purchase", "guardrail", [raw]));
  }
  if (input.collectingOrder && answerTopic && !hasAction(candidates, "pause_order")) {
    candidates.push({
      ...baseAction("pause_order", "state", [raw]),
      reason: "answer_current_question_first",
    });
  }

  const accepted: ConversationAction[] = [];
  const rejected: RejectedConversationAction[] = [];
  for (const candidate of deduplicate(candidates)) {
    // A quantity mentioned inside a product/policy question is an entity, not a
    // purchase decision. Only an explicit buying verb may create a selection;
    // short post-price choices are handled by the state-aware service later.
    if (
      candidate.type === "select_quantity" &&
      !explicitQuantity &&
      explicitQuantityAppears(text, candidate.quantity)
    ) {
      rejected.push({ action: candidate, reason: "policy_verification_required" });
      continue;
    }
    if (
      candidate.type === "continue_order_collection" &&
      !explicitQuantity &&
      !trustedLlmQuantity &&
      !input.collectingOrder
    ) {
      rejected.push({ action: candidate, reason: "policy_verification_required" });
      continue;
    }
    if (
      candidate.type === "handoff_to_human" &&
      isUsedIneffectiveRefundQuestion(text) &&
      handoffMentionsPhysicalReturn(candidate)
    ) {
      rejected.push({ action: candidate, reason: "inapplicable_return_logistics" });
      continue;
    }
    if (
      candidate.type === "handoff_to_human" &&
      isRecurrenceStatisticMechanismQuestion(text) &&
      handoffMentionsRecurrenceStatistic(candidate)
    ) {
      rejected.push({ action: candidate, reason: "inapplicable_recurrence_statistic" });
      continue;
    }
    if (candidate.type === "start_customer_care" && input.priorOtherProductAdverseExperience) {
      rejected.push({ action: candidate, reason: "wrong_product_attribution" });
      continue;
    }
    if (
      candidate.type === "start_customer_care" &&
      (input.careScenario === "hypothetical" || input.careScenario === "past")
    ) {
      rejected.push({ action: candidate, reason: "non_current_care_scenario" });
      continue;
    }
    if (
      input.conditionalNoIrritationPurchase &&
      (candidate.type === "select_quantity" || candidate.type === "continue_order_collection")
    ) {
      rejected.push({ action: candidate, reason: "unverifiable_purchase_condition" });
      continue;
    }
    const rejection = validateAction(candidate, text, raw, trustedLlmQuantity);
    if (rejection) rejected.push({ action: candidate, reason: rejection });
    else accepted.push(candidate);
  }

  const conflicts: string[] = [];
  const care = accepted.find(
    (action): action is Extract<ConversationAction, { type: "start_customer_care" }> =>
      action.type === "start_customer_care",
  );
  const safetyCare = care?.issue === "irritation";
  if (safetyCare) {
    const hadPurchaseAction = accepted.some(
      (action) => action.type === "select_quantity" || action.type === "continue_order_collection",
    );
    rejectAccepted(
      accepted,
      rejected,
      (action) => action.type === "select_quantity" || action.type === "continue_order_collection",
      "safety_precedence",
    );
    if ((hadPurchaseAction || input.collectingOrder) && !hasAction(accepted, "pause_order")) {
      accepted.push({
        ...baseAction("pause_order", "guardrail", [raw]),
        reason: "active_irritation_requires_safety_first",
      });
    }
    conflicts.push("An toàn/kích ứng được ưu tiên; hành động mua bị tạm dừng.");
  }

  const unsupportedAudience =
    (input.semantic.topic === "child_age" &&
      typeof input.semantic.age === "number" &&
      input.semantic.age < 12) ||
    /(?:be|tre)?\s*(?:nha\s+\w+\s+)?duoi\s+12\s+tuoi|(?:be|tre)\s+(?:[0-9]|1[01])\s+tuoi/.test(text);
  if (unsupportedAudience) {
    rejectAccepted(
      accepted,
      rejected,
      (action) => action.type === "select_quantity" || action.type === "continue_order_collection",
      "safety_precedence",
    );
    conflicts.push("Khách hỏi mua cho trẻ dưới 12 tuổi; chính sách an toàn chặn hành động mua.");
  }

  const needsPolicyVerification = answerTopic === "promotion" || answerTopic === "other";
  if (needsPolicyVerification) {
    rejectAccepted(
      accepted,
      rejected,
      (action) => action.type === "select_quantity" || action.type === "continue_order_collection",
      "policy_verification_required",
    );
    conflicts.push("Câu hỏi cần xác minh chính sách trước khi tiếp tục hành động mua.");
  }

  const quantityPolicyQuestion = isQuantityPolicyQuestion(text);
  if (quantityPolicyQuestion) {
    rejectAccepted(
      accepted,
      rejected,
      (action) => action.type === "select_quantity" || action.type === "continue_order_collection",
      "policy_verification_required",
    );
    conflicts.push("Số lượng nằm trong câu hỏi giá/ship; chưa phải quyết định mua.");
  }

  const hasDecline = hasAction(accepted, "decline_purchase");
  const hasSelect = hasAction(accepted, "select_quantity");
  if (hasDecline && hasSelect) {
    rejectAccepted(
      accepted,
      rejected,
      (action) => action.type === "select_quantity" || action.type === "continue_order_collection",
      "conflicting_purchase_decision",
    );
    conflicts.push("Tin nhắn vừa có tín hiệu mua vừa có tín hiệu từ chối mua.");
  }

  accepted.sort((a, b) => actionPriority(a) - actionPriority(b));
  const answerTopics = accepted
    .filter(
      (action): action is Extract<ConversationAction, { type: "answer_question" }> =>
        action.type === "answer_question",
    )
    .map((action) => action.topic)
    .filter((topic, index, all) => all.indexOf(topic) === index);
  const selected = accepted.find(
    (action): action is Extract<ConversationAction, { type: "select_quantity" }> =>
      action.type === "select_quantity",
  );
  const resolvedPrimaryIntent = quantityPolicyQuestion
    ? (input.exactIntent ?? "price_request")
    : input.priorOtherProductAdverseExperience && input.exactIntent
      ? input.exactIntent
      : primaryIntent(accepted, input.semantic.intent, input.exactIntent);
  const trustedLinguisticDecision =
    Boolean(selected && selected.quantity === trustedLlmQuantity) ||
    accepted.some(
      (action) =>
        action.type === "decline_purchase" &&
        action.source === "llm" &&
        action.confidence >= 0.85 &&
        hasGroundedEvidence(action, raw),
    );

  return {
    accepted,
    rejected,
    conflicts,
    ...(care ? { careIssue: care.issue } : {}),
    ...(selected ? { quantity: selected.quantity } : {}),
    answerTopics,
    ...(resolvedPrimaryIntent ? { primaryIntent: resolvedPrimaryIntent } : {}),
    shouldClarify:
      conflicts.some((conflict) => conflict.includes("vừa có tín hiệu mua")) ||
      (input.semantic.needsClarification === true && !trustedLinguisticDecision),
    hasMultipleActions: accepted.filter((action) => action.type !== "pause_order").length > 1,
  };
}

function isUsedIneffectiveRefundQuestion(text: string): boolean {
  return (
    /(?:dung|xai|boi).*(?:khong do|khong hieu qua|chua hieu qua)|(?:khong do|khong hieu qua|chua hieu qua).*(?:hoan tien|doi tra)/.test(
      text,
    ) && /hoan tien|gui tra|tra hang/.test(text)
  );
}

function isRecurrenceStatisticMechanismQuestion(text: string): boolean {
  return (
    /tuyen mo hoi|apocrine|phau thuat|thu thuat/.test(text) &&
    /tai phat|sau 1 nam|ty le|ti le|phan tram/.test(text)
  );
}

function handoffText(action: Extract<ConversationAction, { type: "handoff_to_human" }>): string {
  return normalize(`${action.reason ?? ""} ${action.evidence.join(" ")}`);
}

function handoffMentionsPhysicalReturn(
  action: Extract<ConversationAction, { type: "handoff_to_human" }>,
): boolean {
  return /vo hop|gui tra|tra hang|buu dien|qua lay|thu hoi|phi ship|phi giao/.test(handoffText(action));
}

function handoffMentionsRecurrenceStatistic(
  action: Extract<ConversationAction, { type: "handoff_to_human" }>,
): boolean {
  return /tai phat|1 nam|ty le|ti le|phan tram|thong ke/.test(handoffText(action));
}

function isQuantityPolicyQuestion(text: string): boolean {
  const mentionsQuantity = /\b(?:[1-5]|mot|hai|ba|bon|nam)\s+lo\b|\bcombo\b/.test(text);
  const asksPolicy =
    /\b(?:gia|bao nhieu|phi giao|phi ship|freeship|free ship|mien phi giao|co duoc|hay phai)\b/.test(text);
  const hasQuestionShape = /\?|\b(?:khong|ko|k|hay phai|bao nhieu)\b/.test(text);
  return mentionsQuantity && asksPolicy && hasQuestionShape;
}

function validateAction(
  action: ConversationAction,
  text: string,
  raw: string,
  trustedLlmQuantity: SupportedOrderQuantity | undefined,
): RejectedConversationAction["reason"] | undefined {
  if (action.source === "llm" && action.confidence < 0.65) return "low_confidence";
  if (action.source === "llm" && action.evidence.length === 0) return "missing_evidence";
  if (action.type === "select_quantity") {
    if (![1, 2, 3, 4, 5].includes(action.quantity)) return "unsupported_quantity";
    const trustedLinguisticSelection =
      action.source === "llm" &&
      action.quantity === trustedLlmQuantity &&
      hasGroundedEvidence(action, raw);
    if (!explicitQuantityAppears(text, action.quantity) && !trustedLinguisticSelection) {
      return "missing_evidence";
    }
  }
  if (
    action.type === "decline_purchase" &&
    action.source === "llm" &&
    !hasGroundedEvidence(action, raw)
  ) {
    return "missing_evidence";
  }
  if (action.type === "update_order" && Object.keys(action.fields).length === 0) {
    return "invalid_order_update";
  }
  if (
    action.type === "record_fact" &&
    ![
      "workContext",
      "primarySymptom",
      "sweatPresent",
      "odorPresent",
      "priorProduct",
      "priorIrritation",
      "age",
    ].includes(action.field)
  ) {
    return "invalid_fact";
  }
  return undefined;
}

function trustedLlmPurchaseQuantity(input: {
  raw: string;
  semantic: SemanticUnderstanding;
  candidates: readonly ConversationAction[];
  collectingOrder: boolean;
}): SupportedOrderQuantity | undefined {
  const semanticConfidence = input.semantic.confidence ?? 0;
  if (semanticConfidence < 0.85) return undefined;

  const groundedDecline = input.candidates.some(
    (action) =>
      action.type === "decline_purchase" &&
      action.source === "llm" &&
      action.confidence >= 0.85 &&
      hasGroundedEvidence(action, input.raw),
  );
  const semanticSupportsPurchase =
    input.semantic.intent === "buying" ||
    (input.collectingOrder && input.semantic.intent === "order_support") ||
    (input.semantic.intent === "decline_purchase" && groundedDecline);
  if (!semanticSupportsPurchase) return undefined;

  const quantities = input.candidates
    .filter(
      (action): action is Extract<ConversationAction, { type: "select_quantity" }> =>
        action.type === "select_quantity" &&
        action.source === "llm" &&
        action.confidence >= 0.85 &&
        [1, 2, 3, 4, 5].includes(action.quantity) &&
        hasGroundedEvidence(action, input.raw),
    )
    .map((action) => action.quantity)
    .filter((quantity, index, all) => all.indexOf(quantity) === index);
  return quantities.length === 1 ? quantities[0] : undefined;
}

function hasGroundedEvidence(action: ConversationAction, raw: string): boolean {
  const normalizedMessage = normalizeEvidence(raw);
  return action.evidence.some((evidence) => {
    const normalizedEvidence = normalizeEvidence(evidence);
    return (
      normalizedEvidence.split(" ").filter(Boolean).length >= 2 &&
      normalizedMessage.includes(normalizedEvidence)
    );
  });
}

function normalizeEvidence(value: string): string {
  return normalize(value)
    .replace(/[^a-z0-9\s]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function canonicalOrderUpdateField(
  field: string,
): "recipientName" | "phone" | "legacyAddress" | "deliveryNote" | undefined {
  return ["recipientName", "phone", "legacyAddress", "deliveryNote"].includes(field)
    ? (field as "recipientName" | "phone" | "legacyAddress" | "deliveryNote")
    : undefined;
}

function groundedOrderUpdateFields(
  fields: Record<string, string>,
  customerMessage: string,
): Record<string, string> {
  const allowed = new Set(["recipientName", "phone", "legacyAddress", "deliveryNote"]);
  const normalizedMessage = normalize(customerMessage);
  const digitGroups: string[] = [...(customerMessage.match(/\d+/gu) ?? [])];
  return Object.fromEntries(
    Object.entries(fields).filter(([field, rawValue]) => {
      if (!allowed.has(field)) return false;
      const value = rawValue.trim();
      if (!value) return false;
      if (field === "phone") {
        return /^0\d{9}$/u.test(value) && digitGroups.includes(value);
      }
      const normalizedValue = normalize(value);
      if (!normalizedValue || !normalizedMessage.includes(normalizedValue)) return false;
      if (field === "recipientName") {
        return (
          value.length <= 50 &&
          /^[\p{L}\s]+$/u.test(value) &&
          value.trim().split(/\s+/u).length <= 6
        );
      }
      if (field === "legacyAddress") {
        return value.length <= 160 && /\d|\b(?:duong|pho|ngo|thon|phuong|xa|quan|huyen|tinh|ha noi)\b/u.test(normalizedValue);
      }
      return value.length <= 160;
    }),
  );
}

function inferredAnswerTopic(
  semantic: SemanticUnderstanding,
  exactIntent: CustomerIntent | undefined,
  text: string,
): SemanticTopic | undefined {
  if (exactIntent === "product_effect") return "effectiveness";
  if (semantic.asksDirectAnswer === true && semantic.topic) return semantic.topic;
  if (/neu.*(?:dung nhu|hieu qua|co tac dung|giam|do|het)/.test(text)) {
    return "effectiveness";
  }
  const intent = exactIntent ?? semantic.intent;
  if (intent === "product_effect" || intent === "efficacy_objection") return "effectiveness";
  if (intent === "price_request" || intent === "price_change" || intent === "price_objection") {
    return "price";
  }
  if (intent === "usage_guidance" || intent === "usage_time" || intent === "usage_frequency") {
    return "usage";
  }
  if (intent === "safety") {
    if (/mang thai|me bau|ba bau|dang bau|phu nu bau|bau bi|co bau/.test(text)) {
      return "pregnancy";
    }
    if (/cho con bu|dang bu/.test(text)) return "breastfeeding";
    if (/duoi 12|\b(?:be|tre)\b.*\b(?:tuoi|dung)\b/.test(text)) return "child_age";
    if (/nhay cam/.test(text)) return "sensitive_skin";
    if (/rat|ngua|do da|cham chich/.test(text)) return "irritation";
  }
  if (intent === "promotion_inquiry") return "promotion";
  if (intent === "product_comparison") return "comparison";
  if (intent === "knowledge_unknown") return "other";
  if (intent === "authenticity_question") return "order";
  return undefined;
}

function batchedMessageLines(raw: string): Array<{ raw: string; normalized: string }> {
  const lines = raw
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2) return [];
  return lines.map((line) => ({ raw: line, normalized: normalize(line) }));
}

/**
 * Backup only for an explicit topic that the LLM omitted from a multi-message
 * batch. The model remains the primary router; these deliberately narrow
 * patterns prevent one short conversational question from disappearing.
 */
function inferredBatchedLineAnswerTopic(text: string): SemanticTopic | undefined {
  const asksOncePerDay =
    /\b(?:1|mot)\s+ngay\b.*\b(?:chi\s+)?(?:lan|boi|dung|su dung)\b.*\b(?:1|mot)\s+lan\b/.test(
      text,
    ) ||
    /\b(?:lan|boi|dung|su dung)\b.*\b(?:1|mot)\s+lan\b.*\b(?:1|mot)\s+ngay\b/.test(
      text,
    );
  if (asksOncePerDay) return "usage";

  const comparesDailyRollOn =
    /\bgiong\b.*\blan khu mui\b|\blan khu mui\b.*\bgiong\b/.test(text) &&
    /\b(?:giam|kiem soat|ngan)\b.*\bmo hoi\b|\bmo hoi\b.*\b(?:giam|kiem soat|ngan)\b/.test(
      text,
    );
  if (comparesDailyRollOn) return "comparison";
  return undefined;
}

function primaryIntent(
  actions: readonly ConversationAction[],
  semanticIntent: CustomerIntent | undefined,
  exactIntent: CustomerIntent | undefined,
): CustomerIntent | undefined {
  if (hasAction(actions, "stop_bot")) return undefined;
  const care = actions.find(
    (action): action is Extract<ConversationAction, { type: "start_customer_care" }> =>
      action.type === "start_customer_care",
  );
  if (care) return care.issue === "ineffective" ? "ineffective" : "safety";
  if (hasAction(actions, "decline_purchase")) return "decline_purchase";
  if (hasAction(actions, "select_quantity")) return "buying";
  // LLM là bộ định tuyến hội thoại chính. `exactIntent` đến từ rule từ khóa
  // chỉ được dùng khi model không đưa ra được một intent có nghĩa.
  return semanticIntent && semanticIntent !== "other" ? semanticIntent : exactIntent;
}

function extractExplicitPurchaseQuantity(text: string): SupportedOrderQuantity | undefined {
  const numeric = text.match(
    /(?:^|\b)(?:cho|gui|lay|chot|dat|mua)(?:\s+(?:minh|menh|toi|anh|a|chi|em))?\s*(?:combo\s*)?([1-5])\s+lo\b/,
  )?.[1];
  if (numeric) return Number(numeric) as SupportedOrderQuantity;
  const words: ReadonlyArray<[RegExp, SupportedOrderQuantity]> = [
    [/\bnam\s+lo\b/, 5],
    [/\bbon\s+lo\b/, 4],
    [/\bba\s+lo\b/, 3],
  ];
  for (const [pattern, quantity] of words) {
    if (pattern.test(text) && /(?:^|\b)(?:cho|gui|lay|chot|dat|mua)\b/.test(text)) return quantity;
  }
  if (
    /(?:^|\b)(?:cho|gui|lay|chot|dat|mua)(?:\s+(?:minh|menh|toi|anh|a|chi|em))?\s*(?:2|hai)\s+lo\b|\b(?:lay|chon|chot|mua)\s+combo\b/.test(
      text,
    )
  ) {
    return 2;
  }
  if (
    /(?:^|\b)(?:cho|gui|lay|chot|dat|mua)(?:\s+(?:minh|menh|toi|anh|a|chi|em))?\s*(?:1|mot)\s+lo\b/.test(text)
  ) {
    return 1;
  }
  return undefined;
}

function explicitQuantityAppears(text: string, quantity: SupportedOrderQuantity): boolean {
  const words: Record<SupportedOrderQuantity, string> = {
    1: "mot",
    2: "hai",
    3: "ba",
    4: "bon",
    5: "nam",
  };
  if (quantity === 2 && /\bcombo\b/.test(text) && !/[1-5]\s+lo\b/.test(text)) return true;
  return new RegExp(`(?:${quantity}|${words[quantity]})\\s+lo\\b`).test(text);
}

function actionPriority(action: ConversationAction): number {
  const priorities: Record<ConversationActionType, number> = {
    stop_bot: 0,
    start_customer_care: 10,
    handoff_to_human: 20,
    answer_question: 30,
    record_fact: 40,
    select_quantity: 50,
    update_order: 60,
    continue_order_collection: 70,
    pause_order: 80,
    decline_purchase: 25,
  };
  return priorities[action.type];
}

function rejectAccepted(
  accepted: ConversationAction[],
  rejected: RejectedConversationAction[],
  predicate: (action: ConversationAction) => boolean,
  reason: RejectedConversationAction["reason"],
): void {
  for (let index = accepted.length - 1; index >= 0; index -= 1) {
    const action = accepted[index];
    if (!action || !predicate(action)) continue;
    rejected.push({ action, reason });
    accepted.splice(index, 1);
  }
}

function deduplicate(actions: readonly ConversationAction[]): ConversationAction[] {
  const seen = new Set<string>();
  return actions.filter((action) => {
    const key = `${action.type}:${
      action.type === "select_quantity"
        ? action.quantity
        : action.type === "answer_question"
          ? action.topic
          : action.type === "start_customer_care"
            ? action.issue
            : ""
    }`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function baseAction<T extends ConversationActionType>(
  type: T,
  source: ConversationAction["source"],
  evidence: string[],
): ActionBase & { type: T } {
  return { type, source, evidence: evidence.filter(Boolean).slice(0, 3), confidence: 1 };
}

function hasAction(actions: readonly ConversationAction[], type: ConversationActionType): boolean {
  return actions.some((action) => action.type === type);
}

function quantityEvidence(raw: string): string {
  return raw.match(/(?:[1-5]|một|hai|ba|bốn|năm)\s+lọ|combo/iu)?.[0] ?? raw.slice(0, 80);
}

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase()
    .replace(/\s+/gu, " ")
    .trim();
}

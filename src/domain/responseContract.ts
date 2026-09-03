import type {
  ConversationCtaId,
  CustomerIntent,
  SemanticUnderstanding,
} from "./consultation.js";
import type { CanonicalAnswerFact, CanonicalFactConflict } from "./knowledgeResolver.js";

export type AllowedConversationCta = {
  id: ConversationCtaId;
  purpose: string;
};

export type RequiredResponseFact = {
  id: string;
  text: string;
  kind: "money" | "duration" | "url" | "shipping" | "gift" | "safety" | "order" | "claim";
};

export type ResponseContractState = {
  mode: "sales" | "care";
  botPaused: boolean;
  selectedQuantity?: number;
  orderMissing: readonly string[];
  pendingAction?: string;
  orderTransactionTrace?: { changedFields: readonly string[] };
};

export type WorkflowResponseContract = {
  requiredFacts: RequiredResponseFact[];
  allowedCtas: AllowedConversationCta[];
  factPolicy: {
    mustIncludeFacts: RequiredResponseFact[];
    availableFacts: CanonicalAnswerFact[];
    mustNotClaim: Array<{ key: string; reason: string; sourceIds: string[] }>;
  };
  ctaPolicy: {
    preferred: ConversationCtaId[];
    allowed: AllowedConversationCta[];
    forbidden: ConversationCtaId[];
    goal: string;
    requestedSlots: string[];
  };
  flexibleSections: readonly ["opening", "explanation", "transition", "cta"];
};

export function buildWorkflowResponseContract(input: {
  state: ResponseContractState;
  customerMessage?: string;
  authoritativeReply: string;
  canonicalFacts?: readonly CanonicalAnswerFact[];
  canonicalConflicts?: readonly CanonicalFactConflict[];
}): WorkflowResponseContract {
  const mustIncludeFacts =
    input.canonicalFacts === undefined && input.customerMessage === undefined
      ? extractRequiredResponseFacts(input.authoritativeReply)
      : selectCanonicalRequiredFacts({
          customerMessage: input.customerMessage ?? "",
          canonicalFacts: input.canonicalFacts ?? [],
          authoritativeReply: input.authoritativeReply,
          requireExecutionReceipt: (input.state.orderTransactionTrace?.changedFields.length ?? 0) > 0,
        });
  const allowed = allowedConversationCtas(input.state);
  const preferred = preferredConversationCtas(input.state);
  const allCtas = Object.keys(ctaPurposes) as ConversationCtaId[];
  return {
    requiredFacts: mustIncludeFacts,
    allowedCtas: allowed,
    factPolicy: {
      mustIncludeFacts,
      availableFacts: [...(input.canonicalFacts ?? [])],
      mustNotClaim: (input.canonicalConflicts ?? []).map((conflict) => ({
        key: conflict.key,
        reason: "conflicting_applicable_sources",
        sourceIds: [...conflict.sourceIds],
      })),
    },
    ctaPolicy: {
      preferred,
      allowed,
      forbidden: allCtas.filter((id) => !allowed.some((cta) => cta.id === id)),
      goal: conversationGoal(input.state),
      requestedSlots: requestedOrderSlots(input.state),
    },
    // The LLM owns wording only. Facts and available next actions remain
    // authoritative inputs to validation, never text appended by workflow.
    flexibleSections: ["opening", "explanation", "transition", "cta"],
  };
}

/**
 * Product and policy truth comes from canonical knowledge, never from a prose
 * workflow fallback. The execution receipt is only authoritative for order
 * fields that were actually committed by the reducer.
 */
export function selectCanonicalRequiredFacts(input: {
  customerMessage: string;
  canonicalFacts: readonly CanonicalAnswerFact[];
  authoritativeReply?: string;
  requireExecutionReceipt?: boolean;
}): RequiredResponseFact[] {
  const query = normalizeComparable(input.customerMessage);
  const asksPrice = /\b(?:gia|combo|bao nhieu tien|tong tien|thanh toan)\b/u.test(query);
  const asksShipping = /\b(?:ship|giao|van chuyen|freeship|free ship|mien phi giao)\b/u.test(query);
  const asksDuration = /\b(?:bao lau|may ngay|khi nao|bao gio|tan suat|may lan|thang|gio)\b/u.test(query);
  const safetyTurn = /\b(?:rat|ngua|do da|kich ung|kho tho|sung moi|sung mat|choang|cap cuu)\b/u.test(query);
  const requestedQuantity = query.match(
    /(?:combo|lay|mua|gia|chot|cho|dat|gui)\s*(?:m|minh|anh|chi|em)?\s*(\d)\s*(?:lo|chai)?/u,
  )?.[1];
  const asksGift =
    /\b(?:qua|tang|uu dai|khuyen mai)\b/u.test(query) || (asksPrice && !requestedQuantity);
  const specificBundle = /body wash|sua tam/u.test(query);
  const selected: RequiredResponseFact[] = [];
  const add = (fact: RequiredResponseFact) => {
    if (!selected.some((item) => item.id === fact.id)) selected.push(fact);
  };

  for (const fact of input.canonicalFacts) {
    if (fact.kind === "price" && asksPrice) {
      if (specificBundle && !/bodywash_bundle/u.test(fact.key)) continue;
      if (!requestedQuantity && !specificBundle && /\.4_units$|\.5_units$/u.test(fact.key)) continue;
      if (
        requestedQuantity &&
        !fact.key.endsWith(`.${requestedQuantity}_unit`) &&
        !fact.key.endsWith(`.${requestedQuantity}_units`) &&
        !(fact.key === "shipping.stopirex.standard_fee" && requestedQuantity === "1")
      ) continue;
      if (typeof fact.value === "number") {
        add({ id: fact.id, kind: "money", text: `${fact.value.toLocaleString("vi-VN")}đ` });
      }
    } else if (fact.kind === "shipping" && (asksShipping || asksPrice)) {
      if (/pricing-approved-options-2026-08:10/u.test(fact.key) && !/mac ca|thuong luong|followup/u.test(query)) continue;
      if (/bodywash_bundle/u.test(fact.key) && !specificBundle) continue;
      if (specificBundle && !/bodywash_bundle/u.test(fact.key)) continue;
      if (requestedQuantity === "1" && /\.2_5_units$/u.test(fact.key)) continue;
      if (requestedQuantity && requestedQuantity !== "1" && /\.standard_fee$/u.test(fact.key)) continue;
      if (fact.value === true) add({ id: fact.id, kind: "shipping", text: "free_shipping" });
      else if (typeof fact.value === "number") {
        add({ id: fact.id, kind: "money", text: `${fact.value.toLocaleString("vi-VN")}đ` });
      } else add({ id: fact.id, kind: "shipping", text: fact.text });
    } else if (fact.kind === "gift" && asksGift) {
      add({ id: fact.id, kind: "gift", text: fact.text });
    } else if (fact.kind === "duration" && (asksDuration || asksShipping)) {
      add({ id: fact.id, kind: "duration", text: String(fact.value) });
    } else if (fact.kind === "safety" && safetyTurn) {
      for (const safetyFact of extractRequiredResponseFacts(fact.text).filter((item) => item.kind === "safety")) {
        add({ ...safetyFact, id: `${fact.id}:${safetyFact.id}` });
      }
    } else if (
      fact.kind === "claim" &&
      asksPrice &&
      (!requestedQuantity || specificBundle) &&
      /body wash hien chua ban le/u.test(normalizeComparable(fact.text))
    ) {
      add({ id: fact.id, kind: "claim", text: "bodywash_not_sold_separately" });
    }
  }

  const authoritativeReply = input.authoritativeReply ?? "";
  const isOrderReceipt = /người nhận:|SĐT:|địa chỉ:|sản phẩm:|tổng thanh toán:|tình trạng đơn:/iu.test(authoritativeReply);
  const asksOrderRecap = /\b(?:tong ket|doc lai|xac nhan|kiem tra)\b.{0,35}\bdon\b|\bdon\b.{0,35}\b(?:gom|co|thong tin|dung chua)\b/u.test(query);
  if (isOrderReceipt && (asksOrderRecap || input.requireExecutionReceipt)) {
    for (const fact of extractRequiredResponseFacts(authoritativeReply).filter((item) => item.kind === "order" || item.kind === "money")) {
      add({ ...fact, id: `execution:${fact.id}` });
    }
  }
  return selected;
}

function preferredConversationCtas(state: ResponseContractState): ConversationCtaId[] {
  if (state.botPaused || state.mode === "care") return ["ask_care_symptom", "none"];
  if (state.selectedQuantity) {
    if (state.orderMissing.includes("recipientName")) return ["ask_recipient_name", "none"];
    if (state.orderMissing.includes("phone")) return ["ask_phone", "none"];
    if (state.orderMissing.includes("legacyAddress")) return ["ask_address", "none"];
    return ["confirm_order_review", "none"];
  }
  if (state.pendingAction === "send_usage_guidance") return ["offer_usage_guidance", "none"];
  if (state.pendingAction === "send_price") return ["offer_price", "none"];
  if (state.pendingAction === "choose_quantity") return ["ask_quantity", "none"];
  return ["none"];
}

function conversationGoal(state: ResponseContractState): string {
  if (state.botPaused || state.mode === "care") return "resolve_customer_care_safely";
  if (state.selectedQuantity && state.orderMissing.length > 0) return "collect_missing_order_fields";
  if (state.selectedQuantity) return "review_order_without_forcing_keyword_confirmation";
  if (state.pendingAction) return state.pendingAction;
  return "answer_current_customer_need";
}

function requestedOrderSlots(state: ResponseContractState): string[] {
  if (!state.selectedQuantity) return [];
  return state.orderMissing.filter((field) =>
    ["recipientName", "phone", "legacyAddress"].includes(field),
  );
}

const ctaPurposes: Readonly<Record<ConversationCtaId, string>> = {
  none: "Không đặt câu hỏi hoặc lời mời tiếp theo.",
  ask_primary_symptom: "Hỏi khách khó chịu vì mồ hôi, mùi cơ thể hay cả hai.",
  ask_work_context: "Hỏi bối cảnh làm mồ hôi rõ nhất: vận động, nóng, căng thẳng hoặc ngồi điều hòa.",
  offer_usage_guidance: "Đề nghị gửi hoặc tiếp tục hướng dẫn sử dụng.",
  offer_price: "Đề nghị gửi bảng giá hiện hành.",
  ask_quantity: "Hỏi số lượng khi khách đã thể hiện rõ ý định mua.",
  ask_recipient_name: "Xin tên người nhận còn thiếu.",
  ask_phone: "Xin số điện thoại nhận hàng còn thiếu.",
  ask_address: "Xin địa chỉ giao hàng còn thiếu.",
  confirm_order_review: "Mời khách kiểm tra recap; không bắt nhập đúng một từ khóa xác nhận.",
  ask_care_symptom: "Hỏi đúng một dữ kiện cần thiết để xử lý an toàn hoặc khiếu nại.",
  ask_clarification: "Hỏi lại đúng một điểm thật sự mâu thuẫn hoặc chưa thể hiểu chắc.",
};

export function allowedConversationCtas(state: ResponseContractState): AllowedConversationCta[] {
  const ids = new Set<ConversationCtaId>(["none"]);
  if (state.botPaused || state.mode === "care") {
    ids.add("ask_care_symptom");
    ids.add("ask_clarification");
    return [...ids].map(toAllowedCta);
  }
  // Keep current-turn conversational options available even while an order is
  // paused. The LLM may correctly detect that the customer has changed topic;
  // the intent/CTA compatibility check below prevents these from being used on
  // an actual order-support turn.
  ids.add("ask_primary_symptom");
  ids.add("ask_work_context");
  ids.add("offer_usage_guidance");
  ids.add("offer_price");
  if (state.selectedQuantity) {
    if (state.orderMissing.includes("recipientName")) ids.add("ask_recipient_name");
    else if (state.orderMissing.includes("phone")) ids.add("ask_phone");
    else if (state.orderMissing.includes("legacyAddress")) ids.add("ask_address");
    else ids.add("confirm_order_review");
    ids.add("ask_clarification");
    return [...ids].map(toAllowedCta);
  }
  if (state.pendingAction === "send_usage_guidance") ids.add("offer_usage_guidance");
  if (state.pendingAction === "send_price") ids.add("offer_price");
  if (state.pendingAction === "choose_quantity") ids.add("ask_quantity");
  ids.add("ask_clarification");
  return [...ids].map(toAllowedCta);
}

export function assertSelectedCtaAllowed(
  semantic: SemanticUnderstanding,
  allowed: readonly AllowedConversationCta[],
): void {
  const selected = semantic.selectedCtaId ?? "none";
  if (!allowed.some((item) => item.id === selected)) {
    throw semanticContractError(`CTA không được workflow cấp: ${selected}`);
  }
  if (selected === "none" && semantic.ctaText?.trim()) {
    throw semanticContractError("CTA none không được có ctaText");
  }
  if (selected !== "none" && !semantic.ctaText?.trim()) {
    throw semanticContractError(`CTA ${selected} thiếu ctaText`);
  }
  if (selected !== "none" && semantic.draftReply) {
    const draft = normalizeComparable(semantic.draftReply);
    const cta = normalizeComparable(semantic.ctaText ?? "");
    if (!cta || !draft.includes(cta)) {
      throw semanticContractError(`CTA ${selected} không nằm trong draftReply`);
    }
  }
  if (semantic.ctaText && (semantic.ctaText.match(/[?？]/gu) ?? []).length > 1) {
    throw semanticContractError("CTA có quá một câu hỏi");
  }
  if (!ctaMatchesIntent(selected, semantic.intent)) {
    throw semanticContractError(`CTA ${selected} không phù hợp intent ${semantic.intent ?? "unknown"}`);
  }
}

export function extractRequiredResponseFacts(value: string): RequiredResponseFact[] {
  const facts: RequiredResponseFact[] = [];
  const add = (kind: RequiredResponseFact["kind"], text: string) => {
    const normalized = text.replace(/\s+/gu, " ").trim();
    if (!normalized || facts.some((fact) => fact.kind === kind && fact.text === normalized)) return;
    facts.push({ id: `${kind}:${facts.length + 1}`, text: normalized, kind });
  };
  for (const match of value.matchAll(/\d{1,3}(?:\.\d{3})+đ/gu)) add("money", match[0]);
  for (const match of value.matchAll(/\d+\s*[–-]\s*\d+\s*(?:ngày|lần\/tuần|tháng|giờ)/giu)) {
    add("duration", match[0]);
  }
  for (const match of value.matchAll(/https?:\/\/\S+/gu)) add("url", match[0]);
  for (const line of value.split("\n")) {
    if (/miễn phí (?:giao|ship)|freeship|free ship/iu.test(line)) add("shipping", "free_shipping");
    if (/quà tặng|được tặng/iu.test(line)) {
      add("gift", line.match(/\d+\s+(?:túi|quà)/iu)?.[0] ?? "gift_present");
    }
    if (/ngưng (?:dùng|sản phẩm)/iu.test(line)) add("safety", "stop_use");
    if (/đi cấp cứu/iu.test(line)) add("safety", "emergency_care");
    if (/không lăn lại/iu.test(line)) add("safety", "do_not_reapply");
    if (/người nhận:|SĐT:|địa chỉ:|sản phẩm:|tổng thanh toán:|tình trạng đơn:/iu.test(line)) {
      add("order", line);
    }
  }
  return facts;
}

export function assertRequiredResponseFactsPresent(
  facts: readonly RequiredResponseFact[],
  rendered: string,
): void {
  const compactRendered = rendered.replace(/\s+/gu, " ");
  for (const fact of facts) {
    const required = fact.text.replace(/\s+/gu, " ");
    if (fact.kind === "duration") {
      if (canonicalDuration(compactRendered).includes(canonicalDuration(required))) continue;
    } else if (fact.kind === "shipping" && required === "free_shipping") {
      if (/miễn phí (?:giao|ship)|freeship|free ship/iu.test(compactRendered)) continue;
    } else if (fact.kind === "gift") {
      const quantity = required.match(/\d+/u)?.[0];
      if (/(?:quà|tặng)/iu.test(compactRendered) && (!quantity || compactRendered.includes(quantity))) {
        continue;
      }
    } else if (fact.kind === "safety") {
      const safetyPatterns: Record<string, RegExp> = {
        stop_use: /(?:ngưng|dừng|tạm ngưng) (?:dùng|sản phẩm)/iu,
        emergency_care: /(?:đi|gọi|đến).*cấp cứu/iu,
        do_not_reapply: /không (?:lăn|bôi) lại/iu,
      };
      if (safetyPatterns[required]?.test(compactRendered)) continue;
    } else if (fact.kind === "claim" && required === "bodywash_not_sold_separately") {
      if (/Herbal Body Wash[^.!?\n]{0,60}chưa bán lẻ|chưa bán lẻ[^.!?\n]{0,60}Herbal Body Wash/iu.test(compactRendered)) continue;
    } else if (compactRendered.includes(required)) {
      continue;
    }
    const error = new Error(`Thiếu required fact ${fact.id}: ${fact.text}`);
    error.name = "RequiredResponseFactError";
    throw error;
  }
}

function canonicalDuration(value: string): string {
  return value
    .toLocaleLowerCase("vi-VN")
    .replace(/(\d+)\s*(?:đến|toi|–|-)\s*(\d+)/giu, "$1-$2")
    .replace(/lần\s+mỗi\s+tuần/giu, "lần/tuần")
    .replace(/\s+/gu, "")
    .trim();
}

function toAllowedCta(id: ConversationCtaId): AllowedConversationCta {
  return { id, purpose: ctaPurposes[id] };
}

function ctaMatchesIntent(id: ConversationCtaId, intent: CustomerIntent | undefined): boolean {
  if (!intent || id === "none" || id === "ask_clarification") return true;
  if (["price_objection", "efficacy_objection", "negotiation"].includes(intent)) {
    return (
      id === "ask_primary_symptom" ||
      id === "ask_work_context" ||
      id === "offer_usage_guidance"
    );
  }
  if (intent === "safety" || intent === "ineffective") {
    return id === "ask_care_symptom" || id === "offer_usage_guidance";
  }
  if (intent === "order_support") {
    return [
      "ask_recipient_name",
      "ask_phone",
      "ask_address",
      "confirm_order_review",
    ].includes(id);
  }
  if (id === "ask_quantity") return intent === "buying";
  return true;
}

function semanticContractError(message: string): Error {
  const error = new Error(message);
  error.name = "SemanticContractError";
  return error;
}

function normalizeComparable(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/đ/giu, "d")
    .toLocaleLowerCase("vi-VN")
    .replace(/\s+/gu, " ")
    .trim();
}

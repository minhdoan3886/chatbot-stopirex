import type {
  ConversationCtaId,
  CustomerIntent,
  SemanticUnderstanding,
} from "./consultation.js";

export type AllowedConversationCta = {
  id: ConversationCtaId;
  purpose: string;
};

export type RequiredResponseFact = {
  id: string;
  text: string;
  kind: "money" | "duration" | "url" | "shipping" | "gift" | "safety" | "order";
};

export type ResponseContractState = {
  mode: "sales" | "care";
  botPaused: boolean;
  selectedQuantity?: number;
  orderMissing: readonly string[];
  pendingAction?: string;
};

export type WorkflowResponseContract = {
  requiredFacts: RequiredResponseFact[];
  allowedCtas: AllowedConversationCta[];
  flexibleSections: readonly ["opening", "explanation", "transition", "cta"];
};

export function buildWorkflowResponseContract(input: {
  state: ResponseContractState;
  authoritativeReply: string;
}): WorkflowResponseContract {
  return {
    requiredFacts: extractRequiredResponseFacts(input.authoritativeReply),
    allowedCtas: allowedConversationCtas(input.state),
    // The LLM owns wording only. Facts and available next actions remain
    // authoritative inputs to validation, never text appended by workflow.
    flexibleSections: ["opening", "explanation", "transition", "cta"],
  };
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
    .toLocaleLowerCase("vi-VN")
    .replace(/\s+/gu, " ")
    .trim();
}

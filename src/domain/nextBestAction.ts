import type { CustomerIntent, ConsultationSlots } from "./consultation.js";
import type { PipelineTag } from "./pipeline.js";
import type { ConversationTopic } from "./responseGovernor.js";

export type NextBestActionType =
  | "ask_relevant_fact"
  | "offer_usage_help"
  | "offer_price"
  | "suggest_quantity"
  | "collect_missing_order_field"
  | "confirm_order"
  | "handoff"
  | "close_without_question";

export type NextBestActionState =
  | "asking_symptom"
  | "asking_work_context"
  | "asking_prior_product"
  | "price_invite"
  | "stopped_due_to_length"
  | "stopped_due_to_order"
  | "stopped_due_to_handoff_or_complaint"
  | "preserved_existing_question"
  | "stopped";

export type PlannedNextBestAction = {
  type: NextBestActionType;
  state: NextBestActionState;
  key: string;
  reason: string;
  prompt?: string;
};

export type NextBestActionInput = {
  customerMessage: string;
  replies: readonly string[];
  intent?: CustomerIntent;
  pipeline: PipelineTag;
  slots: ConsultationSlots;
  answeredTopics: readonly ConversationTopic[];
  askedTopics: readonly ConversationTopic[];
  selectedQuantity?: number;
  botPaused: boolean;
  hasCareCase: boolean;
  handoffPending: boolean;
  optedOut: boolean;
};

const DISCOVERY_INTENTS = new Set<CustomerIntent>([
  "product_effect",
  "product_comparison",
  "authenticity_question",
  "usage_guidance",
  "usage_time",
  "usage_frequency",
  "safety",
  "consultation",
]);

/**
 * Picks at most one commercially useful, context-safe continuation.
 * It never writes conversation/order state; the response layer may append the
 * prompt only after the customer's questions have already been answered.
 */
export function planNextBestAction(input: NextBestActionInput): PlannedNextBestAction {
  const reply = input.replies.join("\n\n");
  if (input.optedOut) return close("customer_opted_out", "Khách đã từ chối tiếp tục.");
  if (
    input.botPaused ||
    input.hasCareCase ||
    input.handoffPending ||
    input.pipeline === "C3.Chờ CSKH" ||
    isComplaintOrPolicyMessage(input.customerMessage)
  ) {
    return close(
      "care_or_handoff",
      "Ưu tiên xử lý khiếu nại/chính sách/handoff, không khai thác bán hàng.",
      "stopped_due_to_handoff_or_complaint",
    );
  }
  if (input.selectedQuantity || input.pipeline === "5.Chờ TT KH" || input.pipeline === "6.Đã tạo đơn") {
    return close(
      "order_in_progress",
      "Đơn đang được thu hoặc đã tạo; Order Planner chịu trách nhiệm.",
      "stopped_due_to_order",
    );
  }
  if (containsCustomerQuestion(reply)) {
    return close(
      "existing_question",
      "Phản hồi hiện tại đã có một câu hỏi hoặc CTA.",
      "preserved_existing_question",
    );
  }
  if (!input.intent || !DISCOVERY_INTENTS.has(input.intent)) {
    return close("intent_not_discovery", "Intent hiện tại không phù hợp để hỏi khai thác.");
  }
  if (reply.length > 285 || containsDeferral(reply)) {
    return close(
      "reply_not_expandable",
      "Phản hồi dài hoặc đang hoãn/xác minh nên không nối thêm câu hỏi.",
      "stopped_due_to_length",
    );
  }

  const answered = new Set(input.answeredTopics);
  const asked = new Set(input.askedTopics);
  if (!answered.has("symptom") && !asked.has("symptom") && !hasSymptomEvidence(input.customerMessage)) {
    return {
      type: "ask_relevant_fact",
      state: "asking_symptom",
      key: "discover_primary_symptom",
      reason: "Chưa biết khách cần kiểm soát mồ hôi, mùi hay cả hai.",
      prompt: "Hiện mình chủ yếu ra nhiều mồ hôi, có mùi hay gặp cả hai tình trạng ạ?",
    };
  }
  if (answered.has("symptom") && isEffectTimingQuestion(input.customerMessage)) {
    return {
      type: "offer_price",
      state: "price_invite",
      key: "offer_price_after_effect_timing",
      reason: "Đã biết triệu chứng và vừa trả lời mốc hiệu quả; chuyển nhẹ sang cách dùng hoặc giá.",
      prompt: "Mình muốn em gửi cách dùng ngắn trước hay xem bảng giá trước ạ?",
    };
  }
  if (
    !answered.has("work_context") &&
    !asked.has("work_context") &&
    !input.slots.workContext &&
    !hasWorkContextEvidence(input.customerMessage)
  ) {
    return {
      type: "ask_relevant_fact",
      state: "asking_work_context",
      key: "discover_work_context",
      reason: "Đã biết vấn đề chính nhưng chưa biết hoàn cảnh làm triệu chứng rõ nhất.",
      prompt: "Tình trạng này rõ nhất khi mình vận động/ra ngoài trời, hay cả lúc ngồi điều hòa và căng thẳng ạ?",
    };
  }
  if (
    !answered.has("prior_product") &&
    !asked.has("prior_product") &&
    !input.slots.priorProduct &&
    input.intent === "product_comparison"
  ) {
    return {
      type: "ask_relevant_fact",
      state: "asking_prior_product",
      key: "discover_prior_product_response",
      reason: "Khách đang so sánh nhưng chưa rõ trải nghiệm với sản phẩm trước.",
      prompt: "Loại mình từng dùng trước đây chưa đủ hiệu quả, hay có làm da khó chịu ạ?",
    };
  }
  return {
    type: "offer_price",
    state: "price_invite",
    key: "offer_price_after_advice",
    reason: "Các dữ kiện tư vấn chính đã đủ; có thể mời xem phương án mua một cách nhẹ nhàng.",
    prompt: "Nếu mình thấy phù hợp, em gửi luôn giá và phương án dùng tiết kiệm để mình tham khảo nhé?",
  };
}

function close(
  key: string,
  reason: string,
  state: NextBestActionState = "stopped",
): PlannedNextBestAction {
  return { type: "close_without_question", state, key, reason };
}

function containsCustomerQuestion(value: string): boolean {
  return /[?？]/u.test(value);
}

function containsDeferral(value: string): boolean {
  const normalized = normalize(value);
  return /chuyen bo phan|chuyen nhan vien|can kiem tra|chua co thong tin|chua hieu|cho em|tam ngung|ngung su dung/.test(
    normalized,
  );
}

function hasSymptomEvidence(value: string): boolean {
  return /mo hoi|uot|o ao|hoi nach|mui co the|co mui|nang mui|am nach/.test(normalize(value));
}

function hasWorkContextEvidence(value: string): boolean {
  return /van dong|the thao|gym|ngoai troi|cong trinh|van phong|dieu hoa|cang thang|ngu|ngoi yen/.test(
    normalize(value),
  );
}

function isEffectTimingQuestion(value: string): boolean {
  const text = normalize(value);
  return /bao lau|may ngay|may tuan|tuan dau|khi nao/.test(text) && /kho|kho thoang|hieu qua|tac dung|do|giam/.test(text);
}

function isComplaintOrPolicyMessage(value: string): boolean {
  const text = normalize(value);
  return /\b(?:khieu nai|hoan tien|tra hang|doi tra|xot|rat|ngua|kich ung|khong hieu qua|khong do|hang vo|hang hong|giao cham|den tien|boi thuong)\b/.test(
    text,
  );
}

function normalize(value: string): string {
  return value
    .toLocaleLowerCase("vi-VN")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

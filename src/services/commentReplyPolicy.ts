import type { CustomerIntent } from "../domain/consultation.js";

export type CommentCategory = "price" | "consultation" | "complaint" | "positive" | "other";

export type CommentReplyPlan = {
  category: CommentCategory;
  priority: "normal" | "urgent";
  publicReply: string;
  privateReply: string;
};

const priceIntents = new Set<CustomerIntent>([
  "price_change",
  "price_request",
  "promotion_inquiry",
  "price_objection",
  "negotiation",
]);

const consultationIntents = new Set<CustomerIntent>([
  "authenticity_question",
  "buying",
  "consultation",
  "efficacy_objection",
  "ineffective",
  "product_comparison",
  "product_effect",
  "safety",
  "usage_frequency",
  "usage_guidance",
  "usage_time",
]);

/**
 * The LLM-owned conversation result remains the source of intent and product
 * facts. This policy only adapts that grounded answer to Meta's two comment
 * surfaces and provides a narrow fallback when semantic interpretation fails.
 */
export function composeCommentReplyPlan(input: {
  commentText: string;
  intent?: CustomerIntent;
  groundedReplies: readonly string[];
  humanCareRequired?: boolean;
}): CommentReplyPlan {
  const category = commentCategory(input);
  if (category === "complaint") {
    return {
      category,
      priority: "urgent",
      publicReply:
        "Stopirex rất tiếc vì trải nghiệm chưa trọn vẹn của mình ạ. Shop xin phép nhắn riêng để kiểm tra và hỗ trợ mình kỹ hơn nhé.",
      privateReply:
        "Stopirex rất xin lỗi vì sự bất tiện này ạ. Mình gửi giúp shop mã đơn hoặc SĐT đặt hàng cùng tình trạng đang gặp để CSKH kiểm tra và hỗ trợ ngay nhé.",
    };
  }
  if (category === "positive") {
    return {
      category,
      priority: "normal",
      publicReply: "Stopirex cảm ơn mình đã tin tưởng và chia sẻ trải nghiệm ạ 💙",
      privateReply:
        "Stopirex cảm ơn mình rất nhiều ạ 💙 Nếu cần hướng dẫn dùng phù hợp với tình trạng thực tế, mình nhắn lại để shop hỗ trợ nhé.",
    };
  }

  const privateReply = compactPrivateReply(input.groundedReplies);
  if (category === "price") {
    return {
      category,
      priority: "normal",
      publicReply:
        "Dạ shop đã nhận yêu cầu của mình ạ. Shop gửi giá và ưu đãi chi tiết qua tin nhắn riêng, mình kiểm tra cả mục Tin nhắn chờ giúp shop nhé 😊",
      privateReply,
    };
  }
  if (category === "consultation") {
    return {
      category,
      priority: "normal",
      publicReply:
        "Dạ shop đã nhận câu hỏi của mình ạ. Shop gửi phần tư vấn phù hợp qua tin nhắn riêng, mình kiểm tra giúp shop nhé 😊",
      privateReply,
    };
  }
  return {
    category,
    priority: "normal",
    publicReply:
      "Dạ shop đã nhận bình luận của mình ạ. Shop gửi thông tin hỗ trợ qua tin nhắn riêng, mình kiểm tra giúp shop nhé 😊",
    privateReply,
  };
}

function commentCategory(input: {
  commentText: string;
  intent?: CustomerIntent;
  humanCareRequired?: boolean;
}): CommentCategory {
  if (input.humanCareRequired) return "complaint";
  if (input.intent && priceIntents.has(input.intent)) return "price";
  if (input.intent && consultationIntents.has(input.intent)) return "consultation";

  // Regex is deliberately a fallback only for the two signals that are not
  // represented reliably by the current semantic intent vocabulary.
  const normalized = input.commentText.normalize("NFD").replace(/[\u0300-\u036f]/gu, "").toLowerCase();
  if (/\b(cam on|rat tot|hieu qua|ung ho|hai long|yeu shop|tuyet voi)\b/u.test(normalized)) {
    return "positive";
  }
  if (/\b(khieu nai|that vong|lua dao|hang gia|khong nhan duoc|bao huy|be vo|giao sai)\b/u.test(normalized)) {
    return "complaint";
  }
  return input.intent && input.intent !== "other" ? "consultation" : "other";
}

function compactPrivateReply(replies: readonly string[]): string {
  const joined = replies
    .map((reply) => reply.trim())
    .filter(Boolean)
    .join("\n\n")
    .replace(/\n{3,}/gu, "\n\n")
    .replace(/\s{2,}/gu, " ")
    .trim();
  const fallback =
    "Dạ mình cho shop biết nhu cầu hoặc tình trạng đang quan tâm để shop tư vấn đúng và gọn nhất cho mình nhé.";
  return clipAtSentence(joined || fallback, 480);
}

function clipAtSentence(value: string, limit: number): string {
  if (value.length <= limit) return value;
  const clipped = value.slice(0, limit + 1);
  const boundary = Math.max(clipped.lastIndexOf(". "), clipped.lastIndexOf("? "), clipped.lastIndexOf("! "));
  if (boundary >= Math.floor(limit * 0.55)) return clipped.slice(0, boundary + 1).trim();
  return `${value.slice(0, limit - 1).trimEnd()}…`;
}

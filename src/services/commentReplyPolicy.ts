import type { CustomerIntent } from "../domain/consultation.js";

export type CommentCategory = "price" | "consultation" | "complaint" | "positive" | "other";
export type CommentModerationRecommendation = "keep" | "review" | "hide";

export type CommentReplyPlan = {
  category: CommentCategory;
  priority: "normal" | "urgent";
  moderationRecommendation: CommentModerationRecommendation;
  moderationReason?: string;
  autoHide: boolean;
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

/** Adapt one grounded answer to Meta's public and private comment surfaces. */
export function composeCommentReplyPlan(input: {
  commentText: string;
  intent?: CustomerIntent;
  groundedReplies: readonly string[];
  humanCareRequired?: boolean;
}): CommentReplyPlan {
  const openDiscovery = isLowInformationComment(input.commentText);
  const category = openDiscovery ? "other" : commentCategory(input);
  const moderation = suggestCommentModeration(input.commentText, category);
  if (openDiscovery) {
    return {
      category,
      priority: "normal",
      ...moderation,
      publicReply: "Dạ shop chào mình ạ 😊 Shop đã nhắn riêng để hỗ trợ, mình kiểm tra giúp shop nhé.",
      privateReply:
        "Dạ shop chào mình ạ 😊 Mình đang quan tâm giá, cách dùng hay muốn được tư vấn tình trạng mồ hôi và mùi cơ thể ạ?",
    };
  }
  if (category === "complaint") {
    return {
      category,
      priority: "urgent",
      ...moderation,
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
      ...moderation,
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
      ...moderation,
      publicReply:
        "Dạ shop đã nhận yêu cầu của mình ạ. Shop gửi giá và ưu đãi chi tiết qua tin nhắn riêng, mình kiểm tra cả mục Tin nhắn chờ giúp shop nhé 😊",
      privateReply,
    };
  }
  if (category === "consultation") {
    return {
      category,
      priority: "normal",
      ...moderation,
      publicReply:
        "Dạ shop đã nhận câu hỏi của mình ạ. Shop gửi phần tư vấn phù hợp qua tin nhắn riêng, mình kiểm tra giúp shop nhé 😊",
      privateReply,
    };
  }
  return {
    category,
    priority: "normal",
    ...moderation,
    publicReply:
      "Dạ shop đã nhận bình luận của mình ạ. Shop gửi thông tin hỗ trợ qua tin nhắn riêng, mình kiểm tra giúp shop nhé 😊",
    privateReply,
  };
}

export function isLowInformationComment(commentText: string): boolean {
  const normalized = normalize(commentText)
    .replace(/[^a-z0-9]+/gu, " ")
    .trim()
    .replace(/\s+/gu, " ");
  if (!normalized || normalized.length === 1) return true;
  return /^(?:alo|hello|hi|ib|inbox|tv|tu van|quan tam|cham|hong|shop oi|ad oi|ok|okay|uh|um)$/u.test(
    normalized,
  );
}

function suggestCommentModeration(
  commentText: string,
  category: CommentCategory,
): Pick<CommentReplyPlan, "moderationRecommendation" | "moderationReason" | "autoHide"> {
  const normalized = normalize(commentText);
  const containsPublicPii =
    /(?:^|\D)(?:\+?84|0)(?:[ .-]?\d){9}(?:\D|$)/u.test(commentText) ||
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu.test(commentText);
  if (containsPublicPii) {
    return {
      moderationRecommendation: "hide",
      moderationReason: "Có thể chứa SĐT hoặc email công khai; nên ẩn để bảo vệ khách.",
      autoHide: true,
    };
  }
  const abusive = /\b(?:d[mđ]m|dit me|con cho|suc vat|do khon|mat day|ngu vl|cut di|chet di)\b/u.test(
    normalized,
  );
  const spam =
    /(?:https?:\/\/|www\.)\S+/iu.test(commentText) &&
    /\b(?:inbox|kiem tien|dau tu|vay|telegram|zalo|khuyen mai|giam gia|mua ngay)\b/u.test(normalized);
  if (abusive || spam) {
    return {
      moderationRecommendation: "hide",
      autoHide: false,
      moderationReason: abusive
        ? "Có dấu hiệu xúc phạm/quấy rối; cần nhân viên kiểm tra trước khi ẩn."
        : "Có dấu hiệu quảng cáo hoặc liên kết spam; cần nhân viên kiểm tra trước khi ẩn.",
    };
  }
  if (/(?:https?:\/\/|www\.)\S+/iu.test(commentText)) {
    return {
      moderationRecommendation: "review",
      moderationReason: "Comment có liên kết; nên kiểm tra thủ công.",
      autoHide: false,
    };
  }
  return {
    moderationRecommendation: "keep",
    autoHide: false,
    ...(category === "complaint"
      ? { moderationReason: "Khiếu nại thật: giữ hiển thị, chuyển CSKH xử lý; không tự động ẩn." }
      : {}),
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
  const normalized = normalize(input.commentText);
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

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase();
}

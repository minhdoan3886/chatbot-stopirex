import type {
  CustomerIntent,
  SemanticScenario,
  SemanticTopic,
} from "./consultation.js";
import type { DecisionRoute } from "./conversationDecision.js";
import type { IssueType } from "./customerCare.js";

export const conversationSkillIds = [
  "direct-answer",
  "need-discovery",
  "solution-guidance",
  "pricing-objection",
  "order-closing",
  "after-sales-care",
  "safety-first",
  "knowledge-handoff",
  "follow-up",
] as const;

export type ConversationSkillId = (typeof conversationSkillIds)[number];

export type ConversationSkill = {
  id: ConversationSkillId;
  label: string;
  objective: string;
  responsePattern: string;
  maxCharacters: number;
  maxBubbles: number;
  maxQuestions: number;
};

export const customerAdvisorVoicePrinciples = [
  "Nói như nhân viên tư vấn khách hàng, không giảng giải như chuyên gia.",
  "Ưu tiên kết luận tích cực, lợi ích đã duyệt và cách dùng khách có thể làm ngay.",
  "Không tự thêm lời thoái thác như 'tùy cơ địa', 'không cam kết', 'không đảm bảo' hoặc 'hiệu quả tùy từng người' khi khách không hỏi trực tiếp về mức cam kết.",
  "Cảnh báo an toàn chỉ nói đúng phần cần thiết cho tình trạng khách nêu; không liệt kê thêm rủi ro ngoài câu hỏi.",
  "Nếu khách hỏi cam kết tuyệt đối, trả lời trung thực nhưng vẫn theo hướng tích cực: nêu điều kiện dùng đúng và bước hỗ trợ tiếp theo.",
] as const;

export function compactCustomerAdvisorVoiceForPrompt(): string {
  return customerAdvisorVoicePrinciples.join(" ");
}

export const conversationSkills: Readonly<Record<ConversationSkillId, ConversationSkill>> = {
  "direct-answer": {
    id: "direct-answer",
    label: "Trả lời trực tiếp",
    objective: "Trả lời ngay bằng câu ngắn, từ phổ thông và đủ tự tin; không tự chèn lời thoái thác; chỉ dẫn tiếp khi hữu ích.",
    responsePattern: "kết luận thẳng → một ý giải thích dễ hiểu → bước tiếp theo tùy chọn",
    maxCharacters: 240,
    maxBubbles: 2,
    maxQuestions: 1,
  },
  "need-discovery": {
    id: "need-discovery",
    label: "Khai thác ngắn",
    objective: "Chỉ hỏi một dữ kiện còn thiếu bằng câu ngắn, phổ thông và dễ trả lời.",
    responsePattern:
      "ghi nhận trong một câu → một câu hỏi đơn giản",
    maxCharacters: 220,
    maxBubbles: 2,
    maxQuestions: 1,
  },
  "solution-guidance": {
    id: "solution-guidance",
    label: "Đưa giải pháp",
    objective:
      "Trả lời thẳng bằng từ phổ thông, tích cực, đủ mạnh; không tự chèn lời thoái thác và chỉ giữ một hướng dẫn hoặc lưu ý cần thiết.",
    responsePattern:
      "trả lời trực tiếp → một cách dùng/lưu ý thiết yếu → CTA tùy chọn",
    maxCharacters: 240,
    maxBubbles: 2,
    maxQuestions: 1,
  },
  "pricing-objection": {
    id: "pricing-objection",
    label: "Giá và băn khoăn",
    objective:
      "Ghi nhận băn khoăn về giá, giải thích giá trị bằng dữ kiện đã duyệt, nêu đúng ưu đãi của phương án hiện tại và đưa lựa chọn nhẹ nhàng; không đôi co, gây áp lực hoặc tự tạo ưu đãi.",
    responsePattern:
      "ghi nhận băn khoăn → giá trị sử dụng đã xác minh → giá/ship đúng phương án → một lựa chọn không gây áp lực",
    maxCharacters: 320,
    maxBubbles: 3,
    maxQuestions: 1,
  },
  "order-closing": {
    id: "order-closing",
    label: "Chốt và đơn hàng",
    objective: "Thu đúng dữ liệu, recap đủ và chỉ tạo đơn sau xác nhận rõ ràng.",
    responsePattern: "xác nhận lựa chọn → dữ liệu còn thiếu/recap → yêu cầu xác nhận",
    maxCharacters: 900,
    maxBubbles: 3,
    maxQuestions: 1,
  },
  "after-sales-care": {
    id: "after-sales-care",
    label: "Chăm sóc sau bán",
    objective: "Tiếp nhận, hỏi từng ý, đưa phương án và hẹn cập nhật; không đổ lỗi.",
    responsePattern: "ghi nhận → một câu hỏi chẩn đoán → phương án hoặc SLA",
    maxCharacters: 420,
    maxBubbles: 3,
    maxQuestions: 1,
  },
  "safety-first": {
    id: "safety-first",
    label: "An toàn trước",
    objective: "Ưu tiên ngưng dùng/khuyến nghị phù hợp trước mọi mục tiêu bán hàng.",
    responsePattern: "hướng dẫn an toàn ngay → một câu hỏi mức độ → chuyển người khi cần",
    maxCharacters: 360,
    maxBubbles: 3,
    maxQuestions: 1,
  },
  "knowledge-handoff": {
    id: "knowledge-handoff",
    label: "Xác minh và chuyển người",
    objective: "Không đoán dữ kiện chưa được duyệt; xin bằng chứng và chuyển người kiểm tra.",
    responsePattern: "nói rõ chưa xác nhận → xin ảnh/link → owner hoặc thời gian cập nhật",
    maxCharacters: 300,
    maxBubbles: 3,
    maxQuestions: 1,
  },
  "follow-up": {
    id: "follow-up",
    label: "Follow-up đúng tình trạng",
    objective: "Nhắc đúng băn khoăn, không lặp nội dung và dừng ngay khi khách phản hồi.",
    responsePattern: "nhắc theo trạng thái → một mục tiêu → lựa chọn hoặc đóng vòng",
    maxCharacters: 240,
    maxBubbles: 2,
    maxQuestions: 1,
  },
};

export type ResolveConversationSkillInput = {
  suggestedSkill?: ConversationSkillId;
  route: DecisionRoute;
  intent?: CustomerIntent;
  topic?: SemanticTopic;
  scenario?: SemanticScenario;
  careIssue?: IssueType;
  pipeline: string;
};

export type ResolvedConversationSkill = {
  skill: ConversationSkill;
  reason: string;
  suggestionAccepted: boolean;
};

export function isConversationSkillId(value: unknown): value is ConversationSkillId {
  return conversationSkillIds.includes(value as ConversationSkillId);
}

export function resolveConversationSkill(
  input: ResolveConversationSkillInput,
): ResolvedConversationSkill {
  const forced = forcedSkill(input);
  if (forced) {
    return {
      skill: conversationSkills[forced.id],
      reason: forced.reason,
      suggestionAccepted: input.suggestedSkill === forced.id,
    };
  }

  if (input.suggestedSkill && compatibleSuggestion(input.suggestedSkill, input)) {
    return {
      skill: conversationSkills[input.suggestedSkill],
      reason: "LLM chọn skill phù hợp với intent và route; không cần thêm lượt suy luận.",
      suggestionAccepted: true,
    };
  }

  const fallback = fallbackSkill(input);
  return {
    skill: conversationSkills[fallback.id],
    reason: fallback.reason,
    suggestionAccepted: false,
  };
}

export function compactSkillCatalogForPrompt(): string {
  return [
    "direct-answer=trả lời câu hỏi trực tiếp trước; không tự thêm lời thoái thác",
    "need-discovery=chỉ hỏi 1 dữ kiện còn thiếu",
    "solution-guidance=trả lời tích cực→1 lưu ý thiết yếu→CTA tùy chọn; tối đa 2 đoạn ngắn",
    "pricing-objection=ghi nhận băn khoăn→giá trị đã duyệt→đúng giá/ship→lựa chọn nhẹ, không đôi co hoặc bịa ưu đãi",
    "order-closing=chọn gói/thu thông tin/recap/xác nhận",
    "after-sales-care=không hiệu quả/hàng lỗi/giao hàng/đánh giá",
    "safety-first=kích ứng thật hoặc dấu hiệu cần ưu tiên an toàn",
    "knowledge-handoff=tri thức/chính sách chưa được xác nhận",
    "follow-up=nhắc 3–6–9h theo đúng trạng thái",
  ].join("; ");
}

export function assertSkillResponseShape(
  skillId: ConversationSkillId,
  reply: string,
): void {
  const skill = conversationSkills[skillId];
  const questionCount = (reply.match(/[?？]/gu) ?? []).length;
  const bubbleCount = reply.split(/\n\s*\n+/u).filter((item) => item.trim()).length;
  if (/\bdạ được ạ[.!]?/iu.test(reply)) {
    throw skillError(
      `Skill ${skillId} dùng câu xác nhận cụt, không cung cấp giá trị`,
    );
  }
  if (reply.length > skill.maxCharacters) {
    throw skillError(
      `Skill ${skillId} vượt ${skill.maxCharacters} ký tự`,
    );
  }
  if (bubbleCount > skill.maxBubbles) {
    throw skillError(
      `Skill ${skillId} vượt ${skill.maxBubbles} khối tin nhắn`,
    );
  }
  if (questionCount > skill.maxQuestions) {
    throw skillError(
      `Skill ${skillId} vượt ${skill.maxQuestions} câu hỏi`,
    );
  }
}

function forcedSkill(
  input: ResolveConversationSkillInput,
): { id: ConversationSkillId; reason: string } | undefined {
  if (input.route === "opt_out") {
    return {
      id: "direct-answer",
      reason: "Yêu cầu dừng nhắn phải được xác nhận trực tiếp, không khai thác thêm.",
    };
  }
  if (
    input.route === "order_collection" ||
    input.route === "order_confirmation" ||
    input.intent === "buying" ||
    input.intent === "order_support"
  ) {
    return {
      id: "order-closing",
      reason: "Đang thu, recap hoặc xác nhận đơn nên khóa vào skill đơn hàng.",
    };
  }
  if (
    input.careIssue === "irritation" &&
    input.scenario !== "hypothetical"
  ) {
    return {
      id: "safety-first",
      reason: "Kích ứng thực tế luôn ưu tiên an toàn trước bán hàng.",
    };
  }
  if (input.route === "active_care" || input.route === "start_care") {
    return {
      id: "after-sales-care",
      reason: "Phiên CSKH đang hoạt động nên dùng skill chăm sóc sau bán.",
    };
  }
  if (
    input.intent === "knowledge_unknown" ||
    input.intent === "promotion_inquiry"
  ) {
    return {
      id: "knowledge-handoff",
      reason: "Thông tin chưa được xác nhận phải fail closed và chuyển người.",
    };
  }
  if (input.pipeline === "7.Chờ followup") {
    return {
      id: "follow-up",
      reason: "Phiên đang ở nhịp follow-up 3–6–9 giờ.",
    };
  }
  return undefined;
}

function compatibleSuggestion(
  skillId: ConversationSkillId,
  input: ResolveConversationSkillInput,
): boolean {
  if (skillId === "pricing-objection") return isPricingObjectionIntent(input.intent);
  if (skillId === "solution-guidance") {
    return [
      "product_effect",
      "product_comparison",
      "usage_guidance",
      "usage_time",
      "usage_frequency",
      "efficacy_objection",
    ].includes(input.intent ?? "");
  }
  if (skillId === "need-discovery") {
    return input.route === "consultation" || input.intent === "consultation";
  }
  if (skillId === "direct-answer") {
    return input.route === "direct_intent" && !isPricingObjectionIntent(input.intent);
  }
  return false;
}

function fallbackSkill(
  input: ResolveConversationSkillInput,
): { id: ConversationSkillId; reason: string } {
  if (isPricingObjectionIntent(input.intent)) {
    return {
      id: "pricing-objection",
      reason: "Intent thuộc giá, phí giao, giảm giá hoặc băn khoăn chi phí.",
    };
  }
  if (
    [
      "product_effect",
      "product_comparison",
      "usage_guidance",
      "usage_time",
      "usage_frequency",
      "efficacy_objection",
    ].includes(input.intent ?? "")
  ) {
    return {
      id: "solution-guidance",
      reason: "Intent cần nối nhu cầu với giải pháp hoặc cách dùng.",
    };
  }
  if (input.route === "consultation" || input.intent === "consultation") {
    return {
      id: "need-discovery",
      reason: "Chưa đủ dữ kiện để đưa giải pháp nên chỉ hỏi một ý cần thiết.",
    };
  }
  return {
    id: "direct-answer",
    reason: "Mặc định trả lời đúng ý hiện tại trước khi dẫn sang bước khác.",
  };
}

function isPricingObjectionIntent(intent: CustomerIntent | undefined): boolean {
  return [
    "price_change",
    "price_objection",
    "negotiation",
    "decline_purchase",
  ].includes(intent ?? "");
}

function skillError(message: string): Error {
  const error = new Error(message);
  error.name = "SkillResponseError";
  return error;
}

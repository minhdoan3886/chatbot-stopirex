export type ConversationTopic =
  | "work_context"
  | "symptom"
  | "prior_product"
  | "usage"
  | "child_age"
  | "price"
  | "quantity"
  | "order_confirmation"
  | "order_data"
  | "care";

export type GovernedResponse = {
  replies: string[];
  askedTopics: ConversationTopic[];
  pendingQuestionTopic?: ConversationTopic;
  truncated: boolean;
};

export type ResponseGovernorInput = {
  replies: readonly string[];
  answeredTopics?: readonly ConversationTopic[];
  previouslyAskedTopics?: readonly ConversationTopic[];
  maxCharacters?: number;
  maxBubbles?: number;
  preserveFullText?: boolean;
};

// Messenger cần đủ ngắn để khách đọc trên màn hình điện thoại. Các nội dung
// bắt buộc như recap đơn/CSKH có thể chủ động bật preserveFullText.
const DEFAULT_MAX_CHARACTERS = 360;
const DEFAULT_MAX_BUBBLES = 2;

export function governCustomerResponse(
  input: ResponseGovernorInput,
): GovernedResponse {
  const answered = new Set(input.answeredTopics ?? []);
  const previouslyAsked = new Set(input.previouslyAskedTopics ?? []);
  const sourceBlocks = input.replies
    .flatMap(splitBlocks)
    .map((block) => block.trim())
    .filter(Boolean);

  const deduplicated = sourceBlocks.filter((block) => {
    const topic = questionTopic(block);
    if (!topic) return true;
    if (!isDiagnosticTopic(topic) || !isMostlyQuestion(block)) return true;
    if (answered.has(topic)) return false;
    if (previouslyAsked.has(topic)) return false;
    return true;
  });

  const withSingleQuestion = keepOnlyLastQuestion(deduplicated);
  let replies = withSingleQuestion;
  let truncated = false;

  if (!input.preserveFullText) {
    const maxCharacters = input.maxCharacters ?? DEFAULT_MAX_CHARACTERS;
    const compacted = compactToCharacterLimit(replies, maxCharacters);
    replies = compacted.replies;
    truncated = compacted.truncated;
  }
  const maxBubbles = input.maxBubbles ?? DEFAULT_MAX_BUBBLES;
  replies = mergeToBubbleLimit(replies, maxBubbles);

  const askedTopics = replies
    .map(questionTopic)
    .filter((topic): topic is ConversationTopic => Boolean(topic));

  return {
    replies,
    askedTopics: [...new Set(askedTopics)],
    ...(askedTopics.at(-1)
      ? { pendingQuestionTopic: askedTopics.at(-1)! }
      : {}),
    truncated,
  };
}

export function inferAnsweredTopicFromMessage(
  message: string,
  pending?: ConversationTopic,
): ConversationTopic[] {
  const text = normalize(message);
  const topics: ConversationTopic[] = [];
  if (
    /ngoai troi|van dong|the thao|pickle|pick\b|gym|cong trinh|lao dong|van phong|dieu hoa|cang thang/.test(
      text,
    )
  ) {
    topics.push("work_context");
  }
  if (/mo hoi|uot|o ao|mui|hoi nach|ca hai/.test(text)) {
    topics.push("symptom");
  }
  if (/lan thuong|hang ngay|chuyen sau|gian cach|chua tung dung/.test(text)) {
    topics.push("prior_product");
  }
  if (/buoi toi|buoi sang|truoc khi ngu|lan mong|lan day|lan\/tuan/.test(text)) {
    topics.push("usage");
  }
  if (/\b\d{1,3}\s*(?:tuoi|t)\b/.test(text)) {
    topics.push("child_age");
  }
  if (/1 lo|mot lo|2 lo|hai lo|combo/.test(text)) {
    topics.push("quantity");
  }
  if (/dong y|khong dong y/.test(text)) {
    topics.push("order_confirmation");
  }
  if (
    /(?<!\d)0\d{9}(?!\d)/.test(message) ||
    /dia chi|sdt|so dien thoai|nguoi nhan/.test(text)
  ) {
    topics.push("order_data");
  }
  if (
    pending &&
    !/khong biet|ko biet|chua de y|khong ro|ko ro/.test(text) &&
    message.trim().length > 0
  ) {
    topics.push(pending);
  }
  return [...new Set(topics)];
}

export function questionTopic(value: string): ConversationTopic | undefined {
  const withoutUrls = value.replace(/https?:\/\/\S+/giu, "");
  const text = normalize(withoutUrls);
  const implicitChildAgeQuestion =
    /be bao nhieu tuoi|bao nhieu tuoi.*be|tuoi cua be/.test(text);
  if (!/[?？]/u.test(withoutUrls) && !implicitChildAgeQuestion) return undefined;
  if (/ngoai troi|van dong|van phong|dieu hoa|cang thang|cong viec/.test(text)) {
    return "work_context";
  }
  if (/uot|o ao|mo hoi|mui|kho chiu nhat|tinh trang nao/.test(text)) {
    return "symptom";
  }
  if (/lan cu|lan thuong|hang ngay|truoc day.*dung|tung dung/.test(text)) {
    return "prior_product";
  }
  if (/cach dung|buoi toi|buoi sang|may lan|tan suat|da kho/.test(text)) {
    return "usage";
  }
  if (implicitChildAgeQuestion) {
    return "child_age";
  }
  if (/1 lo|mot lo|2 lo|hai lo|combo|phuong an/.test(text)) {
    return "quantity";
  }
  if (/\bgia\b|\bphi (?:giao|ship)\b|freeship|uu dai|khuyen mai/.test(text)) {
    return "price";
  }
  if (/dong y|xac nhan don|kiem tra don/.test(text)) {
    return "order_confirmation";
  }
  if (/ten nguoi nhan|sdt|so dien thoai|dia chi/.test(text)) {
    return "order_data";
  }
  if (/ma don|hinh anh|do rat|hong|vo|giao cham|khieu nai/.test(text)) {
    return "care";
  }
  return undefined;
}

function isDiagnosticTopic(topic: ConversationTopic): boolean {
  return [
    "work_context",
    "symptom",
    "prior_product",
    "usage",
    "child_age",
  ].includes(topic);
}

function isMostlyQuestion(value: string): boolean {
  const statements = value
    .split(/(?<=[.!?？])\s+/u)
    .map((item) => item.trim())
    .filter(Boolean);
  return value.length <= 220 && statements.length <= 2;
}

function splitBlocks(value: string): string[] {
  return value.split(/\n\s*\n+/u);
}

function keepOnlyLastQuestion(blocks: string[]): string[] {
  const questionIndexes = blocks
    .map((block, index) => (/[?？]/u.test(block) ? index : -1))
    .filter((index) => index >= 0);
  const lastQuestion = questionIndexes.at(-1);
  if (lastQuestion === undefined) return blocks;
  return blocks.map((block, index) => {
    if (index === lastQuestion || !/[?？]/u.test(block)) return block;
    return block.replace(/[?？]/gu, ".").trim();
  });
}

function mergeToBubbleLimit(blocks: string[], maxBubbles: number): string[] {
  if (blocks.length <= maxBubbles) return blocks;
  if (maxBubbles <= 1) return [blocks.join("\n\n")];
  const leading = blocks.slice(0, maxBubbles - 1);
  const tail = blocks.slice(maxBubbles - 1).join("\n\n");
  return [...leading, tail];
}

function compactToCharacterLimit(
  replies: string[],
  maxCharacters: number,
): { replies: string[]; truncated: boolean } {
  if (totalCharacters(replies) <= maxCharacters) {
    return { replies, truncated: false };
  }

  const question = [...replies].reverse().find((reply) => /[?？]/u.test(reply));
  const statements = replies.filter((reply) => reply !== question);
  const budgetForQuestion = question ? question.length + 2 : 0;
  const statementBudget = Math.max(80, maxCharacters - budgetForQuestion);
  const compactStatements: string[] = [];
  let used = 0;

  for (const statement of statements) {
    const compact = compactSentences(statement, statementBudget - used);
    if (!compact) continue;
    compactStatements.push(compact);
    used += compact.length + 2;
    if (used >= statementBudget) break;
  }

  let result = [...compactStatements, ...(question ? [question] : [])].filter(Boolean);
  if (totalCharacters(result) > maxCharacters) {
    const questionBudget = Math.min(question?.length ?? 0, Math.floor(maxCharacters * 0.45));
    const finalQuestion = question
      ? compactSentences(question, Math.max(60, questionBudget), true)
      : undefined;
    const bodyBudget = maxCharacters - (finalQuestion?.length ?? 0) - 2;
    const body = compactSentences(compactStatements.join(" "), bodyBudget);
    result = [body, finalQuestion].filter((item): item is string => Boolean(item));
  }

  return { replies: result, truncated: true };
}

function compactSentences(
  value: string,
  budget: number,
  keepQuestion = false,
): string {
  if (budget <= 0) return "";
  if (value.length <= budget) return value;
  const sentences = value
    .split(/(?<=[.!?？])\s+/u)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  let result = "";
  for (const sentence of sentences) {
    const candidate = result ? `${result} ${sentence}` : sentence;
    if (candidate.length > budget) break;
    result = candidate;
  }
  if (result) return result;
  const suffix = keepQuestion ? "?" : "…";
  return `${value.slice(0, Math.max(1, budget - suffix.length)).trimEnd()}${suffix}`;
}

function totalCharacters(replies: readonly string[]): number {
  return replies.join("\n\n").length;
}

function normalize(value: string): string {
  return value
    .toLocaleLowerCase("vi-VN")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/đ/g, "d")
    .replace(/\s+/gu, " ")
    .trim();
}

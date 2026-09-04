export const MAX_MEMORY_META_LANGUAGE = 0;

export const stopirexResponseStylePrinciples = [
  "Nói như nhân viên CSKH Stopirex đang chat thật trên Facebook hoặc Zalo, không nói như trợ lý AI.",
  "Hiểu và dùng memory một cách ngầm; tuyệt đối không giải thích thao tác ghi nhớ, cập nhật state, thay thế fact hay phân biệt subject.",
  "Không dùng các câu như 'em ghi nhận lại', 'em cập nhật', 'thông tin cũ không còn hiệu lực', 'em sẽ tách hai trường hợp', 'để không ghi nhầm' hoặc 'điều này không xóa thông tin trước đó'.",
  "Ưu tiên 1–3 câu ngắn, từ nói tự nhiên và không dùng dấu chấm phẩy trong hội thoại thông thường.",
  "Không recap toàn bộ case nếu khách không yêu cầu; chỉ phản hồi đúng ý mới nhất và dùng context ngầm để trả lời.",
  "Có thể mở đầu tự nhiên bằng 'à', 'oke', 'ừm', 'đúng rồi', 'hiểu rồi' hoặc 'vậy là' khi hợp ngữ cảnh, nhưng không cố tình viết sai chính tả.",
  "Không lặp lại nguyên thông tin khách vừa nói nếu việc xác nhận không giúp ích cho câu trả lời.",
] as const;

export type StopirexResponseStyleAssessment = {
  memoryMetaLanguage: string[];
  memoryMetaLanguageCount: number;
  semicolonCount: number;
  sentenceCount: number;
  factAreaCount: number;
  explicitDetailedRequest: boolean;
  unnecessaryRecap: boolean;
  conversationalOpening: boolean;
};

export function compactStopirexResponseStylePolicyForPrompt(): string {
  return `${stopirexResponseStylePrinciples.join(" ")} Never explain memory operations to the customer.`;
}

export function assessStopirexResponseStyle(
  customerMessage: string,
  response: string,
): StopirexResponseStyleAssessment {
  const conversationalText = response.replace(/^Dạ em chào[^\n]+(?:\n\s*\n+|\s+)/iu, "");
  const memoryMetaLanguage = memoryMetaRisks(customerMessage, response);
  const explicitDetailedRequest = allowsDetailedResponse(customerMessage);
  const factAreaCount = personalFactAreaCount(response);
  return {
    memoryMetaLanguage,
    memoryMetaLanguageCount: memoryMetaLanguage.length,
    semicolonCount: response.match(/;/gu)?.length ?? 0,
    sentenceCount: response
      .split(/(?<=[.!?？])(?:\s+|$)/u)
      .map((part) => part.trim())
      .filter(Boolean).length,
    factAreaCount,
    explicitDetailedRequest,
    unnecessaryRecap: !explicitDetailedRequest && factAreaCount >= 4,
    conversationalOpening:
      /^(?:dạ\s+)?(?:à|oke|ok|ừm|ừ|đúng rồi|hiểu rồi|vậy là|chưa nha|có nha)(?=[\s,.!:]|$)/iu.test(
        conversationalText.trim(),
      ),
  };
}

export function assertStopirexResponseStyle(input: {
  customerMessage: string;
  response: string;
  strictFactResponse?: boolean;
}): void {
  const assessment = assessStopirexResponseStyle(input.customerMessage, input.response);
  if (assessment.memoryMetaLanguageCount > MAX_MEMORY_META_LANGUAGE) {
    throw styleError(`Câu trả lời làm lộ thao tác memory: ${assessment.memoryMetaLanguage.join(", ")}`);
  }
  if (!input.strictFactResponse) return;
  if (assessment.semicolonCount > 0) {
    throw styleError("Câu Fact Ledger dùng dấu chấm phẩy như văn viết");
  }
  if (assessment.unnecessaryRecap) {
    throw styleError("Câu trả lời recap nhiều vùng dữ kiện khi khách không yêu cầu");
  }
  if (!assessment.explicitDetailedRequest && assessment.sentenceCount > 3) {
    throw styleError("Câu trả lời thông thường dài quá 3 câu");
  }
}

function memoryMetaRisks(customerMessage: string, value: string): string[] {
  const memorySensitiveTurn =
    /\b(?:lich|nho|truoc|review|nham|sua lai|doi roi|doi r|recap|chot lai|tong ket|nhac lai|hom qua|hqua|ban (?:tui|minh)|e(?:m)? (?:tui|minh))\b/.test(
      normalize(customerMessage),
    );
  const risks: Array<[string, RegExp]> = [
    ["record_memory", memorySensitiveTurn ? /\bem (?:đã )?(?:ghi nhận|cập nhật)(?: lại)?\b/iu : /$a/u],
    ["old_state", /\b(?:thông tin|lịch) cũ (?:không còn|đã bị|hết)\b/iu],
    ["split_subjects", /\bem sẽ (?:tách|tư vấn) (?:hai|2) (?:trường hợp|case).*riêng\b/iu],
    ["avoid_wrong_memory", /\bđể không (?:ghi|nhớ) nhầm\b/iu],
    ["preserve_history", /\b(?:điều này )?không xóa (?:thông tin|dữ kiện)\b/iu],
    ["internal_terms", /\b(?:fact ledger|superseded|state|subject resolution)\b/iu],
  ];
  return risks.filter(([, pattern]) => pattern.test(value)).map(([id]) => id);
}

function allowsDetailedResponse(value: string): boolean {
  const text = normalize(value);
  return /\b(?:recap|chot lai|tong ket|nhac lai|tom tat|case .* khac nhau|khac nhau cho nao)\b/.test(text);
}

function personalFactAreaCount(value: string): number {
  const text = normalize(value);
  return [
    /\b(?:mo hoi|mh|uot ao|mui)\b/.test(text),
    /\b(?:da nhay cam|da binh thuong|de xot)\b/.test(text),
    /\b(?:lich gym|gym sang|gym toi)\b/.test(text),
    /\b(?:wax|cao|nhổ|triet)\b/.test(text),
    /\b(?:ngua|do da|di ung|kich ung|bi rat)\b/.test(text),
  ].filter(Boolean).length;
}

function normalize(value: string): string {
  return value
    .toLocaleLowerCase("vi-VN")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/đ/gu, "d")
    .replace(/\s+/gu, " ")
    .trim();
}

function styleError(message: string): Error {
  const error = new Error(message);
  error.name = "ResponseStylePolicyError";
  return error;
}

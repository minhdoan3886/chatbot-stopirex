export type ClaimStatus = "approved" | "blocked" | "pending";

export type ClaimRule = {
  id: string;
  phrase: string;
  status: ClaimStatus;
  replacement?: string;
  effectiveFrom: Date;
  effectiveTo?: Date;
};

export type ClaimViolation = {
  ruleId: string;
  phrase: string;
  replacement?: string;
};

export class ClaimRegistry {
  constructor(private readonly rules: readonly ClaimRule[]) {}

  validate(text: string, at = new Date()): ClaimViolation[] {
    const normalized = normalize(text);
    return this.rules
      .filter((rule) => isActive(rule, at) && rule.status !== "approved")
      .filter((rule) => containsUnnegatedPhrase(normalized, normalize(rule.phrase)))
      .filter((rule) => !isContextuallyAllowedClaim(rule, normalized))
      .map((rule) => ({
        ruleId: rule.id,
        phrase: rule.phrase,
        ...(rule.replacement ? { replacement: rule.replacement } : {}),
      }));
  }

  assertSafe(text: string, at = new Date()): void {
    const violations = this.validate(text, at);
    if (violations.length > 0) {
      throw new UnsafeClaimError(violations);
    }
  }
}

function isContextuallyAllowedClaim(rule: ClaimRule, normalizedText: string): boolean {
  if (rule.id !== "claim-complete-reassurance") return false;
  return (
    normalizedText.includes("dùng chung với nước hoa") &&
    normalizedText.includes("không sợ bị lộn mùi") &&
    !/(?:kích ứng|an toàn tuyệt đối|an toàn 100%|không gây hại)/u.test(normalizedText)
  );
}

function containsUnnegatedPhrase(text: string, phrase: string): boolean {
  let from = 0;
  while (from < text.length) {
    const index = text.indexOf(phrase, from);
    if (index < 0) return false;
    const prefix = text.slice(Math.max(0, index - 64), index);
    if (!/(?:không|chưa|chẳng|chả)(?:\s+\S+){0,6}\s*$/iu.test(prefix)) {
      return true;
    }
    from = index + phrase.length;
  }
  return false;
}

export class UnsafeClaimError extends Error {
  constructor(readonly violations: readonly ClaimViolation[]) {
    super(`Câu trả lời chứa claim chưa được phép: ${violations.map((v) => v.phrase).join(", ")}`);
    this.name = "UnsafeClaimError";
  }
}

function isActive(rule: ClaimRule, at: Date): boolean {
  return rule.effectiveFrom <= at && (!rule.effectiveTo || rule.effectiveTo > at);
}

function normalize(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("vi-VN").replace(/\s+/g, " ").trim();
}

export const defaultBlockedClaims: readonly ClaimRule[] = [
  {
    id: "claim-absolute-dry",
    phrase: "khô thoáng tuyệt đối",
    status: "blocked",
    replacement: "hỗ trợ kiểm soát mồ hôi khi dùng đúng cách",
    effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
  },
  {
    id: "claim-definitive",
    phrase: "dứt điểm",
    status: "blocked",
    replacement: "hỗ trợ giảm và kiểm soát theo hướng dẫn",
    effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
  },
  {
    id: "claim-safe-100",
    phrase: "an toàn 100%",
    status: "blocked",
    replacement: "dùng đúng hướng dẫn và kiểm tra tình trạng da",
    effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
  },
  {
    id: "claim-no-irritation",
    phrase: "không lo kích ứng",
    status: "blocked",
    replacement: "có thể yên tâm hơn khi dùng đúng hướng dẫn; cách dùng đúng giúp hạn chế nguy cơ khó chịu",
    effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
  },
  {
    id: "claim-complete-reassurance",
    phrase: "hoàn toàn yên tâm",
    status: "blocked",
    replacement: "có thể yên tâm hơn khi dùng đúng hướng dẫn",
    effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
  },
  {
    id: "claim-never-irritates",
    phrase: "không gây kích ứng",
    status: "blocked",
    replacement: "công thức dịu nhẹ; dùng đúng hướng dẫn giúp hạn chế nguy cơ khó chịu",
    effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
  },
  {
    id: "claim-two-bottles-required",
    phrase: "phải dùng 2 lọ mới hết",
    status: "blocked",
    replacement: "combo phù hợp dùng dài và tiết kiệm hơn",
    effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
  },
  {
    id: "claim-alcohol-free-contradicts-notification",
    phrase: "không chứa cồn",
    status: "blocked",
    replacement: "thành phần công bố có Alcohol; không có dữ liệu nào ghi sản phẩm chứa cồn công nghiệp",
    effectiveFrom: new Date("2026-08-13T00:00:00.000Z"),
  },
  {
    id: "claim-alcohol-free-short-form",
    phrase: "không cồn",
    status: "blocked",
    replacement: "Stopirex có Alcohol dùng làm dung môi trong ngưỡng an toàn của công thức",
    effectiveFrom: new Date("2026-08-13T00:00:00.000Z"),
  },
  {
    id: "claim-no-smell-contradicts-test",
    phrase: "không có mùi",
    status: "blocked",
    replacement: "không dùng hương thơm để che mùi; sản phẩm có mùi đặc trưng nhẹ và bay nhanh",
    effectiveFrom: new Date("2026-08-13T00:00:00.000Z"),
  },
  {
    id: "claim-no-smell-short-form",
    phrase: "không mùi",
    status: "blocked",
    replacement: "không dùng hương thơm để che mùi; sản phẩm có mùi đặc trưng nhẹ và bay nhanh",
    effectiveFrom: new Date("2026-08-13T00:00:00.000Z"),
  },
];

import {
  assertCanonicalClaimsSupported,
  assertCanonicalFactApplicability,
  type CanonicalKnowledgeResolution,
} from "./knowledgeResolver.js";
import { assertRequiredResponseFactsPresent, type RequiredResponseFact } from "./responseContract.js";
import { missingRequiredAnswerTopics } from "./requiredAnswerTopics.js";
import type { TurnContextSnapshot } from "./turnContext.js";

export type FinalResponseValidationCategory =
  "knowledge" | "memory" | "money" | "receipt" | "coverage" | "security" | "render";

export type FinalResponseValidationIssue = {
  category: FinalResponseValidationCategory;
  code: string;
  affectedBlock: string;
  evidenceRefs: string[];
  repairable: boolean;
  requiredContextChange: boolean;
};

export class FinalResponseValidationError extends Error {
  constructor(readonly issues: readonly FinalResponseValidationIssue[]) {
    super(issues.map((issue) => issue.code).join(","));
    this.name = "FinalResponseValidationError";
  }
}

export function validateFinalResponse(input: {
  reply: string;
  customerMessage: string;
  snapshot: TurnContextSnapshot;
  canonicalResolution: CanonicalKnowledgeResolution;
  executionSummary: string;
  requiredFacts: readonly RequiredResponseFact[];
}): FinalResponseValidationIssue[] {
  const issues: FinalResponseValidationIssue[] = [];
  const add = (issue: FinalResponseValidationIssue) => {
    if (!issues.some((candidate) => candidate.code === issue.code)) issues.push(issue);
  };

  if (/\{\{[^}]+\}\}|\[[A-Z_][A-Z0-9_]*\]|undefined|null_placeholder/iu.test(input.reply)) {
    add({
      category: "render",
      code: "final_response_unresolved_placeholder",
      affectedBlock: affectedBlock(input.reply, /\{\{|\[[A-Z_]/u),
      evidenceRefs: [],
      repairable: true,
      requiredContextChange: false,
    });
  }
  if (
    /VERIFIED TURN CONTEXT|acceptedMutations|factLedger|context_only|schemaVersion|chain[- ]of[- ]thought/iu.test(
      input.reply,
    )
  ) {
    add({
      category: "security",
      code: "final_response_internal_context_leak",
      affectedBlock: affectedBlock(
        input.reply,
        /VERIFIED TURN CONTEXT|acceptedMutations|factLedger|context_only|schemaVersion/iu,
      ),
      evidenceRefs: [],
      repairable: true,
      requiredContextChange: false,
    });
  }
  if (/\b(?:superseded|memory engine|thao tác memory|trạng thái nội bộ)\b/iu.test(input.reply)) {
    add({
      category: "memory",
      code: "final_response_memory_meta_language",
      affectedBlock: affectedBlock(
        input.reply,
        /superseded|memory engine|thao tác memory|trạng thái nội bộ/iu,
      ),
      evidenceRefs: input.snapshot.memoryFacts.map((fact) => fact.evidenceRef),
      repairable: true,
      requiredContextChange: false,
    });
  }

  for (const fact of input.snapshot.memoryFacts.filter((item) => item.usage === "must_say")) {
    if (memoryFactExpressed(fact.key, fact.value, input.reply)) continue;
    add({
      category: "memory",
      code: `final_response_required_memory_fact_missing:${fact.id}`,
      affectedBlock: input.reply,
      evidenceRefs: [fact.evidenceRef],
      repairable: true,
      requiredContextChange: false,
    });
  }

  collectGuardIssue(
    issues,
    () =>
      assertCanonicalFactApplicability({
        reply: input.reply,
        authoritativeReply: input.executionSummary,
        resolution: input.canonicalResolution,
      }),
    (error) => ({
      category: "money",
      code: error instanceof Error ? error.message : "final_response_money_guard",
      affectedBlock: input.reply,
      evidenceRefs: input.snapshot.money.map(
        (money) => `${money.sourceRef}@${money.sourceVersion}:${money.role}`,
      ),
      repairable: true,
      requiredContextChange: /unresolved|conflicting/u.test(error instanceof Error ? error.message : ""),
    }),
  );
  collectGuardIssue(
    issues,
    () =>
      assertCanonicalClaimsSupported({
        reply: input.reply,
        authoritativeReply: input.executionSummary,
        resolution: input.canonicalResolution,
      }),
    (error) => ({
      category: "knowledge",
      code: error instanceof Error ? error.message : "final_response_claim_guard",
      affectedBlock: input.reply,
      evidenceRefs: input.snapshot.knowledgeFacts.map((fact) => `${fact.sourceId}@${fact.sourceVersion}`),
      repairable: true,
      requiredContextChange: input.snapshot.knowledgeFacts.length === 0,
    }),
  );
  collectGuardIssue(
    issues,
    () => assertRequiredResponseFactsPresent(input.requiredFacts, input.reply),
    (error) => ({
      category: "coverage",
      code: error instanceof Error ? error.message : "final_response_required_fact_missing",
      affectedBlock: input.reply,
      evidenceRefs: input.requiredFacts.map((fact) => fact.id),
      repairable: true,
      requiredContextChange: false,
    }),
  );

  const missingTopics = missingRequiredAnswerTopics(input.customerMessage, input.reply);
  if (missingTopics.length > 0) {
    add({
      category: "coverage",
      code: `final_response_missing_topics:${missingTopics.join(",")}`,
      affectedBlock: input.reply,
      evidenceRefs: missingTopics,
      repairable: true,
      requiredContextChange: false,
    });
  }

  for (const claim of transactionClaims(input.reply)) {
    const matchingReceipt = input.snapshot.receipts.some(
      (receipt) => receipt.status === "succeeded" && claim.receiptTypes.includes(receipt.type),
    );
    if (!matchingReceipt) {
      add({
        category: "receipt",
        code: `final_response_missing_receipt:${claim.code}`,
        affectedBlock: claim.block,
        evidenceRefs: input.snapshot.receipts.map((receipt) => receipt.id),
        repairable: true,
        requiredContextChange: true,
      });
    }
  }
  return issues;
}

export function assertFinalResponseValid(input: Parameters<typeof validateFinalResponse>[0]): void {
  const issues = validateFinalResponse(input);
  if (issues.length > 0) throw new FinalResponseValidationError(issues);
}

function collectGuardIssue(
  issues: FinalResponseValidationIssue[],
  assert: () => void,
  issue: (error: unknown) => FinalResponseValidationIssue,
): void {
  try {
    assert();
  } catch (error) {
    issues.push(issue(error));
  }
}

function transactionClaims(reply: string): Array<{
  code: string;
  block: string;
  receiptTypes: string[];
}> {
  const candidates = [
    {
      code: "order_created",
      pattern: /(?:đã tạo|đã tiếp nhận)\s+(?:thông tin\s+)?đơn(?: hàng)?/iu,
      receiptTypes: ["create_order"],
    },
    {
      code: "shipment_created",
      pattern: /(?:đã tạo vận đơn|mã vận đơn (?:là|của mình))/iu,
      receiptTypes: ["create_shipment"],
    },
    {
      code: "human_handoff",
      pattern: /đã (?:chuyển|nhờ)\s+(?:bộ phận|nhân viên|CSKH)/iu,
      receiptTypes: ["handoff_to_human", "start_customer_care"],
    },
    {
      code: "customer_data_saved",
      pattern:
        /đã (?:ghi nhận|lưu|cập nhật)\s+(?:tên|SĐT|số điện thoại|địa chỉ|ghi chú|số lượng|lịch|tình trạng|thông tin)/iu,
      receiptTypes: [
        "record_fact",
        "set_quantity",
        "set_recipient_name",
        "set_phone",
        "set_address",
        "set_delivery_note",
      ],
    },
  ];
  return candidates.flatMap((candidate) => {
    const match = candidate.pattern.exec(reply);
    return match
      ? [
          {
            code: candidate.code,
            block: affectedBlock(reply, candidate.pattern),
            receiptTypes: candidate.receiptTypes,
          },
        ]
      : [];
  });
}

function affectedBlock(reply: string, pattern: RegExp): string {
  return (reply.split(/\n{2,}|(?<=[.!?])\s+/u).find((block) => pattern.test(block)) ?? reply).slice(0, 500);
}

function memoryFactExpressed(key: string, value: string | number | boolean, reply: string): boolean {
  const text = normalize(reply);
  if (key === "exercise_schedule" && typeof value === "string") {
    const [period, rawDays] = value.split("|");
    const days = rawDays?.split(",").filter(Boolean) ?? [];
    const periodCovered =
      period === "morning" ? /\bsang\b/u.test(text) : period === "evening" ? /\btoi\b/u.test(text) : true;
    return periodCovered && days.every((day) => new RegExp(`(?:^|\\D)${day}(?:\\D|$)`, "u").test(text));
  }
  if (key === "skin_type") {
    return value === "sensitive"
      ? /nhay cam|sensitive/u.test(text)
      : value === "normal"
        ? /binh thuong|\bbt\b/u.test(text)
        : false;
  }
  if (key === "sweat_concern") {
    return value === true
      ? /mo hoi|uot ao|dam ao/u.test(text)
      : /khong.{0,20}(?:mo hoi|uot ao|dam ao)/u.test(text);
  }
  if (key === "odor_severity") {
    if (value === "mild") return /mui.{0,20}(?:nhe|khong nang|khong dang ke)/u.test(text);
    if (value === "strong") return /mui.{0,20}(?:nang|nhieu|ro)/u.test(text);
    if (value === "none") return /khong.{0,15}(?:mui|hoi)/u.test(text);
  }
  const valueTokens = normalize(String(value))
    .split(/[^a-z0-9]+/u)
    .filter((token) => token.length >= 2);
  return valueTokens.length > 0 && valueTokens.every((token) => text.includes(token));
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

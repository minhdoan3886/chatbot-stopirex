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
  severity: "warning" | "error" | "critical";
  code: string;
  affectedBlock: string;
  evidenceRefs: string[];
  repairable: boolean;
  requiredContextChange: boolean;
};

type FinalResponseValidationIssueDraft = Omit<FinalResponseValidationIssue, "severity"> & {
  severity?: FinalResponseValidationIssue["severity"];
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
  const add = (issue: FinalResponseValidationIssueDraft) => {
    if (!issues.some((candidate) => candidate.code === issue.code)) issues.push(withSeverity(issue));
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

  for (const fact of input.snapshot.memoryFacts.filter((item) => item.usage !== "disallowed")) {
    const assessment = assessMemoryFactExpression(fact, input.reply, input.snapshot.activeSubjectId);
    if (assessment === "supported" || (assessment === "not_mentioned" && fact.usage !== "must_say")) {
      continue;
    }
    const code =
      assessment === "contradicted"
        ? `final_response_memory_fact_contradicted:${fact.id}`
        : assessment === "wrong_subject"
          ? `final_response_memory_fact_wrong_subject:${fact.id}`
          : assessment === "wrong_product"
            ? `final_response_memory_fact_wrong_product:${fact.id}`
            : `final_response_required_memory_fact_missing:${fact.id}`;
    add({
      category: "memory",
      code,
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
        allowedMoney: input.snapshot.money,
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
        reply: knowledgeReplyForValidation(input.reply, input.snapshot),
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

  for (const claim of transactionClaims(input.reply, input.customerMessage)) {
    const matchingReceipt = input.snapshot.receipts.some((receipt) => {
      if (receipt.status !== "succeeded" || !claim.stages.includes(receipt.stage ?? "legacy")) return false;
      if (!claim.receiptTypes.includes(receipt.type)) return false;
      if (claim.field && (claim.field !== receipt.field || !receipt.valueRef)) return false;
      if (!receipt.sourceVersion) return false;
      if (!claim.historical && (!receipt.operationId || !receipt.resourceRef || !receipt.resultVersion)) {
        return false;
      }
      if (!claim.historical && receipt.operationId !== input.snapshot.turnId) return false;
      return true;
    });
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
  issue: (error: unknown) => FinalResponseValidationIssueDraft,
): void {
  try {
    assert();
  } catch (error) {
    issues.push(withSeverity(issue(error)));
  }
}

function withSeverity(issue: FinalResponseValidationIssueDraft): FinalResponseValidationIssue {
  return {
    ...issue,
    severity:
      issue.severity ??
      (["security", "receipt", "money"].includes(issue.category)
        ? "critical"
        : ["knowledge", "memory", "render"].includes(issue.category)
          ? "error"
          : "warning"),
  };
}

function transactionClaims(
  reply: string,
  customerMessage: string,
): Array<{
  code: string;
  block: string;
  receiptTypes: string[];
  field?: string;
  stages: string[];
  historical: boolean;
}> {
  const candidates = [
    {
      code: "order_created",
      pattern:
        /(?:(?:đã\s+)?(?:tạo|tiếp nhận)\s+(?:thông tin\s+)?đơn(?: hàng)?(?:.{0,40}\b(?:xong|rồi|thành công)\b)?|đơn(?: hàng)?(?:.{0,30})\b(?:lên|tạo)\s+thành công\b)/iu,
      receiptTypes: ["create_order"],
      stages: ["committed", "completed"],
    },
    {
      code: "shipment_created",
      pattern: /(?:đã tạo vận đơn|mã vận đơn (?:là|của mình))/iu,
      receiptTypes: ["create_shipment"],
      stages: ["completed"],
    },
    {
      code: "human_handoff",
      pattern: /đã (?:chuyển|nhờ)\s+(?:bộ phận|nhân viên|CSKH)/iu,
      receiptTypes: ["handoff_to_human", "start_customer_care"],
      stages: ["completed"],
    },
    {
      code: "recipient_name_saved",
      pattern: completedFieldAction(/(?:tên|tên người nhận)/u),
      receiptTypes: ["set_recipient_name"],
      field: "recipientName",
      stages: ["committed", "completed"],
    },
    {
      code: "phone_saved",
      pattern: completedFieldAction(/(?:SĐT|số điện thoại)/u),
      receiptTypes: ["set_phone"],
      field: "phone",
      stages: ["committed", "completed"],
    },
    {
      code: "address_saved",
      pattern: completedFieldAction(/địa chỉ/u),
      receiptTypes: ["set_address"],
      field: "legacyAddress",
      stages: ["committed", "completed"],
    },
    {
      code: "delivery_note_saved",
      pattern: completedFieldAction(/ghi chú/u),
      receiptTypes: ["set_delivery_note"],
      field: "deliveryNote",
      stages: ["committed", "completed"],
    },
    {
      code: "quantity_saved",
      pattern: completedFieldAction(/(?:số lượng|mình (?:chọn|lấy|muốn lấy))/u),
      receiptTypes: ["set_quantity"],
      field: "quantity",
      stages: ["committed", "completed"],
    },
    {
      code: "conversation_fact_saved",
      pattern: completedFieldAction(/(?:lịch|tình trạng)/u),
      receiptTypes: ["record_fact"],
      stages: ["committed", "completed"],
    },
    {
      code: "customer_data_saved",
      pattern: completedFieldAction(/thông tin/u),
      receiptTypes: [
        "record_fact",
        "set_quantity",
        "set_recipient_name",
        "set_phone",
        "set_address",
        "set_delivery_note",
      ],
      stages: ["committed", "completed"],
    },
  ];
  return candidates.flatMap((candidate) => {
    const match = candidate.pattern.exec(reply);
    if (!match) return [];
    const block = affectedBlock(reply, candidate.pattern);
    const historicalInBlock = /\b(?:trước đây|lần trước|địa chỉ cũ|thông tin cũ|lịch sử)\b/iu.test(block);
    const currentInBlock = /\b(?:mới|vừa|giờ|hôm nay|lúc này|cập nhật lại|đổi sang)\b/iu.test(block);
    const historicalRequest = /\b(?:trước đây|lần trước|địa chỉ cũ|thông tin cũ|lịch sử)\b/iu.test(
      customerMessage,
    );
    return [
      {
        code: candidate.code,
        block,
        receiptTypes: candidate.receiptTypes,
        stages: candidate.stages,
        historical: historicalInBlock || (historicalRequest && !currentInBlock),
        ...(candidate.field ? { field: candidate.field } : {}),
      },
    ];
  });
}

function completedFieldAction(field: RegExp): RegExp {
  const source = field.source;
  return new RegExp(
    String.raw`(?:(?:đã\s+)(?:ghi nhận|lưu|cập nhật)(?:\s+lại)?\s+${source}|(?:ghi nhận|lưu|cập nhật)(?:\s+lại)?\s+${source}.{0,40}\b(?:xong|rồi|thành công)\b)`,
    "iu",
  );
}

function affectedBlock(reply: string, pattern: RegExp): string {
  return (reply.split(/\n{2,}|(?<=[.!?])\s+/u).find((block) => pattern.test(block)) ?? reply).slice(0, 500);
}

type MemoryExpressionAssessment =
  "supported" | "not_mentioned" | "contradicted" | "wrong_subject" | "wrong_product";

function assessMemoryFactExpression(
  fact: TurnContextSnapshot["memoryFacts"][number],
  reply: string,
  activeSubjectId: string,
): MemoryExpressionAssessment {
  const relevantBlocks = normalizedBlocks(reply).filter(
    (block) => !isConditionalOrHypotheticalBlock(block) && blockMentionsMemoryPredicate(fact.key, block),
  );
  if (relevantBlocks.length === 0) return "not_mentioned";
  const correctlyScoped = relevantBlocks.filter(
    (block) => (explicitSubjectForBlock(block) ?? activeSubjectId) === fact.subjectId,
  );
  // A statement about another person is not a statement about this fact. A
  // must-say fact will still become missing, while context-only facts remain
  // silent instead of manufacturing a wrong-subject contradiction.
  if (correctlyScoped.length === 0) return "not_mentioned";
  if (
    fact.product === "other_rollon" &&
    correctlyScoped.some((block) => /\bstopirex\b/u.test(block) && !mentionsOtherRollon(block))
  ) {
    return "wrong_product";
  }
  if (
    fact.product === "stopirex" &&
    correctlyScoped.some((block) => mentionsOtherRollon(block) && !/\bstopirex\b/u.test(block))
  ) {
    return "wrong_product";
  }
  if (
    fact.key === "hair_removal_time" &&
    fact.temporal === "past" &&
    correctlyScoped.some((block) => /\b(?:hom nay|bua nay|bua ni)\b/u.test(block))
  ) {
    return "contradicted";
  }
  const hasSupport = correctlyScoped.some((block) => memoryBlockSupportsFact(fact.key, fact.value, block));
  // A habitual sensitivity and a specific recent no-reaction event can both
  // be true. If the habitual fact is stated affirmatively, do not let the
  // episodic clause erase it merely because both appear in one recap block.
  if (fact.temporal === "habitual" && fact.key === "skin_sensitivity_context" && hasSupport) {
    return "supported";
  }
  const contradictionBlocks =
    fact.temporal === "habitual"
      ? correctlyScoped.filter(
          (block) => !/\b(?:lan gan nhat|lan nay|hom qua|bua qua|hqua|hom nay|bua nay)\b/u.test(block),
        )
      : correctlyScoped;
  if (contradictionBlocks.some((block) => memoryBlockContradictsFact(fact.key, fact.value, block))) {
    return "contradicted";
  }
  return hasSupport ? "supported" : "not_mentioned";
}

function memoryBlockSupportsFact(key: string, value: string | number | boolean, text: string): boolean {
  if (key === "exercise_schedule" && typeof value === "string") {
    const [period, rawDays] = value.split("|");
    const days = rawDays?.split(",").filter(Boolean) ?? [];
    const periodCovered =
      period === "morning" ? /\bsang\b/u.test(text) : period === "evening" ? /\btoi\b/u.test(text) : true;
    return periodCovered && days.every((day) => new RegExp(`(?:^|\\D)${day}(?:\\D|$)`, "u").test(text));
  }
  if (key === "skin_type") {
    return value === "sensitive"
      ? /(?:nhay cam|sensitive|de (?:bi )?kich ung)/u.test(text) &&
          (!/\bkhong (?:phai (?:la )?)?(?:da )?(?:nhay cam|sensitive|de (?:bi )?kich ung)\b/u.test(text) ||
            /\bkhong (?:phai (?:la )?)?khong (?:nhay cam|sensitive|de (?:bi )?kich ung)\b/u.test(text))
      : value === "normal"
        ? /(?:da )?binh thuong|\bbt\b|da thuong|\bkhong (?:phai (?:la )?)?(?:da )?nhay cam\b/u.test(text)
        : false;
  }
  if (key === "sweat_concern") {
    const negated = /khong.{0,20}(?:mo hoi|uot ao|dam ao)/u.test(text);
    return value === true ? !negated && /mo hoi|uot ao|dam ao/u.test(text) : negated;
  }
  if (key === "odor_severity") {
    if (value === "mild") return /mui.{0,20}(?:nhe|khong nang|khong dang ke)/u.test(text);
    if (value === "strong")
      return (
        !/khong.{0,15}(?:mui|hoi)|mui.{0,20}(?:nhe|khong nang)/u.test(text) &&
        /mui.{0,20}(?:nang|nhieu|ro)/u.test(text)
      );
    if (value === "none") return /khong.{0,15}(?:mui|hoi)/u.test(text);
  }
  if (key === "skin_sensitivity_context" && value === "after_hair_removal") {
    return (
      /(?:xot|nhay cam|kich ung).{0,35}(?:cao|wax|triet|nho long)/u.test(text) ||
      /(?:cao|wax|triet|nho long).{0,35}(?:xot|nhay cam|kich ung)/u.test(text)
    );
  }
  if (key === "hair_removal_time") {
    if (value === "today") return /\b(?:hom nay|bua nay|bua ni|moi (?:cao|wax|triet))\b/u.test(text);
    if (value === "yesterday") return /\b(?:hom qua|bua qua|hqua)\b/u.test(text);
  }
  if (key === "hair_removal_reaction" && value === "none") {
    return /(?:khong|ko|k).{0,15}(?:xot|rat|ngua|kich ung)/u.test(text);
  }
  if (key === "product_reaction") {
    if (value === "itching") return /\bngua\b/u.test(text) && !/\b(?:khong|ko|k)\s+ngua\b/u.test(text);
    if (value === "redness") return /\b(?:do da|bi do|noi do)\b/u.test(text);
    if (value === "irritation") {
      return (
        /\b(?:kich ung|phan ung|xot|rat da)\b/u.test(text) &&
        !/\b(?:khong|ko|k).{0,12}(?:kich ung|phan ung|xot|rat da)\b/u.test(text)
      );
    }
  }
  const valueTokens = normalize(String(value))
    .split(/[^a-z0-9]+/u)
    .filter((token) => token.length >= 2);
  return valueTokens.length > 0 && valueTokens.every((token) => text.includes(token));
}

function memoryBlockContradictsFact(key: string, value: string | number | boolean, text: string): boolean {
  if (key === "skin_type") {
    if (value === "sensitive") {
      return (
        (/\bkhong (?:phai (?:la )?)?(?:da )?(?:nhay cam|sensitive|de (?:bi )?kich ung)\b/u.test(text) &&
          !/\bkhong (?:phai (?:la )?)?khong (?:nhay cam|sensitive|de (?:bi )?kich ung)\b/u.test(text)) ||
        /(?:da )?(?:binh thuong|da thuong)\b/u.test(text)
      );
    }
    if (value === "normal") {
      return (
        /nhay cam|sensitive|de (?:bi )?kich ung/u.test(text) &&
        !/\bkhong (?:phai (?:la )?)?(?:da )?(?:nhay cam|sensitive|de (?:bi )?kich ung)\b/u.test(text)
      );
    }
  }
  if (key === "sweat_concern") {
    const negated = /khong.{0,20}(?:mo hoi|uot ao|dam ao)/u.test(text);
    return value === true ? negated : !negated && /mo hoi|uot ao|dam ao/u.test(text);
  }
  if (key === "odor_severity") {
    if (value === "none") return /mui.{0,20}(?:nang|nhieu|ro)|co mui/u.test(text);
    if (value === "strong") return /khong.{0,15}(?:mui|hoi)|mui.{0,20}(?:nhe|khong nang)/u.test(text);
    if (value === "mild") {
      return (
        (/mui.{0,20}(?:nang|nhieu|ro)/u.test(text) &&
          !/mui.{0,20}(?:khong nang|khong nhieu|khong ro)/u.test(text)) ||
        /khong.{0,15}(?:mui|hoi)/u.test(text)
      );
    }
  }
  if (key === "skin_sensitivity_context" && value === "after_hair_removal") {
    return /(?:khong|ko|k).{0,15}(?:xot|nhay cam|kich ung).{0,35}(?:cao|wax|triet|nho long)/u.test(text);
  }
  if (key === "hair_removal_time") {
    if (value === "today") return /\b(?:hom qua|bua qua|hqua)\b/u.test(text);
    if (value === "yesterday") return /\b(?:hom nay|bua nay|bua ni)\b/u.test(text);
  }
  if (key === "hair_removal_reaction" && value === "none") {
    return (
      /(?:cao|wax|triet|nho long).{0,35}(?:xot|rat|ngua|kich ung)/u.test(text) &&
      !/(?:khong|ko|k).{0,15}(?:xot|rat|ngua|kich ung)/u.test(text)
    );
  }
  if (key === "product_reaction") {
    if (value === "itching") return /\b(?:khong|ko|k)\s+ngua\b/u.test(text);
    if (value === "redness") return /\b(?:khong|ko|k).{0,12}(?:do da|bi do|noi do)\b/u.test(text);
    if (value === "irritation") {
      return /\b(?:khong|ko|k).{0,12}(?:kich ung|phan ung|xot|rat da)\b/u.test(text);
    }
  }
  return false;
}

function blockMentionsMemoryPredicate(key: string, text: string): boolean {
  if (key === "skin_type" || key === "skin_sensitivity_context") {
    return (
      /\b(?:da (?:minh|tui|toi|anh|chi|em)|(?:minh|tui|toi|anh|chi|em) (?:co )?da|da nhay cam la em|da binh thuong)\b/u.test(
        text,
      ) ||
      (/^(?:da )?(?:nhay cam|sensitive|de kich ung)\b/u.test(text) &&
        !/\b(?:stopirex|san pham|phu hop)\b/u.test(text))
    );
  }
  if (key === "sweat_concern") return /mo hoi|uot ao|dam ao/u.test(text);
  if (key === "odor_severity") return /mui|hoi nach/u.test(text);
  if (key === "exercise_schedule") return /gym|tap|sang|toi|[2-7][ -][2-7]/u.test(text);
  if (key === "hair_removal_time" || key === "hair_removal_reaction")
    return /cao|wax|triet|nho long/u.test(text);
  if (key === "product_reaction") return /rat|ngua|do|kich ung|phan ung/u.test(text);
  // Unknown predicates are context only until a targeted semantic check is
  // added. Treating every response block as a mention would manufacture
  // wrong-subject or missing-fact failures for unrelated customer replies.
  return false;
}

function normalizedBlocks(reply: string): string[] {
  return reply
    .split(
      /\n{2,}|(?<=[.!?])\s+|\s+\b(?:nhưng|nhung|còn|con)\b\s+|\s+và\s+(?=(?:em gái|em trai|em mình|em tui|em tôi|bạn mình|bạn tui|bạn tôi|minh|mình|tui|tôi|anh|chị)\b)|\s*[,;]\s*(?=(?:em gái|em trai|em mình|em tui|em tôi|bạn mình|bạn tui|bạn tôi|minh|mình|tui|tôi|anh|chị)\b)/iu,
    )
    .map(normalize)
    .filter(Boolean);
}

function explicitSubjectForBlock(text: string): string | undefined {
  if (/\b(?:em gai|em trai|em minh|em tui|em toi|em ay|em cua minh|em cua tui|em cua toi)\b/u.test(text)) {
    return "sibling-1";
  }
  if (/\b(?:ban minh|ban tui|ban toi|ban cua minh|ban cua tui)\b/u.test(text)) return "friend-1";
  if (/\b(?:review|nguoi viet review)\b/u.test(text)) return "external-reviewer-1";
  if (/\b(?:minh|tui|toi|anh|chi)\b/u.test(text)) return "self";
  return undefined;
}

function isConditionalOrHypotheticalBlock(text: string): boolean {
  const withoutLeadIn = text.replace(/^(?:(?:da|a|ah|uh|um|oke|ok|vang|vâng|à|dạ)[,!:.]?\s*)+/iu, "");
  return /^(?:neu|gia su|gia nhu|truong hop|lo|nho dau)\b/u.test(withoutLeadIn);
}

function mentionsOtherRollon(text: string): boolean {
  return /\b(?:lan khac|loai khac|san pham khac|etiaxil|perspirex|nivea|romano)\b/u.test(text);
}

function knowledgeReplyForValidation(reply: string, snapshot: TurnContextSnapshot): string {
  return reply
    .split(/(?<=[.!?])\s+|\n+/u)
    .filter((block) => !isMemoryBoundPersonalExperience(block, snapshot))
    .join("\n");
}

function isMemoryBoundPersonalExperience(block: string, snapshot: TurnContextSnapshot): boolean {
  const text = normalize(block);
  if (
    !/\b(?:minh|toi|tui|em|anh|chi)\b/u.test(text) ||
    !/\b(?:stopirex|lan khac|loai khac|san pham khac|etiaxil|perspirex|nivea|romano)\b/u.test(text) ||
    !/\b(?:ngua|rat|xot|do da|kich ung|phan ung)\b/u.test(text)
  ) {
    return false;
  }
  // Do not let a supported experience hide an additional product assertion
  // in the same sentence.
  if (/\b(?:giup|ho tro|kiem soat|chua|tri|uong|an toan|phu hop|ngan ngua)\b/u.test(text)) {
    return false;
  }
  return snapshot.memoryFacts
    .filter((fact) => fact.key === "product_reaction" && fact.usage !== "disallowed")
    .some((fact) => assessMemoryFactExpression(fact, block, snapshot.activeSubjectId) === "supported");
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

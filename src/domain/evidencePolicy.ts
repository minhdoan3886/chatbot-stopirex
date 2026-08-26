import type { CustomerIntent } from "./consultation.js";

export type IntentEvidencePolicy = {
  requiredKnowledgeIds: readonly string[];
  allowedNextAction: "diagnose_prior_product" | "none";
  forbidSalesCta: boolean;
};

export type IntentEvidencePolicyViolation =
  | "intent_forbidden_sales_cta"
  | "intent_missing_required_evidence"
  | "intent_missing_allowed_next_action";

const policies: Readonly<Partial<Record<CustomerIntent, IntentEvidencePolicy>>> = Object.freeze({
  efficacy_objection: {
    requiredKnowledgeIds: [
      "product-official-ingredient-list-2022",
      "product-training-ingredient-roles",
      "product-comparison-traditional-rollon",
      "mechanism-control-not-permanent",
    ],
    allowedNextAction: "diagnose_prior_product",
    forbidSalesCta: true,
  },
});

/**
 * Evidence policies do not write the customer reply and do not replace LLM
 * routing. They only define the minimum approved context and conversation
 * boundary for high-risk intents.
 */
export function evidencePolicyForIntent(
  intent: CustomerIntent | undefined,
): IntentEvidencePolicy | undefined {
  return intent ? policies[intent] : undefined;
}

export function requiredKnowledgeIdsForIntent(intent: CustomerIntent | undefined): readonly string[] {
  return evidencePolicyForIntent(intent)?.requiredKnowledgeIds ?? [];
}

export function replyViolatesIntentEvidencePolicy(
  intent: CustomerIntent | undefined,
  reply: string,
): boolean {
  return intentEvidencePolicyViolation(intent, reply) !== undefined;
}

export function intentEvidencePolicyViolation(
  intent: CustomerIntent | undefined,
  reply: string,
): IntentEvidencePolicyViolation | undefined {
  const policy = evidencePolicyForIntent(intent);
  if (!policy) return undefined;
  const text = normalize(reply);
  const hasSalesCta =
    /(?:muon|chon|lay|chot|dat|gui|giu)\s+(?:(?:giup|cho)\s+)?(?:phuong an\s+)?(?:may|bao nhieu|[1-5]|mot|hai|ba|bon|nam)?\s*(?:lo|combo)\b/.test(
      text,
    ) ||
    /(?:len|tao)\s+don\b/.test(text);
  if (policy.forbidSalesCta && hasSalesCta) return "intent_forbidden_sales_cta";

  if (intent === "efficacy_objection") {
    const hasRequiredEvidence =
      /\baluminium sesquichlorohydrate\b/.test(text) &&
      /\b(?:hoat chat\s+)?(?:ngan|uc che|giam)\s+tiet\s+mo\s+hoi\b/.test(text);
    if (!hasRequiredEvidence) return "intent_missing_required_evidence";

    const hasPriorProductQuestion =
      /[?？]/u.test(reply) &&
      /\b(?:tung dung|nhung loai .*dung|loai .*dung|lan hang ngay|lan thuong)\b/.test(text) &&
      /\b(?:ngan tiet mo hoi chuyen sau|dong chuyen sau|chuyen sau)\b/.test(text);
    if (policy.allowedNextAction === "diagnose_prior_product" && !hasPriorProductQuestion) {
      return "intent_missing_allowed_next_action";
    }
  }

  return undefined;
}

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[đĐ]/g, "d")
    .toLocaleLowerCase("vi-VN")
    .replace(/[^a-z0-9]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

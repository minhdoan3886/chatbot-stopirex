import type { CustomerIntent } from "./consultation.js";

export type IntentEvidencePolicy = {
  requiredKnowledgeIds: readonly string[];
  allowedNextAction: "diagnose_prior_product" | "none";
  forbidSalesCta: boolean;
};

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
  const policy = evidencePolicyForIntent(intent);
  if (!policy?.forbidSalesCta) return false;
  const text = normalize(reply);
  return (
    /(?:muon|chon|lay|chot|dat|gui|giu)\s+(?:(?:giup|cho)\s+)?(?:phuong an\s+)?(?:may|bao nhieu|[1-5]|mot|hai|ba|bon|nam)?\s*(?:lo|combo)\b/.test(
      text,
    ) ||
    /(?:len|tao)\s+don\b/.test(text)
  );
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

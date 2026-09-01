export type ResponseGuardOutcome = "allow" | "repair" | "block";

export type ResponseSource =
  | "llm_draft"
  | "llm_repair"
  | "workflow_safe_fallback"
  | "approved_knowledge_fallback"
  | "customer_care_workflow"
  | "llm_disabled";

export type ResponseGuardVerdict = {
  outcome: ResponseGuardOutcome;
  reason: string;
  hard: boolean;
  source: ResponseSource;
};

const hardFailurePrefixes = [
  "claim_guard",
  "unsupported_claim_guard",
  "fact_applicability_guard",
  "commerce_guard",
  "action_grounding_guard",
  "price_change_guard",
  "response_state_mismatch",
  "critical_direction_guard",
] as const;

/**
 * Only factual, safety, commerce and executed-state violations are hard
 * blocks. Style, length, lexical coverage and missing citations request a
 * repair; they must never silently replace an otherwise relevant LLM answer.
 */
export function responseGuardVerdict(input: {
  reason?: string;
  source: ResponseSource;
  accepted?: boolean;
}): ResponseGuardVerdict {
  const reason = input.reason?.trim() || (input.accepted ? "validated" : "unknown_validation_failure");
  if (input.accepted) {
    return { outcome: "allow", reason, hard: false, source: input.source };
  }
  const hard = hardFailurePrefixes.some((prefix) => reason.startsWith(prefix));
  return {
    outcome: hard ? "block" : "repair",
    reason,
    hard,
    source: input.source,
  };
}

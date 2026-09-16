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

export type ResponseAttention = {
  status: "needs_attention";
  severity: "attention" | "critical";
  code: string;
  source: ResponseSource;
  at: string;
  traceId?: string;
};

export type ResponseTraceSummary = {
  schemaVersion: 1;
  turnId?: string;
  turnContextVersion?: number;
  workflowResponseRef: string;
  draftResponseRef?: string;
  finalResponseRef: string;
  logicalModelCalls: number;
  repairAttempts: number;
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

export function responseAttentionForVerdict(
  verdict: ResponseGuardVerdict,
  input: { at?: Date; traceId?: string } = {},
): ResponseAttention | undefined {
  if (verdict.outcome === "allow") return undefined;
  const code = verdict.reason.split(":", 1)[0]?.trim() || "response_validation_failed";
  return {
    status: "needs_attention",
    severity: verdict.hard ? "critical" : "attention",
    code,
    source: verdict.source,
    at: (input.at ?? new Date()).toISOString(),
    ...(input.traceId ? { traceId: input.traceId } : {}),
  };
}

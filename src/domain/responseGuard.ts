import { createHash } from "node:crypto";
import type { TurnScope } from "./turnContext.js";

export type ResponseGuardOutcome = "allow" | "repair" | "block";

export type FinalPayloadChannel = "messenger" | "comment_public" | "comment_private" | "followup";
export type DeliveryPermission = "standard" | "handoff_ack";

export type DeliveryDecision = {
  outcome: "allow" | "block";
  responseRef: string;
  contextRef: string;
  channel: FinalPayloadChannel;
  permission: DeliveryPermission;
  recipientId: string;
  sourceEventIds: readonly string[];
  partChannels: readonly FinalPayloadChannel[];
  scope: TurnScope;
  inboundRevision: number;
  /** Durable conversation version assigned by the commit that created the outbox. */
  stateVersion: number;
  requiredReceiptRefs: readonly string[];
};

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
  /** Authorization fields are attached only after the exact final payload was checked. */
  responseRef?: string;
  contextRef?: string;
  channel?: FinalPayloadChannel;
  scope?: TurnScope;
  inboundRevision?: number;
  stateVersion?: number;
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
  validationStatus?: "validated" | "blocked" | "unchecked" | "needs_attention";
  contextRef?: string;
  validationIssueCodes?: string[];
  draftRejections?: Array<{ responseRef: string; reason: string }>;
};

/** Stable hash of the channel and ordered transport parts that were actually checked. */
export function responsePayloadRef(channel: FinalPayloadChannel, texts: readonly string[]): string {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify({ channel, texts: [...texts] }))
    .digest("hex")
    .slice(0, 16)}`;
}

export function responseContextRef(input: {
  scope: TurnScope;
  inboundRevision: number;
  stateVersion: number;
  turnId?: string;
}): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(input)).digest("hex").slice(0, 16)}`;
}

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

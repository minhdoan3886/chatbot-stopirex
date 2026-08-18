import { createHash } from "node:crypto";
import type { DemoChatResponse, DemoChatState } from "../services/demoChat.js";

export type MultiActionRolloutMode = "shadow" | "canary" | "enabled";
export type ActionExecutionMode = "legacy" | "multi_action";

export type ActionRolloutComparison = {
  mode: MultiActionRolloutMode;
  liveVariant: ActionExecutionMode;
  candidateVariant: ActionExecutionMode;
  intentMismatch: boolean;
  pipelineMismatch: boolean;
  handoffMismatch: boolean;
  clarificationMismatch: boolean;
  replyMismatch: boolean;
  rejectedActionCount: number;
  conflictCount: number;
  candidateHasMultipleActions: boolean;
  candidateNeedsClarification: boolean;
  legacy: ActionRolloutOutcome;
  candidate: ActionRolloutOutcome;
};

export type ActionRolloutOutcome = {
  intent?: string;
  pipeline: string;
  selectedRoute?: string;
  selectedQuantity?: number;
  botPaused: boolean;
  reply: string;
};

export function selectActionExecutionMode(input: {
  mode: MultiActionRolloutMode;
  canaryPercent: number;
  sessionId: string;
}): ActionExecutionMode {
  if (input.mode === "enabled") return "multi_action";
  if (input.mode === "shadow") return "legacy";
  const bucket =
    createHash("sha256").update(`multi-action-v1:${input.sessionId}`).digest().readUInt32BE(0) % 10_000;
  return bucket < Math.round(clampPercent(input.canaryPercent) * 100)
    ? "multi_action"
    : "legacy";
}

export function compareActionRollout(input: {
  mode: MultiActionRolloutMode;
  liveVariant: ActionExecutionMode;
  legacy: DemoChatResponse;
  candidate: DemoChatResponse;
}): ActionRolloutComparison {
  const legacy = outcome(input.legacy);
  const candidate = outcome(input.candidate);
  const candidatePlan = input.candidate.state.decisionTrace?.actionPlan;
  return {
    mode: input.mode,
    liveVariant: input.liveVariant,
    candidateVariant: "multi_action",
    intentMismatch: legacy.intent !== candidate.intent,
    pipelineMismatch: legacy.pipeline !== candidate.pipeline,
    handoffMismatch: handoffState(input.legacy.state) !== handoffState(input.candidate.state),
    clarificationMismatch:
      isClarification(input.legacy.state) !== isClarification(input.candidate.state),
    replyMismatch: normalizeReply(legacy.reply) !== normalizeReply(candidate.reply),
    rejectedActionCount: candidatePlan?.rejected.length ?? 0,
    conflictCount: candidatePlan?.conflicts.length ?? 0,
    candidateHasMultipleActions: candidatePlan?.hasMultipleActions ?? false,
    candidateNeedsClarification: candidatePlan?.shouldClarify ?? false,
    legacy,
    candidate,
  };
}

function outcome(result: DemoChatResponse): ActionRolloutOutcome {
  return {
    ...(result.state.lastIntent ? { intent: result.state.lastIntent } : {}),
    pipeline: result.state.pipeline,
    ...(result.state.decisionTrace?.selectedRoute
      ? { selectedRoute: result.state.decisionTrace.selectedRoute }
      : {}),
    ...(result.state.selectedQuantity
      ? { selectedQuantity: result.state.selectedQuantity }
      : {}),
    botPaused: result.state.botPaused,
    reply: result.reply,
  };
}

function handoffState(state: DemoChatState): string {
  return `${state.mode}:${state.botPaused}:${state.careIssue ?? "none"}`;
}

function isClarification(state: DemoChatState): boolean {
  return state.decisionTrace?.selectedRoute === "clarification" ||
    state.decisionTrace?.actionPlan?.shouldClarify === true;
}

function normalizeReply(value: string): string {
  return value.toLocaleLowerCase("vi-VN").replace(/\s+/gu, " ").trim();
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}


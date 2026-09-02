import type { ConversationAction, ConversationActionType } from "./conversationActions.js";
import type { ConversationCtaId } from "./consultation.js";

export type DialogueMode = "informational" | "ordering" | "support" | "clarification";

export type DialogueActSnapshot = {
  type: ConversationActionType | "cta" | "answer";
  topic?: string;
  evidence?: string[];
  source?: "llm" | "guardrail" | "state" | "assistant";
};

export type ExpectedDialogueInput = {
  kind: "quantity" | "recipientName" | "phone" | "legacyAddress" | "clarification" | "consultation";
  reason: string;
};

export type DialogueState = {
  version: number;
  mode: DialogueMode;
  lastUserActs: DialogueActSnapshot[];
  lastAssistantActs: DialogueActSnapshot[];
  pendingAsk?: {
    goal: string;
    requestedSlots: string[];
    askedAtTurn: number;
  };
  unresolvedTopics: string[];
  recentlyAnsweredFactIds: string[];
  expectedInputs: ExpectedDialogueInput[];
  correctionContext?: {
    field: string;
    previousValue: unknown;
    newValue?: unknown;
    evidence: string;
  };
};

export type DialogueStateEvent =
  | {
      type: "user_acts_observed";
      acts: readonly ConversationAction[];
      mode: DialogueMode;
    }
  | {
      type: "assistant_turn_committed";
      ctaId: ConversationCtaId;
      requestedSlots: string[];
      answeredFactIds: string[];
      unresolvedTopics: string[];
      turn: number;
      goal: string;
    }
  | {
      type: "correction_recorded";
      field: string;
      previousValue: unknown;
      newValue?: unknown;
      evidence: string;
    }
  | { type: "reset" };

export function initialDialogueState(): DialogueState {
  return {
    version: 0,
    mode: "informational",
    lastUserActs: [],
    lastAssistantActs: [],
    unresolvedTopics: [],
    recentlyAnsweredFactIds: [],
    expectedInputs: [],
  };
}

export function reduceDialogueState(current: DialogueState, event: DialogueStateEvent): DialogueState {
  if (event.type === "reset") return initialDialogueState();
  if (event.type === "correction_recorded") {
    return {
      ...current,
      version: current.version + 1,
      correctionContext: {
        field: event.field,
        previousValue: event.previousValue,
        ...(event.newValue !== undefined ? { newValue: event.newValue } : {}),
        evidence: event.evidence,
      },
    };
  }
  if (event.type === "user_acts_observed") {
    return {
      ...current,
      version: current.version + 1,
      mode: event.mode,
      lastUserActs: event.acts.map(snapshotAction),
      // A new customer act consumes the prior expected input when the matching
      // proposition is present. The next assistant turn will declare the next
      // expectation explicitly.
      expectedInputs: current.expectedInputs.filter(
        (expected) => !event.acts.some((action) => actionSatisfiesExpected(action, expected)),
      ),
    };
  }
  const expectedInputs = expectedInputsForCta(event.ctaId, event.requestedSlots);
  const assistantActs: DialogueActSnapshot[] = event.answeredFactIds.map((factId) => ({
    type: "answer",
    topic: factId,
    source: "assistant",
  }));
  if (event.ctaId !== "none") {
    assistantActs.push({ type: "cta", topic: event.ctaId, source: "assistant" });
  }
  const stateWithoutPendingAsk = { ...current };
  delete stateWithoutPendingAsk.pendingAsk;
  return {
    ...stateWithoutPendingAsk,
    version: current.version + 1,
    lastAssistantActs: assistantActs,
    ...(event.ctaId === "none"
      ? {}
      : {
          pendingAsk: {
            goal: event.goal,
            requestedSlots: [...event.requestedSlots],
            askedAtTurn: event.turn,
          },
        }),
    unresolvedTopics: [...new Set(event.unresolvedTopics)].slice(-12),
    recentlyAnsweredFactIds: [
      ...new Set([...current.recentlyAnsweredFactIds, ...event.answeredFactIds]),
    ].slice(-20),
    expectedInputs,
  };
}

export function dialogueModeFor(input: {
  actions: readonly ConversationAction[];
  selectedQuantity?: number;
  botPaused: boolean;
}): DialogueMode {
  if (
    input.botPaused ||
    input.actions.some((action) =>
      ["start_customer_care", "handoff_to_human", "stop_bot"].includes(action.type),
    )
  ) {
    return "support";
  }
  if (input.actions.some((action) => action.type === "pause_order")) return "clarification";
  if (
    input.selectedQuantity ||
    input.actions.some((action) =>
      ["select_quantity", "update_order", "continue_order_collection"].includes(action.type),
    )
  ) {
    return "ordering";
  }
  return "informational";
}

function snapshotAction(action: ConversationAction): DialogueActSnapshot {
  return {
    type: action.type,
    ...(action.type === "answer_question" ? { topic: action.topic } : {}),
    evidence: [...action.evidence],
    source: action.source,
  };
}

function actionSatisfiesExpected(action: ConversationAction, expected: ExpectedDialogueInput): boolean {
  if (expected.kind === "quantity") return action.type === "select_quantity";
  if (expected.kind === "clarification") return action.type !== "handoff_to_human";
  if (expected.kind === "consultation") return action.type === "record_fact";
  if (action.type !== "update_order") return false;
  return Object.prototype.hasOwnProperty.call(action.fields, expected.kind);
}

function expectedInputsForCta(
  ctaId: ConversationCtaId,
  requestedSlots: readonly string[],
): ExpectedDialogueInput[] {
  if (ctaId === "ask_quantity") return [{ kind: "quantity", reason: "preferred_cta" }];
  if (ctaId === "ask_clarification") return [{ kind: "clarification", reason: "preferred_cta" }];
  if (ctaId === "ask_primary_symptom" || ctaId === "ask_work_context") {
    return [{ kind: "consultation", reason: "preferred_cta" }];
  }
  const supported = new Set(["recipientName", "phone", "legacyAddress"]);
  return requestedSlots
    .filter((slot) => supported.has(slot))
    .map((slot) => ({
      kind: slot as ExpectedDialogueInput["kind"],
      reason: "missing_order_slot",
    }));
}

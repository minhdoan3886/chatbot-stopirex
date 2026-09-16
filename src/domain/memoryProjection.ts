import { createHash } from "node:crypto";
import type { ConversationFact, ConversationFactLedger } from "./conversationFacts.js";
import type { TurnMemoryFact } from "./turnContext.js";

export type MemoryProjection = {
  activeSubjectId: string;
  includeHistory: boolean;
  facts: TurnMemoryFact[];
  excluded: Array<{ factId: string; reason: string }>;
};

export function projectMemoryForTurn(input: {
  ledger?: ConversationFactLedger;
  customerMessage: string;
  at?: Date;
}): MemoryProjection {
  const at = input.at ?? new Date();
  const activeSubjectId = subjectForMessage(input.customerMessage);
  const includeHistory = asksForHistory(input.customerMessage);
  const asksForMemory = asksForMemoryRecap(input.customerMessage);
  const facts: TurnMemoryFact[] = [];
  const excluded: Array<{ factId: string; reason: string }> = [];

  for (const fact of input.ledger?.facts ?? []) {
    const reason = excludedReason(fact, { activeSubjectId, includeHistory, asksForMemory, at });
    if (reason) {
      excluded.push({ factId: fact.id, reason });
      continue;
    }
    const sameSubject = fact.subjectId === activeSubjectId;
    facts.push({
      id: fact.id,
      subjectId: fact.subjectId,
      key: fact.predicate,
      value: fact.value,
      sourceRef: `conversation_turn:${fact.sourceTurn}`,
      evidenceRef: evidenceRef(fact.evidence),
      sourceTurn: fact.sourceTurn,
      ...(fact.recordedAt ? { recordedAt: fact.recordedAt } : {}),
      ...(fact.eventAt ? { eventAt: fact.eventAt } : {}),
      temporal: fact.temporal,
      scenario: fact.scenario,
      source: fact.source,
      usage: asksForMemory && sameSubject ? "must_say" : sameSubject ? "may_say" : "context_only",
      relevanceReason: asksForMemory
        ? "customer_requested_memory_recap"
        : sameSubject
          ? "active_subject_current_fact"
          : "related_subject_context_only",
    });
  }

  return { activeSubjectId, includeHistory, facts: facts.slice(-32), excluded };
}

function excludedReason(
  fact: ConversationFact,
  input: { activeSubjectId: string; includeHistory: boolean; asksForMemory: boolean; at: Date },
): string | undefined {
  if (fact.status === "superseded" && !input.includeHistory) return "superseded_not_requested";
  if (fact.scenario === "hypothetical") return "hypothetical_not_customer_fact";
  if (fact.source === "copied_review" && fact.subjectId === "self") return "copied_review_not_self_fact";
  if ((fact.temporal === "today" || fact.temporal === "yesterday") && !fact.eventAt) {
    return "legacy_relative_time_unknown";
  }
  if (fact.eventAt && Number.isNaN(Date.parse(fact.eventAt))) return "invalid_event_time";
  if (fact.recordedAt && Date.parse(fact.recordedAt) > input.at.getTime()) return "recorded_in_future";
  if (
    !input.asksForMemory &&
    fact.subjectId !== input.activeSubjectId &&
    !explicitlyMentionsOtherSubject(fact)
  ) {
    return "different_subject_not_relevant";
  }
  return undefined;
}

function explicitlyMentionsOtherSubject(fact: ConversationFact): boolean {
  return ["friend-1", "sibling-1", "external-reviewer-1"].includes(fact.subjectId);
}

function subjectForMessage(value: string): string {
  const text = normalize(value);
  if (/\b(?:em gai|em trai|em minh|em tui|em toi)\b/u.test(text)) return "sibling-1";
  if (/\b(?:ban minh|ban tui|ban toi|ban cua minh|ban cua tui)\b/u.test(text)) return "friend-1";
  if (/\b(?:review|nguoi viet review)\b/u.test(text)) return "external-reviewer-1";
  return "self";
}

function asksForHistory(value: string): boolean {
  return /\b(?:truoc day|lan truoc|lich cu|thong tin cu|hom qua|lich su|da tung)\b/u.test(normalize(value));
}

function asksForMemoryRecap(value: string): boolean {
  return /\b(?:ban nho|nho gi|recap|tom tat|tong ket|nhac lai|chot lai)\b/u.test(normalize(value));
}

function normalize(value: string): string {
  return value
    .toLocaleLowerCase("vi-VN")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/đ/gu, "d")
    .replace(/[^a-z0-9\s]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function evidenceRef(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex").slice(0, 16)}`;
}

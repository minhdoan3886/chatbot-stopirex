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
  /** Resolved by the conversation layer for pronouns such as “em ấy”. */
  activeSubjectId?: string;
  at?: Date;
}): MemoryProjection {
  const at = input.at ?? new Date();
  const explicitSubjectId = subjectForMessage(input.customerMessage);
  const activeSubjectId = explicitSubjectId ?? input.activeSubjectId ?? "self";
  const includeHistory = asksForHistory(input.customerMessage);
  const recapScope = memoryRecapScope(input.customerMessage);
  const relevantPredicates = predicatesRelevantToMessage(input.customerMessage);
  const greeting = isStandaloneGreeting(input.customerMessage);
  const facts: TurnMemoryFact[] = [];
  const excluded: Array<{ factId: string; reason: string }> = [];

  for (const fact of input.ledger?.facts ?? []) {
    const reason = excludedReason(fact, { includeHistory, at });
    if (reason) {
      excluded.push({ factId: fact.id, reason });
      continue;
    }
    const sameSubject = fact.subjectId === activeSubjectId;
    const staleRelative = isStaleRelativeFact(fact, at);
    const predicateRelevant = relevantPredicates.has(fact.predicate);
    const mustSay = recapScope === "condition" && sameSubject && predicateRelevant && !staleRelative;
    const maySay =
      !greeting && sameSubject && !staleRelative && (predicateRelevant || recapScope === "profile");
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
      ...(fact.product ? { product: fact.product } : {}),
      polarity: fact.polarity,
      status: fact.status,
      ...(fact.supersededBy ? { supersededBy: fact.supersededBy } : {}),
      temporal: staleRelative ? "past" : fact.temporal,
      scenario: fact.scenario,
      source: fact.source,
      usage: mustSay ? "must_say" : maySay ? "may_say" : "context_only",
      relevanceReason: staleRelative
        ? "relative_time_historical"
        : greeting
          ? "standalone_greeting_no_personal_recap"
          : mustSay
            ? "customer_requested_condition_recap"
            : maySay
              ? recapScope === "profile"
                ? "customer_requested_profile_recap"
                : "current_question_relevant_fact"
              : sameSubject
                ? "active_subject_not_relevant_to_current_question"
                : "related_subject_context_only",
    });
  }

  return { activeSubjectId, includeHistory, facts: facts.slice(-32), excluded };
}

function excludedReason(
  fact: ConversationFact,
  input: { includeHistory: boolean; at: Date },
): string | undefined {
  if (fact.status === "superseded" && !input.includeHistory) return "superseded_not_requested";
  if (fact.scenario === "hypothetical") return "hypothetical_not_customer_fact";
  if (fact.source === "copied_review" && fact.subjectId === "self") return "copied_review_not_self_fact";
  if ((fact.temporal === "today" || fact.temporal === "yesterday") && !fact.eventAt) {
    return "legacy_relative_time_unknown";
  }
  if (fact.eventAt && Number.isNaN(Date.parse(fact.eventAt))) return "invalid_event_time";
  if (fact.recordedAt && Date.parse(fact.recordedAt) > input.at.getTime()) return "recorded_in_future";
  return undefined;
}

function subjectForMessage(value: string): string | undefined {
  const text = normalize(value);
  if (/\b(?:em gai|em trai|em minh|em tui|em toi)\b/u.test(text)) return "sibling-1";
  if (/\b(?:ban minh|ban tui|ban toi|ban cua minh|ban cua tui)\b/u.test(text)) return "friend-1";
  if (/\b(?:review|nguoi viet review)\b/u.test(text)) return "external-reviewer-1";
  if (/\b(?:minh|tui|toi|em|anh|chi)\b/u.test(text) && !/\bem ay\b/u.test(text)) return "self";
  return undefined;
}

function asksForHistory(value: string): boolean {
  return /\b(?:truoc day|lan truoc|lich cu|thong tin cu|hom qua|lich su|da tung)\b/u.test(normalize(value));
}

function memoryRecapScope(value: string): "none" | "condition" | "profile" | "commerce" {
  const text = normalize(value);
  if (!/\b(?:ban nho|nho gi|recap|tom tat|tong ket|nhac lai|chot lai)\b/u.test(text)) return "none";
  if (/\b(?:tinh trang|da|mo hoi|mui|cao|wax|gym|lich|phan ung|kich ung)\b/u.test(text)) {
    return "condition";
  }
  if (/\b(?:gia|phi|ship|combo|don|tong tien|so luong)\b/u.test(text)) return "commerce";
  return /\b(?:ban nho|nho gi|ve (?:minh|toi|tui)|ho so)\b/u.test(text) ? "profile" : "none";
}

function predicatesRelevantToMessage(value: string): Set<ConversationFact["predicate"]> {
  const text = normalize(value);
  const predicates = new Set<ConversationFact["predicate"]>();
  if (/\b(?:mo hoi|uot|dam ao|o ao)\b/u.test(text)) predicates.add("sweat_concern");
  if (/\b(?:mui|hoi nach)\b/u.test(text)) predicates.add("odor_severity");
  if (/\b(?:da|nhay cam|kich ung)\b/u.test(text)) {
    predicates.add("skin_type");
    predicates.add("skin_sensitivity_context");
  }
  if (/\b(?:gym|tap|lich)\b/u.test(text)) predicates.add("exercise_schedule");
  if (/\b(?:cao|wax|triet|nho long)\b/u.test(text)) {
    predicates.add("hair_removal_time");
    predicates.add("hair_removal_reaction");
  }
  if (/\b(?:rat|ngua|do|phan ung|kich ung)\b/u.test(text)) predicates.add("product_reaction");
  // A usage/suitability question depends on the active person's skin and
  // recent hair-removal/reaction context even when the customer does not
  // repeat those nouns (for example: “em ấy dùng sao?”). These remain
  // may_say facts; the response contract still decides what must be said.
  if (/\b(?:dung sao|dung the nao|dung duoc|co dung|cach dung)\b/u.test(text)) {
    predicates.add("skin_type");
    predicates.add("skin_sensitivity_context");
    predicates.add("hair_removal_time");
    predicates.add("hair_removal_reaction");
    predicates.add("product_reaction");
  }
  if (memoryRecapScope(value) === "condition" && predicates.size === 0) {
    for (const predicate of [
      "sweat_concern",
      "odor_severity",
      "skin_type",
      "skin_sensitivity_context",
      "exercise_schedule",
      "hair_removal_time",
      "hair_removal_reaction",
      "product_reaction",
    ] as const) {
      predicates.add(predicate);
    }
  }
  return predicates;
}

function isStaleRelativeFact(fact: ConversationFact, at: Date): boolean {
  if ((fact.temporal !== "today" && fact.temporal !== "yesterday") || !fact.eventAt) return false;
  const eventDay = dateKeyInVietnam(new Date(fact.eventAt));
  const expected = new Date(at);
  if (fact.temporal === "yesterday") expected.setUTCDate(expected.getUTCDate() - 1);
  return eventDay !== dateKeyInVietnam(expected);
}

function dateKeyInVietnam(value: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
}

function isStandaloneGreeting(value: string): boolean {
  return /^(?:hi|hello|alo|chao|xin chao|chao shop|shop oi|hi e|hi em|hello shop)(?:\s+(?:a|nha|nhe))*$/u.test(
    normalize(value),
  );
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

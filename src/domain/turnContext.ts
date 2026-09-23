import type { CanonicalAnswerFact, CanonicalFactConflict } from "./knowledgeResolver.js";

export const TURN_CONTEXT_SCHEMA_VERSION = 1 as const;

export type TurnFactUsage = "context_only" | "may_say" | "must_say" | "disallowed";

export type TurnScope = {
  tenantId: string;
  pageId: string;
  customerId: string;
  conversationId: string;
  episodeId: string;
};

export type TurnMemoryFact = {
  id: string;
  subjectId: string;
  key: string;
  value: string | number | boolean;
  sourceRef: string;
  evidenceRef: string;
  sourceTurn: number;
  recordedAt?: string;
  eventAt?: string;
  product?: "stopirex" | "other_rollon" | "unknown";
  polarity?: "positive" | "negative";
  status?: "current" | "superseded";
  supersededBy?: string;
  temporal: string;
  scenario: string;
  source: string;
  usage: TurnFactUsage;
  relevanceReason: string;
};

export type TurnKnowledgeFact = CanonicalAnswerFact & {
  usage: Exclude<TurnFactUsage, "context_only">;
};

export type TurnMoneyRole = "unit_price" | "subtotal" | "shipping" | "discount" | "total";

export type TurnMoneyValue = {
  role: TurnMoneyRole;
  amount: number;
  currency: "VND";
  quantity?: number;
  sourceRef: string;
  sourceVersion: string;
};

export type TurnActionReceipt = {
  id: string;
  /** Operation identity for the turn that produced this result. */
  operationId?: string;
  type: string;
  status: "succeeded" | "failed" | "unknown";
  /** Lifecycle evidence: accepted plans are not proof that an action completed. */
  stage?: "accepted" | "committed" | "queued" | "completed";
  /** Exact state field proved by this receipt, when applicable. */
  field?: string;
  /** Hash/reference only; never place raw customer PII here. */
  valueRef?: string;
  /** Opaque resource identity and its own version namespace. */
  resourceRef?: string;
  resultVersion?: string;
  performedAt?: string;
  sourceVersion?: string;
  scope: TurnScope;
};

export type TurnContextSnapshot = {
  schemaVersion: typeof TURN_CONTEXT_SCHEMA_VERSION;
  turnId: string;
  scope: TurnScope;
  inboundRevision: number;
  stateVersion: number;
  createdAt: string;
  currentMessage: string;
  activeSubjectId: string;
  questions: string[];
  memoryFacts: TurnMemoryFact[];
  knowledgeFacts: TurnKnowledgeFact[];
  knowledgeConflicts: CanonicalFactConflict[];
  money: TurnMoneyValue[];
  receipts: TurnActionReceipt[];
  missingInformation: string[];
  allowedActions: string[];
};

export function createTurnContextSnapshot(
  input: Omit<TurnContextSnapshot, "schemaVersion">,
): Readonly<TurnContextSnapshot> {
  assertNonEmpty(input.turnId, "turnId");
  for (const [key, value] of Object.entries(input.scope)) assertNonEmpty(value, `scope.${key}`);
  if (!Number.isSafeInteger(input.inboundRevision) || input.inboundRevision < 0) {
    throw new Error("turn_context_invalid_inbound_revision");
  }
  if (!Number.isSafeInteger(input.stateVersion) || input.stateVersion < 0) {
    throw new Error("turn_context_invalid_state_version");
  }
  if (Number.isNaN(Date.parse(input.createdAt))) throw new Error("turn_context_invalid_created_at");
  for (const fact of input.memoryFacts) {
    assertNonEmpty(fact.id, "memoryFact.id");
    assertNonEmpty(fact.subjectId, "memoryFact.subjectId");
    assertNonEmpty(fact.sourceRef, "memoryFact.sourceRef");
    assertNonEmpty(fact.evidenceRef, "memoryFact.evidenceRef");
  }
  for (const value of input.money) {
    if (!Number.isSafeInteger(value.amount) || value.amount < 0) {
      throw new Error(`turn_context_invalid_money:${value.role}`);
    }
    assertNonEmpty(value.sourceRef, `money.${value.role}.sourceRef`);
    assertNonEmpty(value.sourceVersion, `money.${value.role}.sourceVersion`);
  }
  for (const receipt of input.receipts) {
    if (!sameScope(receipt.scope, input.scope))
      throw new Error(`turn_context_receipt_scope_mismatch:${receipt.id}`);
  }
  const snapshot: TurnContextSnapshot = {
    schemaVersion: TURN_CONTEXT_SCHEMA_VERSION,
    ...structuredClone(input),
  };
  return deepFreeze(snapshot);
}

export function factsAllowedToSay(snapshot: TurnContextSnapshot): Array<TurnMemoryFact | TurnKnowledgeFact> {
  return [...snapshot.memoryFacts, ...snapshot.knowledgeFacts].filter(
    (fact) => fact.usage === "may_say" || fact.usage === "must_say",
  );
}

export function factsRequiredToSay(snapshot: TurnContextSnapshot): Array<TurnMemoryFact | TurnKnowledgeFact> {
  return [...snapshot.memoryFacts, ...snapshot.knowledgeFacts].filter((fact) => fact.usage === "must_say");
}

function sameScope(left: TurnScope, right: TurnScope): boolean {
  return Object.keys(right).every((key) => left[key as keyof TurnScope] === right[key as keyof TurnScope]);
}

function assertNonEmpty(value: string, name: string): void {
  if (!value.trim()) throw new Error(`turn_context_missing_${name}`);
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const item of Object.values(value as Record<string, unknown>)) deepFreeze(item);
  return Object.freeze(value);
}

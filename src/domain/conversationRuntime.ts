import type { ConversationId, Scope } from "./types.js";
import { scopedKey } from "./types.js";

export type OrderedEvent = { id: string; occurredAt: Date; sequence?: number; payload: unknown };

export function adaptiveDebounceMs(messageCount: number, gapMs: number): number {
  if (messageCount <= 1) return 2_500;
  return Math.min(5_000, Math.max(2_500, 2_500 + messageCount * 350 - Math.min(gapMs, 1_000)));
}

export function orderEvents(events: readonly OrderedEvent[]): OrderedEvent[] {
  return [...events].sort((left, right) => {
    if (left.sequence !== undefined && right.sequence !== undefined && left.sequence !== right.sequence) {
      return left.sequence - right.sequence;
    }
    const time = left.occurredAt.getTime() - right.occurredAt.getTime();
    return time || left.id.localeCompare(right.id);
  });
}

export class LeaseLock {
  private readonly leases = new Map<string, { owner: string; expiresAt: number }>();

  acquire(scope: Scope, conversationId: ConversationId, owner: string, now: Date, ttlMs: number): boolean {
    const key = scopedKey(scope, conversationId);
    const existing = this.leases.get(key);
    if (existing && existing.expiresAt > now.getTime() && existing.owner !== owner) return false;
    this.leases.set(key, { owner, expiresAt: now.getTime() + ttlMs });
    return true;
  }

  release(scope: Scope, conversationId: ConversationId, owner: string): void {
    const key = scopedKey(scope, conversationId);
    if (this.leases.get(key)?.owner === owner) this.leases.delete(key);
  }
}

export type VersionedState<T> = { version: number; value: T };
export class OptimisticStateStore<T> {
  private readonly values = new Map<string, VersionedState<T>>();

  load(key: string): VersionedState<T> | undefined {
    const state = this.values.get(key);
    return state ? structuredClone(state) : undefined;
  }

  commit(key: string, expectedVersion: number, value: T): VersionedState<T> {
    const current = this.values.get(key);
    const actual = current?.version ?? 0;
    if (actual !== expectedVersion) throw new Error("optimistic_concurrency_conflict");
    const next = { version: actual + 1, value: structuredClone(value) };
    this.values.set(key, next);
    return structuredClone(next);
  }
}

export type CustomerFact = {
  key: string;
  value: unknown;
  type: "verified" | "observed" | "derived" | "authoritative";
  sourceId: string;
  confidence?: number;
  expiresAt?: Date;
};

export function activeFacts(facts: readonly CustomerFact[], at = new Date()): CustomerFact[] {
  return facts.filter((fact) => !fact.expiresAt || fact.expiresAt > at).map((fact) => ({ ...fact }));
}

export function rollingSummary(lines: readonly string[], maxChars = 800): string {
  const clean = lines.map((line) => line.trim()).filter(Boolean);
  let output = "";
  for (const line of clean.slice().reverse()) {
    const candidate = output ? `${line} | ${output}` : line;
    if ([...candidate].length > maxChars) break;
    output = candidate;
  }
  return output;
}

export function fallbackAction(input: {
  timedOut?: boolean;
  lowConfidence?: boolean;
  missingToolResult?: boolean;
}): {
  handoff: boolean;
  reason?: string;
} {
  if (input.timedOut) return { handoff: true, reason: "ai_timeout" };
  if (input.missingToolResult) return { handoff: true, reason: "tool_no_result" };
  if (input.lowConfidence) return { handoff: true, reason: "low_confidence" };
  return { handoff: false };
}

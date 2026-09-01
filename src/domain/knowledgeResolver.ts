import { createHash } from "node:crypto";
import type { CustomerIntent } from "./consultation.js";
import type { KnowledgeEntity, KnowledgeMatch } from "./knowledge.js";

export type CanonicalFactKind =
  | "price"
  | "shipping"
  | "gift"
  | "duration"
  | "safety"
  | "claim";

export type CanonicalAnswerFact = {
  id: string;
  key: string;
  kind: CanonicalFactKind;
  value: string | number | boolean;
  text: string;
  sourceId: string;
  sourceVersion: string;
  effectiveFrom?: string;
  effectiveTo?: string;
  priority: number;
  applicable: true;
  applicabilityReason: string;
  confidence: number;
};

export type CanonicalFactConflict = {
  key: string;
  factIds: string[];
  sourceIds: string[];
  values: Array<string | number | boolean>;
  resolution: "highest_priority_then_newest";
  selectedFactId: string;
};

export type CanonicalKnowledgeResolution = {
  facts: CanonicalAnswerFact[];
  unresolvedFacts: string[];
  conflicts: CanonicalFactConflict[];
  sourceIds: string[];
};

export class FactApplicabilityError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "FactApplicabilityError";
  }
}

/** Ensures commerce numbers are either canonical or an explicit workflow-derived value. */
export function assertCanonicalFactApplicability(input: {
  reply: string;
  authoritativeReply: string;
  resolution: CanonicalKnowledgeResolution;
}): void {
  const replyAmounts = vndAmounts(input.reply);
  if (replyAmounts.length === 0) return;
  if (input.resolution.unresolvedFacts.includes("price")) {
    throw new FactApplicabilityError("fact_applicability_guard:price_unresolved");
  }
  const allowed = new Set<number>([
    ...input.resolution.facts
      .filter((fact) => fact.kind === "price" && typeof fact.value === "number")
      .map((fact) => fact.value as number),
    ...vndAmounts(input.authoritativeReply),
  ]);
  const unsupported = replyAmounts.filter((amount) => !allowed.has(amount));
  if (unsupported.length > 0) {
    throw new FactApplicabilityError(
      `fact_applicability_guard:unsupported_money:${unsupported.join(",")}`,
    );
  }
}

/**
 * Turns retrieved articles into versioned, applicable propositions. Retrieval
 * decides which approved records are candidates; this resolver decides which
 * facts from those records are current and authoritative. Customer-facing
 * writers must consume the resolved facts, never infer authority from ranking
 * score alone.
 */
export function resolveCanonicalKnowledge(input: {
  query: string;
  matches: readonly KnowledgeMatch[];
  intent?: CustomerIntent;
  at?: Date;
}): CanonicalKnowledgeResolution {
  const at = input.at ?? new Date();
  const applicableEntities = input.matches
    .map((match) => match.entity)
    .filter((entity) => isApplicable(entity, input.intent, at));
  const extracted = applicableEntities.flatMap((entity) => extractEntityFacts(entity));
  const grouped = new Map<string, CanonicalAnswerFact[]>();
  for (const fact of extracted) {
    const items = grouped.get(fact.key) ?? [];
    items.push(fact);
    grouped.set(fact.key, items);
  }

  const facts: CanonicalAnswerFact[] = [];
  const conflicts: CanonicalFactConflict[] = [];
  for (const [key, candidates] of grouped) {
    const ordered = [...candidates].sort(compareAuthority);
    const selected = ordered[0]!;
    facts.push(selected);
    const values = [...new Set(ordered.map((fact) => fact.value))];
    if (values.length > 1) {
      conflicts.push({
        key,
        factIds: ordered.map((fact) => fact.id),
        sourceIds: [...new Set(ordered.map((fact) => fact.sourceId))],
        values,
        resolution: "highest_priority_then_newest",
        selectedFactId: selected.id,
      });
    }
  }

  const unresolvedFacts = unresolvedFactKeys(input.query, facts);
  return {
    facts: facts.sort((left, right) => left.key.localeCompare(right.key)),
    unresolvedFacts,
    conflicts,
    sourceIds: [...new Set(applicableEntities.map((entity) => entity.id))],
  };
}

function extractEntityFacts(entity: KnowledgeEntity): CanonicalAnswerFact[] {
  const facts: CanonicalAnswerFact[] = [];
  const sourceVersion = createHash("sha256")
    .update(`${entity.id}|${entity.validFrom ?? ""}|${entity.validTo ?? ""}|${entity.content}`)
    .digest("hex")
    .slice(0, 16);
  const segments = entity.content
    .split(/(?<=[.!?;])\s+|\n+/u)
    .map((segment) => segment.trim())
    .filter(Boolean);
  const add = (
    key: string,
    kind: CanonicalFactKind,
    value: string | number | boolean,
    text: string,
    confidence = 1,
  ) => {
    const id = `${entity.id}:${key}:${facts.length + 1}`;
    facts.push({
      id,
      key,
      kind,
      value,
      text,
      sourceId: entity.id,
      sourceVersion,
      ...(entity.validFrom ? { effectiveFrom: entity.validFrom } : {}),
      ...(entity.validTo ? { effectiveTo: entity.validTo } : {}),
      priority: entity.priority ?? 0,
      applicable: true,
      applicabilityReason: "record_active_for_current_time_and_intent",
      confidence,
    });
  };

  for (const [index, segment] of segments.entries()) {
    const normalized = normalize(segment);
    const moneyMatches = [...segment.matchAll(/(\d{1,3}(?:\.\d{3})+)\s*đ/gu)];
    for (const match of moneyMatches) {
      const amount = Number(match[1]?.replace(/\./gu, ""));
      if (!Number.isFinite(amount)) continue;
      const matchIndex = match.index ?? 0;
      const localContext = normalize(
        segment.slice(Math.max(0, matchIndex - 64), matchIndex + match[0].length),
      );
      add(priceKey(localContext, amount, index), "price", amount, segment);
    }
    if (/mien phi (?:giao|ship)|freeship|free ship/u.test(normalized)) {
      const quantityRange = normalized.match(/combo\s+(\d+)\s*[–-]\s*(\d+)\s+lo/u);
      const key = quantityRange
        ? `shipping.stopirex.${quantityRange[1]}_${quantityRange[2]}_units`
        : /body wash|sua tam/u.test(normalized)
          ? "shipping.stopirex.bodywash_bundle"
          : `shipping:${entity.id}:${index}`;
      add(key, "shipping", true, segment);
    }
    if (/qua tang|duoc tang|tang dung 1 tui/u.test(normalized)) {
      add("gift.stopirex.order", "gift", segment, segment);
    }
    for (const duration of segment.matchAll(/\d+\s*[–-]\s*\d+\s*(?:ngay|lan\/tuan|thang|gio)/gu)) {
      add(`duration:${entity.id}:${index}:${duration.index ?? 0}`, "duration", duration[0], segment);
    }
    if (/ngung dung|di cap cuu|khong (?:lan|boi) lai/u.test(normalized)) {
      add(`safety:${entity.id}:${index}`, "safety", segment, segment);
    }
    if (moneyMatches.length === 0 && segment.length >= 24) {
      add(`claim:${entity.id}:${index}`, "claim", segment, segment, 0.9);
    }
  }
  return facts;
}

function priceKey(normalizedSegment: string, amount: number, index: number): string {
  if (/body wash|sua tam/u.test(normalizedSegment)) return "price.stopirex.bodywash_bundle";
  if (/phi (?:giao|ship)/u.test(normalizedSegment)) return "shipping.stopirex.standard_fee";
  const combo = normalizedSegment.match(/combo\s+(\d+)\s+lo/u);
  if (combo?.[1]) return `price.stopirex.${combo[1]}_units`;
  if (/(?:^|\s)1\s+lo(?:\s|$)/u.test(normalizedSegment)) return "price.stopirex.1_unit";
  return `price:unclassified:${amount}:${index}`;
}

function unresolvedFactKeys(query: string, facts: readonly CanonicalAnswerFact[]): string[] {
  const normalized = normalize(query);
  const available = new Set(facts.map((fact) => fact.kind));
  const unresolved: string[] = [];
  if (/\bgia\b|bao nhieu|combo/u.test(normalized) && !available.has("price")) unresolved.push("price");
  if (/ship|giao hang|van chuyen/u.test(normalized) && !available.has("shipping")) {
    unresolved.push("shipping");
  }
  if (/qua|khuyen mai|uu dai/u.test(normalized) && !available.has("gift")) unresolved.push("gift");
  return unresolved;
}

function compareAuthority(left: CanonicalAnswerFact, right: CanonicalAnswerFact): number {
  if (left.priority !== right.priority) return right.priority - left.priority;
  const leftFrom = left.effectiveFrom ? Date.parse(left.effectiveFrom) : Number.NEGATIVE_INFINITY;
  const rightFrom = right.effectiveFrom ? Date.parse(right.effectiveFrom) : Number.NEGATIVE_INFINITY;
  if (leftFrom !== rightFrom) return rightFrom - leftFrom;
  return left.sourceId.localeCompare(right.sourceId);
}

function isApplicable(entity: KnowledgeEntity, intent: CustomerIntent | undefined, at: Date): boolean {
  if (entity.status === "inactive") return false;
  const atMs = at.getTime();
  const from = entity.validFrom ? Date.parse(entity.validFrom) : Number.NEGATIVE_INFINITY;
  const to = entity.validTo ? Date.parse(entity.validTo) : Number.POSITIVE_INFINITY;
  if (Number.isNaN(from) || Number.isNaN(to) || atMs < from || atMs > to) return false;
  if (intent && entity.allowedIntents && !entity.allowedIntents.includes(intent)) return false;
  if (intent && entity.excludedIntents?.includes(intent)) return false;
  return true;
}

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/đ/giu, "d")
    .toLocaleLowerCase("vi-VN")
    .replace(/\s+/gu, " ")
    .trim();
}

function vndAmounts(value: string): number[] {
  return [...value.matchAll(/(\d{1,3}(?:\.\d{3})+)\s*đ/gu)]
    .map((match) => Number(match[1]?.replace(/\./gu, "")))
    .filter(Number.isFinite);
}

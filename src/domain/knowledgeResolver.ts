import { createHash } from "node:crypto";
import type { CustomerIntent } from "./consultation.js";
import type { KnowledgeEntity, KnowledgeMatch } from "./knowledge.js";

export type CanonicalFactKind = "price" | "shipping" | "gift" | "duration" | "safety" | "claim";

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

export class UnsupportedCanonicalClaimError extends Error {
  constructor(readonly claim: string) {
    super(`unsupported_claim_guard:${claim.slice(0, 120)}`);
    this.name = "UnsupportedCanonicalClaimError";
  }
}

export type MoneyRole = "unit_price" | "subtotal" | "shipping" | "discount" | "total" | "unknown";

export type ParsedMoneySpan = {
  amount: number;
  currency: "VND";
  role: MoneyRole;
  quantity?: number;
  start: number;
  end: number;
  text: string;
};

/**
 * Closed-world guard for product claims. It does not try to rewrite copy; it
 * only rejects a factual product sentence that has no material support in any
 * canonical fact applicable to this turn (or in an executed workflow receipt).
 */
export function assertCanonicalClaimsSupported(input: {
  reply: string;
  authoritativeReply: string;
  resolution: CanonicalKnowledgeResolution;
}): void {
  // Workflow prose and earlier assistant copy are not product evidence. They
  // may describe an executed transaction, but only applicable canonical facts
  // can authorize a product/policy claim.
  const support = input.resolution.facts.map((fact) => fact.text).filter(Boolean);
  assertMaterialClaimsSupportedByApprovedText(input.reply, support);
}

/**
 * Applies the same closed-world product-claim gate when the approved evidence
 * is prose rather than a full knowledge resolution (for example follow-ups).
 * The caller must only pass text that has already crossed an authoritative
 * boundary; prior model output is not evidence.
 */
export function assertMaterialClaimsSupportedByApprovedText(
  reply: string,
  approvedTexts: readonly string[],
): void {
  const support = approvedTexts.filter(Boolean);
  for (const sentence of materialClaimBlocks(reply)) {
    if (!isProductClaimSentence(sentence)) continue;
    const claimTokens = materialClaimTokens(sentence);
    const claimDimensions = managedClaimDimensions(sentence);
    const supported =
      claimDimensions.length > 0
        ? claimDimensions.every((dimension) =>
            support.some(
              (source) =>
                managedClaimDimensions(source).includes(dimension) &&
                sameClaimPolarity(sentence, source) &&
                sameManagedClaimDimensions(sentence, source),
            ),
          )
        : claimTokens.length < 2
          ? true
          : support.some((source) => {
              const sourceTokens = new Set(materialClaimTokens(source));
              const overlap = claimTokens.filter((token) => sourceTokens.has(token)).length;
              return (
                overlap >= Math.max(2, Math.ceil(claimTokens.length * 0.7)) &&
                sameClaimPolarity(sentence, source) &&
                sameManagedClaimDimensions(sentence, source)
              );
            });
    if (!supported) throw new UnsupportedCanonicalClaimError(sentence);
  }
}

/** Ensures commerce numbers are either canonical or an explicit workflow-derived value. */
export function assertCanonicalFactApplicability(input: {
  reply: string;
  authoritativeReply: string;
  resolution: CanonicalKnowledgeResolution;
  allowedMoney?: readonly {
    role: "unit_price" | "subtotal" | "shipping" | "discount" | "total";
    amount: number;
    currency: "VND";
    quantity?: number;
  }[];
}): void {
  const spans = parseMoneySpans(input.reply);
  const replyAmounts = spans.map((span) => span.amount);
  assertMoneyRolesMatch(spans, input.resolution, input.allowedMoney ?? []);
  if (input.resolution.unresolvedFacts.includes("price") && spans.length > 0) {
    throw new FactApplicabilityError("fact_applicability_guard:price_unresolved");
  }
  if (
    input.resolution.unresolvedFacts.includes("shipping") &&
    /miễn phí (?:giao|ship)|freeship|free ship|phí (?:giao|ship)/iu.test(input.reply)
  ) {
    throw new FactApplicabilityError("fact_applicability_guard:shipping_unresolved");
  }
  if (input.resolution.unresolvedFacts.includes("gift") && /quà|tặng|khuyến mãi|ưu đãi/iu.test(input.reply)) {
    throw new FactApplicabilityError("fact_applicability_guard:gift_unresolved");
  }
  for (const conflict of input.resolution.conflicts) {
    const numericValues = conflict.values.filter((value): value is number => typeof value === "number");
    if (numericValues.some((value) => replyAmounts.includes(value))) {
      throw new FactApplicabilityError(`fact_applicability_guard:conflicting_fact:${conflict.key}`);
    }
  }
  if (replyAmounts.length === 0) return;
  const allowed = new Set<number>([
    ...input.resolution.facts
      .filter((fact) => fact.kind === "price" && typeof fact.value === "number")
      .map((fact) => fact.value as number),
    ...(input.allowedMoney ?? []).map((money) => money.amount),
  ]);
  const unsupported = replyAmounts.filter((amount) => !allowed.has(amount));
  if (unsupported.length > 0) {
    throw new FactApplicabilityError(`fact_applicability_guard:unsupported_money:${unsupported.join(",")}`);
  }
}

function assertMoneyRolesMatch(
  spans: readonly ParsedMoneySpan[],
  resolution: CanonicalKnowledgeResolution,
  allowedMoney: readonly {
    role: "unit_price" | "subtotal" | "shipping" | "discount" | "total";
    amount: number;
    currency: "VND";
    quantity?: number;
  }[],
): void {
  const allowed = new Set<string>();
  const add = (role: MoneyRole, amount: number, quantity?: number) =>
    allowed.add(`${role}:${amount}:${quantity ?? "*"}`);
  for (const fact of resolution.facts) {
    if (typeof fact.value !== "number") continue;
    const quantity = quantityFromPriceKey(fact.key);
    const role: MoneyRole = fact.key.startsWith("shipping.")
      ? "shipping"
      : (quantity ?? 0) > 1 || /bodywash_bundle/u.test(fact.key)
        ? "total"
        : "unit_price";
    add(role, fact.value, quantity);
  }
  for (const money of allowedMoney) add(money.role, money.amount, money.quantity);
  for (const span of spans) {
    if (span.role === "unknown") {
      const approvedAmount = [...allowed].some((item) => item.split(":")[1] === String(span.amount));
      // Some approved catalog lines (for example a named product bundle)
      // render the amount after the product name without a nearby role label.
      // Permit only the exact approved amount; explicit labels and quantities
      // are parsed above and therefore cannot use this compatibility path.
      if (approvedAmount) continue;
      throw new FactApplicabilityError(`fact_applicability_guard:money_role_unknown:${span.amount}`);
    }
    const exact = `${span.role}:${span.amount}:${span.quantity ?? "*"}`;
    const anyQuantity = `${span.role}:${span.amount}:*`;
    const sameAmountAndRole = [...allowed].some((item) => item.startsWith(`${span.role}:${span.amount}:`));
    const matches = span.quantity
      ? allowed.has(exact) || allowed.has(anyQuantity)
      : allowed.has(anyQuantity) || sameAmountAndRole;
    if (!matches) {
      throw new FactApplicabilityError(
        `fact_applicability_guard:money_role_mismatch:${span.role}:${span.amount}`,
      );
    }
  }
}

function sameClaimPolarity(claim: string, source: string): boolean {
  return claimPolarity(claim) === claimPolarity(source);
}

function sameManagedClaimDimensions(claim: string, source: string): boolean {
  const claimText = normalize(claim);
  const sourceText = normalize(source);
  const usageClaim = /\b(?:dung|lan|boi)\b/u.test(claimText);
  if (usageClaim) {
    const claimTime = usageTime(claimText);
    const sourceTime = usageTime(sourceText);
    if (claimTime && sourceTime && claimTime !== sourceTime) return false;
  }
  return true;
}

function usageTime(value: string): "morning" | "evening" | undefined {
  if (/\b(?:buoi sang|sang som|vao sang)\b/u.test(value)) return "morning";
  if (/\b(?:buoi toi|ban dem|truoc khi ngu|vao toi)\b/u.test(value)) return "evening";
  return undefined;
}

function claimPolarity(value: string): "positive" | "negative" {
  const normalized = normalize(value);
  return /\b(?:khong|chua|chang|khong the|khong phai)\b/u.test(normalized) ? "negative" : "positive";
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
  if (entity.status !== "active") return false;
  if (entity.scope !== "current" && entity.scope !== "historical") return false;
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

export function parseMoneySpans(value: string): ParsedMoneySpan[] {
  const spans: ParsedMoneySpan[] = [];
  const money = /(?<!\d)(\d{1,3}(?:[.,]\d{3})+|\d{4,9}|\d{1,3})\s*(k|nghìn|ngàn|đ|₫|vnd)(?![\p{L}\d])/giu;
  for (const match of value.matchAll(money)) {
    const rawNumber = match[1] ?? "";
    const unit = normalize(match[2] ?? "");
    let amount = Number(rawNumber.replace(/[.,]/gu, ""));
    if (!Number.isFinite(amount)) continue;
    if (unit === "k" || unit === "nghin" || unit === "ngan") amount *= 1_000;
    const start = match.index ?? 0;
    const end = start + match[0].length;
    const before = value.slice(Math.max(0, start - 48), start);
    const after = value.slice(end, Math.min(value.length, end + 32));
    // Quantity belongs to the closest product phrase before the amount. Using
    // the whole surrounding window can accidentally attach the previous or
    // next combo quantity to this price when a catalog is written inline.
    const quantity = inferMoneyQuantity(before);
    spans.push({
      amount,
      currency: "VND",
      role: inferMoneyRole(before, after),
      ...(quantity ? { quantity } : {}),
      start,
      end,
      text: match[0],
    });
  }
  return spans;
}

function inferMoneyRole(beforeValue: string, afterValue: string): MoneyRole {
  const before = normalize(beforeValue);
  const after = normalize(afterValue.split(/\r?\n/u, 1)[0] ?? "");
  const immediateBefore = before.slice(-28);
  const immediateAfter = after.slice(0, 24);
  const separator = String.raw`[\s:：=-]*`;
  if (
    new RegExp(String.raw`\b(?:phi giao|phi ship|ship)${separator}$`, "u").test(immediateBefore) ||
    /^\s*(?:phi giao|phi ship)/u.test(immediateAfter)
  ) {
    return "shipping";
  }
  if (new RegExp(String.raw`\b(?:giam|tiet kiem|chiet khau|hoan)${separator}$`, "u").test(immediateBefore)) {
    return "discount";
  }
  if (
    new RegExp(String.raw`\b(?:tong|thanh toan|tron goi)(?:\s+[^\d]{0,12})?${separator}$`, "u").test(
      immediateBefore,
    )
  ) {
    return "total";
  }
  if (
    new RegExp(String.raw`\b(?:tien hang|tam tinh)(?:\s+[^\d]{0,12})?${separator}$`, "u").test(
      immediateBefore,
    )
  ) {
    return "subtotal";
  }
  const quantity = inferMoneyQuantity(immediateBefore);
  if ((quantity ?? 0) > 1 || /\bcombo\s+[1-9]\d*\s+lo\b/u.test(immediateBefore)) return "total";
  if (
    new RegExp(String.raw`\b(?:gia|don gia)(?:\s+[^\d]{0,12})?${separator}$`, "u").test(immediateBefore) ||
    quantity === 1
  ) {
    return "unit_price";
  }
  return "unknown";
}

function inferMoneyQuantity(value: string): number | undefined {
  const text = normalize(value);
  const matches = [...text.matchAll(/\b(?:combo\s+)?([1-9]\d*)\s+(?:lo|chai|san pham)\b/gu)];
  const match = matches.at(-1);
  return match?.[1] ? Number(match[1]) : undefined;
}

function quantityFromPriceKey(key: string): number | undefined {
  const match = key.match(/\.([1-9]\d*)_units$/u);
  if (match?.[1]) return Number(match[1]);
  if (/\.1_unit$/u.test(key)) return 1;
  return undefined;
}

function materialClaimBlocks(reply: string): string[] {
  const blocks: string[] = [];
  let activeProductSubject = false;
  for (const sentence of reply
    .split(/(?<=[.!?;])\s+|\n+/u)
    .map((item) => item.trim())
    .filter(Boolean)) {
    const normalizedSentence = normalize(sentence);
    const productSubject = /\b(?:stopirex|san pham|lan nach|sua tam|body wash|cong thuc|hoat chat)\b/u.test(
      normalizedSentence,
    );
    const explicitNonProductSubject =
      /\b(?:khach|nguoi dung|minh|toi|tui|anh|chi|em gai|em trai|ban minh)\b/u.test(normalizedSentence);
    const parts = sentence.split(
      /(?:\s*[,;]\s*|\s+(?:và|nhưng|đồng thời|ngoài ra)\s+)(?=(?:(?:không\s+|có thể\s+)?(?:chữa|trị|uống|dùng|lăn|bôi|giúp|hỗ trợ|giảm|kiểm soát|ngăn|gây|làm|duy trì|bảo vệ)|(?:mẫu thử|phiếu kiểm nghiệm).{0,24}(?:ghi|cho thấy))\b)/iu,
    );
    for (const [index, part] of parts.entries()) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      const inheritedProductSubject =
        !productSubject &&
        activeProductSubject &&
        !explicitNonProductSubject &&
        /^(?:nó|loại này|sản phẩm này|cái này|lọ này)\b/iu.test(trimmed) &&
        hasMaterialClaimPredicate(trimmed);
      blocks.push((index > 0 && productSubject) || inheritedProductSubject ? `Stopirex ${trimmed}` : trimmed);
    }
    if (productSubject) activeProductSubject = true;
    else if (explicitNonProductSubject) activeProductSubject = false;
  }
  return blocks;
}

function managedClaimDimensions(value: string): string[] {
  const text = normalize(value);
  const dimensions = new Set<string>();
  if (/\b(?:mo hoi|tiet mo hoi)\b/u.test(text)) dimensions.add("effect:sweat");
  if (/\b(?:mui co the|mui hoi|khu mui|mui)\b/u.test(text)) dimensions.add("effect:odor");
  if (/\b(?:chua|tri)\b.{0,30}\b(?:tieu duong|ung thu|benh|viem)\b/u.test(text)) {
    dimensions.add("medical:cure");
  }
  if (
    /\b(?:co the|duoc|dung de)?\s*(?:uong|nuot)(?:\s+truc tiep|\s+san pham)?\b/u.test(text) &&
    !/\bkho nuot\b/u.test(text)
  ) {
    dimensions.add("route:oral");
  }
  if (/\b(?:lan|boi|thoa)\b/u.test(text)) dimensions.add("route:topical");
  if (/\b(?:buoi toi|ban dem|truoc khi ngu|vao toi)\b/u.test(text)) dimensions.add("time:evening");
  if (/\b(?:buoi sang|sang som|vao sang)\b/u.test(text)) dimensions.add("time:morning");
  if (/\b(?:nach|vung duoi canh tay)\b/u.test(text)) dimensions.add("area:underarm");
  for (const match of text.matchAll(/\b(\d+)\s*[–-]\s*(\d+)\s+lan\s*\/\s*tuan\b/gu)) {
    dimensions.add(`frequency:weekly:${match[1]}-${match[2]}`);
  }
  for (const match of text.matchAll(/\b(\d+)\s+lan\s*\/\s*tuan\b/gu)) {
    dimensions.add(`frequency:weekly:${match[1]}`);
  }
  if (/\b(?:vinh vien|mai mai|suot doi)\b/u.test(text)) dimensions.add("duration:permanent");
  if (/\b(?:chi sau|sau)\s+(?:mot|1)\s+lan(?:\s+dung)?\b/u.test(text)) {
    dimensions.add("onset:first_use");
  }
  if (/\b(?:thanh phan|alcohol|aluminium|glycerin|allantoin|bisabolol|parfum)\b/u.test(text)) {
    dimensions.add("composition:ingredient");
  }
  if (/\b(?:an toan|kich ung|rat|ngua|do da|tray xuoc)\b/u.test(text)) dimensions.add("safety:skin");
  return [...dimensions];
}

function isProductClaimSentence(value: string): boolean {
  if (/[?？]$/u.test(value)) return false;
  const normalized = normalize(value);
  if (/\b(?:chua co|khong co) (?:du kien|thong tin|bang chung)|\bchua ro\b/u.test(normalized)) {
    return false;
  }
  const hasProductSubject = /\b(?:stopirex|san pham|lan nach|sua tam|body wash|cong thuc|hoat chat)\b/u.test(
    normalized,
  );
  const highRiskImplicitClaim =
    managedClaimDimensions(normalized).some((dimension) =>
      /^(?:medical:cure|route:oral|duration:permanent|onset:first_use|frequency:weekly:)/u.test(dimension),
    ) && hasMaterialClaimPredicate(normalized);
  return (hasProductSubject && hasMaterialClaimPredicate(normalized)) || highRiskImplicitClaim;
}

function hasMaterialClaimPredicate(value: string): boolean {
  return /\b(?:co|khong|giup|ho tro|giam|kiem soat|ngan|chua|tri|lam|dung|lan|boi|thoa|uong|nuot|ghi|cho thay|tham|gay|duy tri|bao ve)\b/u.test(
    normalize(value),
  );
}

function materialClaimTokens(value: string): string[] {
  const stop = new Set([
    "stopirex",
    "san",
    "pham",
    "minh",
    "anh",
    "chi",
    "em",
    "da",
    "de",
    "va",
    "la",
    "nay",
    "do",
    "mot",
    "cac",
    "cho",
    "khi",
    "thi",
    "voi",
    "the",
    "a",
    "nhe",
    "giup",
    "ho",
    "tro",
  ]);
  return [
    ...new Set(
      normalize(value)
        .split(/[^a-z0-9]+/u)
        .filter((token) => token.length >= 2 && !stop.has(token)),
    ),
  ];
}

import { createHash } from "node:crypto";
import readXlsxFile from "read-excel-file/node";
import type { TenantId } from "./types.js";
import { ClaimRegistry } from "./claims.js";
import { detectPromptInjection } from "../services/policies.js";

export type KnowledgeType = "faq" | "script" | "product" | "price" | "policy" | "claim" | "asset";
export type KnowledgeEntity = {
  id: string;
  tenantId: TenantId;
  type: KnowledgeType;
  title: string;
  content: string;
  /** Phrases customers commonly use for this item. They improve retrieval but are not facts. */
  searchAliases?: readonly string[];
  /** Internal response constraints, kept separate from customer-facing facts. */
  responseGuidance?: string;
  sourceRow: number;
};

export type ImportResult = { checksum: string; entities: KnowledgeEntity[]; warnings: string[] };

export async function importKnowledgeXlsx(input: {
  tenantId: TenantId;
  filename: string;
  bytes: Buffer;
  maxBytes?: number;
}): Promise<ImportResult> {
  const maxBytes = input.maxBytes ?? 10 * 1024 * 1024;
  if (!input.filename.toLocaleLowerCase().endsWith(".xlsx")) throw new Error("Chỉ chấp nhận file .xlsx");
  if (input.bytes.length === 0 || input.bytes.length > maxBytes)
    throw new Error("Kích thước file không hợp lệ");
  if (input.bytes.subarray(0, 2).toString("hex") !== "504b") throw new Error("File không phải XLSX hợp lệ");

  const sheets = await readXlsxFile(input.bytes);
  const warnings: string[] = [];
  const entities: KnowledgeEntity[] = [];
  const seen = new Set<string>();
  for (const sheet of sheets) {
    const headerRow = findHeaderRow(sheet.data);
    if (!headerRow) {
      warnings.push(`${sheet.sheet}: không tìm thấy cột nội dung`);
      continue;
    }
    for (const contentIndex of headerRow.contentIndexes) {
      const titleIndex = findTitleIndex(headerRow.values, contentIndex);
      const typeIndex = headerRow.values.findIndex((value) =>
        ["type", "loại", "nhóm", "nhóm câu hỏi"].includes(value),
      );
      for (let index = headerRow.index + 1; index < sheet.data.length; index += 1) {
        const row = sheet.data[index] ?? [];
        const content = String(row[contentIndex] ?? "").trim();
        if (!content || isHeaderLabel(content)) continue;
        const title =
          String(row[titleIndex] ?? `${sheet.sheet} dòng ${index + 1}`).trim() ||
          `${sheet.sheet} dòng ${index + 1}`;
        const rawType =
          typeIndex >= 0
            ? String(row[typeIndex] ?? "faq").toLocaleLowerCase("vi-VN")
            : inferType(sheet.sheet);
        const type = normalizeType(rawType);
        const signature = `${type}:${title}:${content}`;
        if (seen.has(signature)) continue;
        seen.add(signature);
        entities.push({
          id: createHash("sha256")
            .update(`${input.tenantId}:${sheet.sheet}:${index}:${contentIndex}:${signature}`)
            .digest("hex")
            .slice(0, 20),
          tenantId: input.tenantId,
          type,
          title,
          content,
          sourceRow: index + 1,
        });
      }
    }
  }
  if (entities.length === 0) throw new Error("Không trích xuất được entity từ XLSX");
  return { checksum: createHash("sha256").update(input.bytes).digest("hex"), entities, warnings };
}

const contentHeaders = [
  "content",
  "nội dung",
  "câu trả lời",
  "câu trả lời mẫu",
  "answer",
  "hướng trả lời",
  "hướng xử lý",
  "mô tả",
];
const titleHeaders = [
  "title",
  "tiêu đề",
  "câu hỏi",
  "keyword",
  "các trường hợp",
  "trường hợp",
  "tên sản phẩm",
];
function normalizedCell(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLocaleLowerCase("vi-VN");
}
function findHeaderRow(
  rows: readonly (readonly unknown[])[],
): { index: number; values: string[]; contentIndexes: number[] } | undefined {
  for (let index = 0; index < Math.min(rows.length, 20); index += 1) {
    const values = (rows[index] ?? []).map(normalizedCell);
    const contentIndexes = values
      .map((value, column) => (contentHeaders.includes(value) ? column : -1))
      .filter((column) => column >= 0);
    if (contentIndexes.length > 0) return { index, values, contentIndexes };
  }
  return undefined;
}
function findTitleIndex(headers: readonly string[], contentIndex: number): number {
  for (let index = contentIndex - 1; index >= 0; index -= 1)
    if (titleHeaders.includes(headers[index] ?? "")) return index;
  return 0;
}
function isHeaderLabel(value: string): boolean {
  return contentHeaders.includes(normalizedCell(value)) || titleHeaders.includes(normalizedCell(value));
}
function inferType(sheetName: string): string {
  const name = normalizedCell(sheetName);
  if (name.includes("kịch bản")) return "script";
  if (name.includes("giá")) return "price";
  if (name.includes("faq")) return "faq";
  return "product";
}

function normalizeType(value: string): KnowledgeType {
  const mapping: Record<string, KnowledgeType> = {
    faq: "faq",
    script: "script",
    "kịch bản": "script",
    product: "product",
    "sản phẩm": "product",
    price: "price",
    giá: "price",
    policy: "policy",
    "chính sách": "policy",
    claim: "claim",
    asset: "asset",
    ảnh: "asset",
  };
  return mapping[value] ?? "faq";
}

export function validateKnowledgeVersion(entities: readonly KnowledgeEntity[]): string[] {
  const conflicts: string[] = [];
  const unique = new Map<string, Set<string>>();
  for (const entity of entities) {
    if (!entity.content.trim()) conflicts.push(`${entity.id}: nội dung trống`);
    const key = `${entity.type}:${entity.title.toLocaleLowerCase("vi-VN")}`;
    const values = unique.get(key) ?? new Set<string>();
    values.add(entity.content.trim());
    unique.set(key, values);
  }
  for (const [key, values] of unique)
    if (values.size > 1) conflicts.push(`${key}: có nội dung active mâu thuẫn`);
  return conflicts;
}

export class KnowledgeRegistry {
  private readonly versions = new Map<
    string,
    { version: number; active: boolean; entities: KnowledgeEntity[] }
  >();

  preview(
    tenantId: TenantId,
    version: number,
    entities: readonly KnowledgeEntity[],
  ): { added: number; conflicts: string[] } {
    const current = this.active(tenantId);
    return {
      added: entities.filter((entity) => !current.some((old) => old.id === entity.id)).length,
      conflicts: validateKnowledgeVersion(entities),
    };
  }

  publish(tenantId: TenantId, version: number, entities: readonly KnowledgeEntity[]): void {
    const conflicts = validateKnowledgeVersion(entities);
    if (conflicts.length) throw new Error(`Không thể publish: ${conflicts.join("; ")}`);
    for (const [key, value] of this.versions) if (key.startsWith(`${tenantId}:`)) value.active = false;
    this.versions.set(`${tenantId}:${version}`, {
      version,
      active: true,
      entities: entities.map((x) => ({ ...x })),
    });
  }

  active(tenantId: TenantId): KnowledgeEntity[] {
    const version = [...this.versions.entries()].find(
      ([key, value]) => key.startsWith(`${tenantId}:`) && value.active,
    )?.[1];
    return version?.entities.map((entity) => ({ ...entity })) ?? [];
  }
}

export function retrieveKnowledge(input: {
  tenantId: TenantId;
  query: string;
  entities: readonly KnowledgeEntity[];
  limit?: number;
}): KnowledgeEntity[] {
  return retrieveKnowledgeMatches(input).map((match) => ({ ...match.entity }));
}

export type KnowledgeMatch = {
  entity: KnowledgeEntity;
  score: number;
  matchedTerms: string[];
  matchedConcepts: string[];
};

/**
 * Hybrid retrieval that remains local and deterministic:
 * - exact meaningful-token overlap;
 * - canonical concepts for common Vietnamese paraphrases;
 * - character n-gram similarity for spelling/wording variations.
 *
 * The LLM still performs the final semantic reasoning over these candidates;
 * this layer only makes sure relevant approved knowledge reaches it.
 */
export function retrieveKnowledgeMatches(input: {
  tenantId: TenantId;
  query: string;
  entities: readonly KnowledgeEntity[];
  limit?: number;
}): KnowledgeMatch[] {
  if (detectPromptInjection(input.query)) return [];
  const queryText = normalizeSearchText(input.query);
  const queryTerms = new Set(tokenizeForSearch(queryText));
  const queryConcepts = extractSearchConcepts(queryText);
  const precisionQueryConcepts = new Set(
    [...queryConcepts].filter((concept) => precisionSearchConcepts.has(concept)),
  );
  const queryNgrams = characterNgrams(queryText);
  const ranked = input.entities
    .filter((entity) => entity.tenantId === input.tenantId)
    .map((entity): KnowledgeMatch => {
      const titleText = normalizeSearchText(`${entity.title} ${(entity.searchAliases ?? []).join(" ")}`);
      // responseGuidance deliberately stays out of the searchable corpus. Internal
      // wording constraints must not make an otherwise unrelated article rank.
      const fullText = normalizeSearchText(`${titleText} ${entity.content}`);
      const titleTerms = new Set(tokenizeForSearch(titleText));
      const entityTerms = new Set(tokenizeForSearch(fullText));
      const matchedTerms = [...queryTerms].filter((term) => entityTerms.has(term));
      const matchedTitleTerms = matchedTerms.filter((term) => titleTerms.has(term));
      const entityConcepts = extractSearchConcepts(fullText);
      const matchedConcepts = [...queryConcepts].filter((concept) => entityConcepts.has(concept));
      const unmatchedExclusiveConcepts = [...entityConcepts].filter(
        (concept) => exclusiveSearchConcepts.has(concept) && !queryConcepts.has(concept),
      );
      const tokenCoverage = queryTerms.size > 0 ? matchedTerms.length / queryTerms.size : 0;
      const semanticSimilarity = bestTextSimilarity(
        queryNgrams,
        [entity.title, ...(entity.searchAliases ?? []), ...entity.content.split(/[.!?;\n]+/u)].map((part) =>
          characterNgrams(normalizeSearchText(part)),
        ),
      );
      const score =
        matchedTerms.length * 1.5 +
        matchedTitleTerms.length * 2 +
        tokenCoverage * 4 +
        matchedConcepts.length * 4 +
        semanticSimilarity * 3 -
        unmatchedExclusiveConcepts.length * 6;
      return {
        entity,
        score: Number(score.toFixed(4)),
        matchedTerms,
        matchedConcepts,
      };
    })
    .filter(
      (item) =>
        (precisionQueryConcepts.size === 0 ||
          item.matchedConcepts.some((concept) => precisionQueryConcepts.has(concept))) &&
        (item.matchedTerms.length > 0 || item.matchedConcepts.length > 0 || item.score >= 1.2),
    )
    .sort((a, b) => b.score - a.score || a.entity.id.localeCompare(b.entity.id));
  const strongestScore = ranked[0]?.score ?? 0;
  return (
    ranked
      // Avoid sending weak, adjacent articles to the LLM when one article is a
      // substantially clearer match. Multi-topic queries still retain candidates
      // that reach at least 55% of the best score.
      .filter((item) => item.score >= strongestScore * 0.55)
      .slice(0, input.limit ?? 5)
      .map((item) => ({
        ...item,
        entity: { ...item.entity },
        matchedTerms: [...item.matchedTerms],
        matchedConcepts: [...item.matchedConcepts],
      }))
  );
}

const searchStopWords = new Set([
  "anh",
  "chi",
  "em",
  "minh",
  "shop",
  "san",
  "pham",
  "nay",
  "kia",
  "thi",
  "la",
  "co",
  "khong",
  "duoc",
  "voi",
  "cho",
  "nhu",
  "the",
  "nao",
  "gi",
  "oi",
  "nhe",
  "nha",
  "a",
  "bao",
  "nhieu",
  "thay",
]);

const searchConceptAliases: Readonly<Record<string, readonly string[]>> = {
  price: ["price bao nhieu", "bao nhieu tien", "bao price", "combo"],
  promotion: ["uu dai", "khuyen mai", "giam price", "bot them", "bot dong", "tang kem", "qua tang", "gift"],
  shipping: ["phi giao", "phi ship", "freeship", "mien phi giao", "bao ship"],
  pregnancy: [
    "me bau",
    "ba bau",
    "dang bau",
    "phu nu dang bau",
    "phu nu bau",
    "bau bi",
    "mang thai",
    "co bau",
    "phu nu co thai",
  ],
  breastfeeding: ["cho con bu", "dang cho con bu", "nuoi con bang sua me"],
  child_age: ["tre em", "tre duoi", "tre tu", "be may tuoi", "be bao nhieu tuoi"],
  alcohol: ["alcohol", "co alcohol", "chua alcohol"],
  body_area_hands_feet: ["mo hoi tay", "mo hoi chan", "long ban tay", "long ban chan"],
  effectiveness_start: [
    "bao lau thay hieu qua",
    "bao lau thi thay hieu qua",
    "sau bao lau moi thay hieu qua",
    "khi nao thay hieu qua",
    "may ngay thay hieu qua",
    "may hom thi co tac dung",
    "khi nao bat dau co tac dung",
    "dung bao nhieu ngay thi do mo hoi",
    "bao lau thay kho",
  ],
  general_usage: ["cach dung nhu nao", "huong dan su dung stopirex", "dung stopirex nhu the nao"],
  usage: ["cach dung", "huong dan", "boi", "lan", "su dung"],
  duration: ["dung duoc bao lau", "dung may thang", "thoi gian su dung"],
  sweat: ["mo hoi", "uot ao", "uot sung", "tiet mo hoi", "kho thoang"],
  odor: ["mui", "hoi nach", "khu mui", "mui co the"],
  irritation: ["rat", "ngua", "viem", "kich ung", "cham chich", "do da"],
  damaged: ["vo", "hong", "be", "ro ri", "mop", "do san pham"],
  returns: ["doi tra", "tra hang", "hoan tien", "bao hanh"],
  authenticity: ["hang gia", "chinh hang", "hang that", "fake", "nguon goc"],
  exercise: ["tap gym", "da bong", "the thao", "van dong", "ra mo hoi"],
  permanent: ["dut diem", "tam thoi", "dung ca doi", "ngung boi", "ra lai"],
  laboratory_chemistry: ["paraben", "kim loai nang", "asen", "thuy ngan", "hydroquinone"],
  missed_evening_application: [
    "quen boi buoi toi",
    "quen lan buoi toi",
    "boi bu sang",
    "lan bu sang",
    "quet buoi sang",
  ],
};

const precisionSearchConcepts = new Set([
  "price",
  "pregnancy",
  "breastfeeding",
  "child_age",
  "alcohol",
  "body_area_hands_feet",
  "effectiveness_start",
  "general_usage",
]);

const exclusiveSearchConcepts = new Set(["pregnancy", "breastfeeding", "child_age", "body_area_hands_feet"]);

function normalizeSearchText(value: string): string {
  return (
    value
      // Preserve the semantic distinction between Vietnamese "cồn" and "con".
      // Removing accents first would otherwise rank breastfeeding content for an
      // alcohol question.
      .replace(/cồn/giu, " alcohol ")
      .replace(/giá trị/giu, " value ")
      .replace(/giả/giu, " counterfeit ")
      .replace(/giá/giu, " price ")
      .replace(/quà/giu, " gift ")
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .replace(/đ/giu, "d")
      .toLocaleLowerCase("vi-VN")
      .replace(/[^a-z0-9]+/gu, " ")
      .replace(/\s+/gu, " ")
      .trim()
  );
}

function tokenizeForSearch(normalizedText: string): string[] {
  return normalizedText.split(" ").filter((term) => term.length > 1 && !searchStopWords.has(term));
}

function extractSearchConcepts(normalizedText: string): Set<string> {
  const concepts = new Set<string>();
  const boundedText = ` ${normalizedText} `;
  for (const [concept, aliases] of Object.entries(searchConceptAliases)) {
    if (aliases.some((alias) => boundedText.includes(` ${normalizeSearchText(alias)} `))) {
      concepts.add(concept);
    }
  }
  return concepts;
}

function characterNgrams(normalizedText: string): Set<string> {
  const compact = ` ${normalizedText.replace(/\s+/gu, " ")} `;
  const grams = new Set<string>();
  for (let index = 0; index <= compact.length - 3; index += 1) {
    grams.add(compact.slice(index, index + 3));
  }
  return grams;
}

function bestTextSimilarity(query: ReadonlySet<string>, candidates: readonly ReadonlySet<string>[]): number {
  let best = 0;
  for (const candidate of candidates) {
    if (query.size === 0 || candidate.size === 0) continue;
    let intersection = 0;
    for (const gram of query) if (candidate.has(gram)) intersection += 1;
    best = Math.max(best, (2 * intersection) / (query.size + candidate.size));
  }
  return best;
}

export class KnowledgeGroundingError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "KnowledgeGroundingError";
  }
}

export function assertKnowledgeAnswerGrounded(input: {
  reply: string;
  baseReply?: string;
  retrievedKnowledge: readonly Pick<KnowledgeEntity, "id" | "title" | "content">[];
  knowledgeIds?: readonly string[];
  unsupportedQuestions?: readonly string[];
  groundingConfidence?: number;
  required: boolean;
}): string[] {
  if (!input.required) return [];
  const retrievedById = new Map(input.retrievedKnowledge.map((entity) => [entity.id, entity]));
  const claimedIds = [...new Set(input.knowledgeIds ?? [])];
  const invalidIds = claimedIds.filter((id) => !retrievedById.has(id));
  if (invalidIds.length > 0) throw new KnowledgeGroundingError("unknown_knowledge_id");

  const selected = claimedIds
    .map((id) => retrievedById.get(id))
    .filter((entity): entity is Pick<KnowledgeEntity, "id" | "title" | "content"> => Boolean(entity));
  const defersUnknownPart =
    /chưa (?:có|được|thấy)|cần (?:kiểm tra|xác minh)|chuyển (?:nhân viên|bộ phận liên quan)|kiểm tra thêm|báo lại/iu.test(
      input.reply,
    );
  if (selected.length === 0) {
    if ((input.unsupportedQuestions?.length ?? 0) > 0 && defersUnknownPart) return [];
    throw new KnowledgeGroundingError("knowledge_citation_missing");
  }
  if ((input.groundingConfidence ?? 0) < 0.55) {
    throw new KnowledgeGroundingError("grounding_confidence_low");
  }
  if ((input.unsupportedQuestions?.length ?? 0) > 0 && !defersUnknownPart) {
    throw new KnowledgeGroundingError("unsupported_part_not_disclosed");
  }

  const sourceText = normalizeSearchText(
    `${selected.map((entity) => `${entity.title} ${entity.content}`).join(" ")} ${input.baseReply ?? ""}`,
  );
  const replyText = normalizeSearchText(input.reply);
  const unsupportedText = normalizeSearchText((input.unsupportedQuestions ?? []).join(" "));
  const criticalConcepts: Readonly<Record<string, readonly string[]>> = {
    washing: ["xa phong", "tam lai", "rua lai", "tam bang"],
    invoice: ["vat", "hoa don"],
  };
  for (const aliases of Object.values(criticalConcepts)) {
    const claimed = aliases.some((alias) => replyText.includes(alias));
    const explicitlyUnsupported = aliases.some((alias) => unsupportedText.includes(alias));
    const sourced = aliases.some((alias) => sourceText.includes(alias));
    if (claimed && !explicitlyUnsupported && !sourced) {
      throw new KnowledgeGroundingError("ungrounded_critical_concept");
    }
  }
  const sourceNumbers = new Set(sourceText.match(/\b\d+(?:[.]\d+)*\b/gu) ?? []);
  const replyNumbers = replyText.match(/\b\d+(?:[.]\d+)*\b/gu) ?? [];
  if (replyNumbers.some((value) => !sourceNumbers.has(value))) {
    throw new KnowledgeGroundingError("ungrounded_numeric_fact");
  }

  const replyTerms = new Set(tokenizeForSearch(replyText));
  const sourceTerms = new Set(tokenizeForSearch(sourceText));
  const supportedTerms = [...replyTerms].filter((term) => sourceTerms.has(term)).length;
  const coverage = replyTerms.size > 0 ? supportedTerms / replyTerms.size : 1;
  if (coverage < 0.16) throw new KnowledgeGroundingError("knowledge_overlap_too_low");
  return selected.map((entity) => entity.id);
}

export function composeSafeResponse(parts: readonly string[], claims: ClaimRegistry): string {
  const text = parts
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" ");
  claims.assertSafe(text);
  return text;
}

export type AssetRecord = {
  tenantId: TenantId;
  type: string;
  url: string;
  checksum: string;
  caption: string;
  version: number;
  active: boolean;
};
export class AssetRegistry {
  constructor(private readonly assets: readonly AssetRecord[]) {}
  active(tenantId: TenantId, type: string): AssetRecord {
    const matches = this.assets.filter(
      (asset) => asset.tenantId === tenantId && asset.type === type && asset.active,
    );
    if (matches.length !== 1) throw new Error("asset_version_conflict");
    return { ...matches[0]! };
  }
}

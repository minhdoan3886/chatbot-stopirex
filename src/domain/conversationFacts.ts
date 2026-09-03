import { createHash } from "node:crypto";

export type ConversationFactPredicate =
  | "sweat_concern"
  | "odor_severity"
  | "skin_type"
  | "skin_sensitivity_context"
  | "exercise_schedule"
  | "hair_removal_time"
  | "hair_removal_reaction"
  | "product_reaction";

export type ConversationFactSource = "self_report" | "third_party_report" | "copied_review" | "hypothetical";

export type ConversationFactScenario = "actual" | "past" | "hypothetical";
export type ConversationFactTemporal = "current" | "past" | "today" | "yesterday" | "habitual";

export type ConversationSubject = {
  id: string;
  type: "self" | "sibling" | "friend" | "external_reviewer";
  label: string;
};

export type ConversationFactClaim = {
  subjectId: string;
  predicate: ConversationFactPredicate;
  value: string | number | boolean;
  product?: "stopirex" | "other_rollon" | "unknown";
  temporal: ConversationFactTemporal;
  scenario: ConversationFactScenario;
  source: ConversationFactSource;
  polarity: "positive" | "negative";
  confidence: number;
  evidence: string;
};

export type ConversationFact = ConversationFactClaim & {
  id: string;
  sourceTurn: number;
  status: "current" | "superseded";
  supersededBy?: string;
};

export type ConversationFactLedger = {
  subjects: ConversationSubject[];
  facts: ConversationFact[];
};

export type ConversationFactReceipt = {
  turn: number;
  acceptedFactIds: string[];
  supersededFactIds: string[];
  rejected: Array<{ evidence: string; reason: string }>;
  attribution: ConversationTurnAttribution;
  responseSource?: "fact_ledger";
};

export type ConversationTurnAttribution = {
  primarySubjectId: string;
  source: ConversationFactSource;
  scenario: ConversationFactScenario;
  product: "stopirex" | "other_rollon" | "unknown";
  thirdParty: boolean;
  quotedReview: boolean;
  correction: boolean;
  memoryQuestion: boolean;
  currentCustomerStopirexIrritation: boolean;
};

export type ConversationFactResponsePlan = {
  reply: string;
  intent: "consultation" | "safety" | "usage_time" | "product_comparison" | "other";
  topic: "sweat" | "sensitive_skin" | "usage" | "comparison" | "irritation" | "other";
  reason: string;
  dismissCare: boolean;
};

const selfSubject: ConversationSubject = { id: "self", type: "self", label: "bạn" };

export function initialConversationFactLedger(): ConversationFactLedger {
  return { subjects: [{ ...selfSubject }], facts: [] };
}

export function sanitizeConversationFactLedger(value: unknown): ConversationFactLedger {
  if (!value || typeof value !== "object" || Array.isArray(value)) return initialConversationFactLedger();
  const input = value as Partial<ConversationFactLedger>;
  const subjects = Array.isArray(input.subjects)
    ? input.subjects.filter(isConversationSubject).slice(-12)
    : [];
  const facts = Array.isArray(input.facts) ? input.facts.filter(isConversationFact).slice(-80) : [];
  if (!subjects.some((subject) => subject.id === "self")) subjects.unshift({ ...selfSubject });
  return { subjects, facts };
}

export function classifyConversationTurn(raw: string): ConversationTurnAttribution {
  const text = normalize(raw);
  const quotedReview = /(?:copy|gui|dan|trich).{0,30}review|review nay|review do|cho coi.{0,20}review/.test(
    text,
  );
  const friend = /\b(?:th|thang|dua|nguoi)?\s*ban (?:tui|minh|toi)\b|\bban cua (?:tui|minh|toi)\b/.test(text);
  const sibling = /\b(?:nho|dua)?\s*e(?:m)? (?:tui|minh|toi)\b|\bem (?:gai|trai|nho)\b/.test(text);
  const hypothetical =
    /(?:^|\b)(?:neu|gia su|vi du|lo nhu|lo ma|truong hop)\b/.test(text) ||
    (/\bchua (?:tung )?(?:dung|xai|lan|boi)\b/.test(text) &&
      /\b(?:so|lo|ngai).{0,25}\b(?:rat|ngua|do|kich ung|di ung)\b/.test(text));
  const memoryQuestion =
    /\b(?:recap|chot lai|tong ket|nhac lai)\b/.test(text) ||
    /\btruoc .*(?:co )?noi\b/.test(text) ||
    /\btung bi .*(?:dung khong|phai khong)\b/.test(text) ||
    /\bvan de chinh\b/.test(text) ||
    /\breview.*(?:cua ai|nguoi nao)\b/.test(text);
  const correction = /\b(?:nham|sua lai|doi roi|doi r|moi dung|moi la|khong phai|chu khong phai)\b/.test(
    text,
  );
  const otherProduct = /\b(?:lan|loai|san pham|hang) khac\b|\b(?:etiaxil|perspirex|nivea|romano)\b/.test(
    text,
  );
  const explicitStopirex = /\bstopirex\b|\bstop rex\b|\bstop rech\b/.test(text);
  const adverse = /\b(?:rat|ngua|do|do da|kich ung|di ung|viem)\b/.test(text);
  const questionOnly =
    memoryQuestion ||
    (/\b(?:dung khong|phai khong|chua ta|chua|co .* khong)\b/.test(text) && !/\bdang\b/.test(text));
  const currentEvidence =
    /\b(?:hien tai|hien|dang|con)\b.{0,30}\b(?:rat|ngua|do|do da|kich ung|di ung|viem)\b/.test(text) ||
    /\b(?:moi|vua|da) (?:dung|xai|lan|boi)\b.{0,70}\b(?:bi|dang) (?:rat|ngua|do|do da|kich ung|di ung|viem)\b/.test(
      text,
    ) ||
    /\b(?:mua|dung|xai|lan|boi)\b.{0,90}\b(?:bi|dang) (?:rat|ngua|do|do da|kich ung|di ung|viem)\b.{0,50}\b(?:hien|dang|van con|con)\b/.test(
      text,
    );
  const historical = /\b(?:tung|truoc day|lan truoc|hoi do|da tung)\b/.test(text);
  const primarySubjectId = quotedReview
    ? "external-reviewer-1"
    : friend
      ? "friend-1"
      : sibling
        ? "sibling-1"
        : "self";
  // A real symptom that is explicitly happening now wins over a later
  // conditional clause (for example: "đang đỏ rát nhưng nếu ổn thì mua").
  const explicitCurrentSelfIncident =
    adverse &&
    primarySubjectId === "self" &&
    !quotedReview &&
    !otherProduct &&
    !questionOnly &&
    currentEvidence;
  const source: ConversationFactSource =
    !explicitCurrentSelfIncident && hypothetical
      ? "hypothetical"
      : quotedReview
        ? "copied_review"
        : friend || sibling
          ? "third_party_report"
          : "self_report";
  const scenario: ConversationFactScenario = explicitCurrentSelfIncident
    ? "actual"
    : hypothetical
      ? "hypothetical"
      : historical
        ? "past"
        : "actual";
  const product = otherProduct ? "other_rollon" : explicitStopirex ? "stopirex" : "unknown";
  return {
    primarySubjectId,
    source,
    scenario,
    product,
    thirdParty: friend || sibling || quotedReview,
    quotedReview,
    correction,
    memoryQuestion,
    currentCustomerStopirexIrritation: explicitCurrentSelfIncident,
  };
}

export function reduceConversationFactLedger(input: {
  ledger: ConversationFactLedger;
  raw: string;
  turn: number;
  semanticFacts?: ReadonlyArray<{
    field: string;
    value: string | number | boolean;
    target?: string;
    evidence: readonly string[];
    confidence: number;
  }>;
}): { ledger: ConversationFactLedger; receipt: ConversationFactReceipt; claims: ConversationFactClaim[] } {
  const ledger = sanitizeConversationFactLedger(input.ledger);
  const attribution = classifyConversationTurn(input.raw);
  const deterministicClaims = extractConversationFactClaims(input.raw, attribution);
  const semanticClaims = semanticFactClaims(input.raw, attribution, input.semanticFacts ?? []);
  const claims = deduplicateClaims([...deterministicClaims, ...semanticClaims]);
  const acceptedFactIds: string[] = [];
  const supersededFactIds: string[] = [];
  const rejected: Array<{ evidence: string; reason: string }> = [];

  ensureSubject(ledger, attribution.primarySubjectId);
  for (const claim of claims) {
    ensureSubject(ledger, claim.subjectId);
    if (!claim.evidence.trim() || claim.confidence < 0.75) {
      rejected.push({ evidence: claim.evidence, reason: "missing_or_low_confidence_evidence" });
      continue;
    }
    const duplicate = ledger.facts.find(
      (fact) =>
        fact.status === "current" &&
        fact.subjectId === claim.subjectId &&
        fact.predicate === claim.predicate &&
        fact.product === claim.product &&
        fact.value === claim.value &&
        fact.temporal === claim.temporal &&
        fact.source === claim.source,
    );
    if (duplicate) continue;
    const id = factId(input.turn, claim, acceptedFactIds.length);
    if (isSingleValuePredicate(claim.predicate)) {
      for (const current of ledger.facts) {
        if (
          current.status === "current" &&
          current.subjectId === claim.subjectId &&
          current.predicate === claim.predicate
        ) {
          current.status = "superseded";
          current.supersededBy = id;
          supersededFactIds.push(current.id);
        }
      }
    }
    ledger.facts.push({ ...claim, id, sourceTurn: input.turn, status: "current" });
    acceptedFactIds.push(id);
  }
  ledger.facts = ledger.facts.slice(-80);
  return {
    ledger,
    claims,
    receipt: { turn: input.turn, acceptedFactIds, supersededFactIds, rejected, attribution },
  };
}

function semanticFactClaims(
  raw: string,
  attribution: ConversationTurnAttribution,
  facts: ReadonlyArray<{
    field: string;
    value: string | number | boolean;
    target?: string;
    evidence: readonly string[];
    confidence: number;
  }>,
): ConversationFactClaim[] {
  const normalizedRaw = normalize(raw);
  const predicates: readonly ConversationFactPredicate[] = [
    "sweat_concern",
    "odor_severity",
    "skin_type",
    "skin_sensitivity_context",
    "exercise_schedule",
    "hair_removal_time",
    "hair_removal_reaction",
    "product_reaction",
  ];
  return facts.flatMap((fact) => {
    if (!predicates.includes(fact.field as ConversationFactPredicate)) return [];
    const evidence = fact.evidence.find((item) => normalizedRaw.includes(normalize(item)))?.trim();
    if (!evidence || fact.confidence < 0.75) return [];
    const predicate = fact.field as ConversationFactPredicate;
    const proposedTarget = normalizeSubjectId(fact.target);
    const subjectId =
      predicate === "product_reaction" || attribution.thirdParty
        ? attribution.primarySubjectId
        : (proposedTarget ?? attribution.primarySubjectId);
    if (
      subjectId === "self" &&
      (attribution.quotedReview || attribution.source === "hypothetical" || attribution.memoryQuestion)
    ) {
      return [];
    }
    const value = normalizeFactValue(predicate, fact.value);
    if (value === undefined) return [];
    return [
      {
        subjectId,
        predicate,
        value,
        ...(predicate === "product_reaction" ? { product: attribution.product } : {}),
        temporal: attribution.scenario === "past" ? "past" : "current",
        scenario: attribution.scenario,
        source: attribution.source,
        polarity: value === false || value === "none" ? "negative" : "positive",
        confidence: fact.confidence,
        evidence,
      },
    ];
  });
}

function deduplicateClaims(claims: readonly ConversationFactClaim[]): ConversationFactClaim[] {
  const seen = new Set<string>();
  return claims.filter((claim) => {
    const key = JSON.stringify([
      claim.subjectId,
      claim.predicate,
      claim.value,
      claim.product ?? null,
      claim.scenario,
      claim.source,
    ]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeSubjectId(value: string | undefined): string | undefined {
  const target = normalize(value ?? "");
  if (!target) return undefined;
  if (["self", "customer", "user", "khach", "ban"].includes(target)) return "self";
  if (/friend|ban cua|ban tui|ban minh/.test(target)) return "friend-1";
  if (/sibling|em gai|em trai|em cua/.test(target)) return "sibling-1";
  if (/review|reviewer|nguoi viet/.test(target)) return "external-reviewer-1";
  return value?.trim().slice(0, 80);
}

function normalizeFactValue(
  predicate: ConversationFactPredicate,
  value: string | number | boolean,
): string | number | boolean | undefined {
  if (predicate === "sweat_concern") {
    if (typeof value === "boolean") return value;
    if (typeof value !== "string") return undefined;
    const normalized = normalize(value);
    if (/^(?:false|no|none|khong|ko|k)$/.test(normalized)) return false;
    if (
      /^(?:true|yes|co|heavy|severe|high|nang|nhieu)$/.test(normalized) ||
      /(?:mo hoi|mh|uot|dam|nhu tam)/.test(normalized)
    ) {
      return true;
    }
    return undefined;
  }
  if (typeof value !== "string") return value;
  const normalized = normalize(value);
  if (predicate === "skin_type") {
    if (/normal|binh thuong|\bbt\b/.test(normalized)) return "normal";
    if (/sensitive|nhay cam/.test(normalized)) return "sensitive";
    return undefined;
  }
  if (predicate === "odor_severity") {
    if (/none|khong mui/.test(normalized)) return "none";
    if (/mild|light|it|nhe|binh thuong|khong (?:nang|nhieu|dang ke)|khong_dang_ke/.test(normalized)) {
      return "mild";
    }
    if (/strong|heavy|severe|nang|nhieu/.test(normalized)) return "strong";
    return undefined;
  }
  if (predicate === "skin_sensitivity_context") {
    return /after.hair.removal|sau (?:wax|cao)|wax|cao/.test(normalized) ? "after_hair_removal" : undefined;
  }
  if (predicate === "exercise_schedule") {
    const period = /morning|sang/.test(normalized)
      ? "morning"
      : /evening|toi/.test(normalized)
        ? "evening"
        : undefined;
    const days = [...normalized.matchAll(/[2-7]/g)].map((match) => match[0]);
    return period && days.length > 0 ? `${period}|${[...new Set(days)].join(",")}` : undefined;
  }
  if (predicate === "hair_removal_time") {
    if (/yesterday|hom qua|hqua|bua qua/.test(normalized)) return "yesterday";
    if (/today|hom nay|bua nay|bua ni/.test(normalized)) return "today";
    if (/past|truoc do|truoc day/.test(normalized)) return "past";
    return undefined;
  }
  if (predicate === "hair_removal_reaction") {
    if (/none|no irritation|khong xot|khong rat/.test(normalized)) return "none";
    if (/irritation|xot|rat/.test(normalized)) return "irritation";
    return undefined;
  }
  if (predicate === "product_reaction") {
    if (/itch|ngua/.test(normalized)) return "itching";
    if (/red|do da/.test(normalized)) return "redness";
    if (/irritation|rat|kich ung|di ung|viem/.test(normalized)) return "irritation";
    return undefined;
  }
  return undefined;
}

export function planConversationFactResponse(input: {
  ledger: ConversationFactLedger;
  raw: string;
  claims: readonly ConversationFactClaim[];
  attribution: ConversationTurnAttribution;
  semanticIntent?: string;
}): ConversationFactResponsePlan | undefined {
  const text = normalize(input.raw);
  const descriptiveNotMuch = /\b(?:k|ko|khong) bao nhieu\b/.test(text);
  const directQuestion =
    /[?？]/u.test(input.raw) ||
    ((!descriptiveNotMuch || !/\bbao nhieu\b/.test(text)) &&
      /\b(?:bao nhieu|the nao|tai sao|vi sao|co .* khong|duoc khong|dung khong|phai khong|hay khong)\b/.test(
        text,
      ));
  const orderSupportQuestion =
    /\b(?:don hang|thong tin don|nguoi nhan|dia chi|sdt|so dien thoai|tong tien|tra hang|hoan tien|bao hanh)\b/.test(
      text,
    ) || /\b(?:[1-5]|mot|hai|ba|bon|nam)\s+lo\b/.test(text);
  const ledger = sanitizeConversationFactLedger(input.ledger);
  const has = (predicate: ConversationFactPredicate, subjectId = "self") =>
    currentFact(ledger, predicate, subjectId);
  const mainConcern = mainConcernText(ledger);
  const skin = skinText(ledger);
  const schedule = has("exercise_schedule")?.value;
  const hairTime = has("hair_removal_time")?.value;
  const selfStopirexReaction = ledger.facts.some(
    (fact) =>
      fact.status === "current" &&
      fact.subjectId === "self" &&
      fact.predicate === "product_reaction" &&
      fact.product === "stopirex" &&
      fact.scenario !== "hypothetical" &&
      fact.source === "self_report" &&
      fact.polarity === "positive",
  );
  const friendReaction = currentFact(ledger, "product_reaction", "friend-1");
  const reviewReaction = currentFact(ledger, "product_reaction", "external-reviewer-1");
  const otherProductReaction = ledger.facts.find(
    (fact) =>
      fact.status === "current" &&
      fact.subjectId === "self" &&
      fact.predicate === "product_reaction" &&
      fact.product === "other_rollon",
  );

  if (/\b(?:recap|chot lai|tong ket|nhac lai)\b/.test(text) && !orderSupportQuestion) {
    const parts = [mainConcern, skin];
    if (schedule) parts.push(`Lịch gym hiện tại là ${formatSchedule(String(schedule))}`);
    if (hairTime) parts.push(`Bạn đã sửa lại là cạo/wax ${formatHairTime(String(hairTime))}`);
    parts.push(
      selfStopirexReaction
        ? "Bạn đã xác nhận từng có phản ứng với Stopirex"
        : "Bạn chưa từng nói mình bị ngứa, đỏ da hay dị ứng do Stopirex",
    );
    if (friendReaction) parts.push("người từng bị ngứa là bạn của bạn");
    if (reviewReaction) parts.push("đoạn ngứa/đỏ da là review của người khác mà bạn gửi");
    if (otherProductReaction) parts.push("lần bị rát trước là với một loại lăn khác sau khi cạo");
    return plan(`${joinSentences(parts)}.`, "consultation", "other", "memory_recap", true);
  }

  if (
    input.attribution.memoryQuestion &&
    /\btruoc .*(?:co )?noi.*da .*(?:nhay cam)|da .*(?:nhay cam).*(?:chua ta|chua)\b/.test(text)
  ) {
    const sensitive = has("skin_type")?.value === "sensitive";
    return plan(
      sensitive
        ? "Có, trước đó bạn đã nói da mình nhạy cảm."
        : "Bạn chưa nói da mình nhạy cảm. Trước đó bạn chỉ nói mình vừa cạo/wax hoặc da có thể dễ xót sau khi wax.",
      "other",
      "sensitive_skin",
      "memory_verification",
      true,
    );
  }

  if (/\bcase .*(?:ban|nguoi khac).*khac nhau|(?:ban|nguoi khac).*khac nhau.*cho nao\b/.test(text)) {
    const friendText = friendReaction
      ? "Bạn của bạn đã dùng sản phẩm và theo lời bạn thì từng bị ngứa vài ngày."
      : "Mình chưa có đủ thông tin xác nhận về trường hợp của bạn bạn.";
    return plan(
      `Trường hợp của bạn: ${lowerFirst(mainConcern)}, ${lowerFirst(skin)} và chưa xác nhận từng bị ngứa/rát do Stopirex. ${friendText}`,
      "product_comparison",
      "comparison",
      "subject_comparison",
      true,
    );
  }

  if (
    /\b(?:tui|toi|minh).*(?:tung|da).*(?:do da|ngua|di ung).*(?:stopirex|stop rex).*(?:dung khong|phai khong)\b/.test(
      text,
    )
  ) {
    const detail = otherProductReaction ? " Bạn chỉ nói từng bị rát với một loại lăn khác ngay sau cạo." : "";
    const review = reviewReaction ? " Đoạn ngứa/đỏ da là review của người khác mà bạn gửi." : "";
    return plan(
      selfStopirexReaction
        ? "Đúng, trước đó bạn đã xác nhận phản ứng này là của mình sau khi dùng Stopirex."
        : `Chưa. Bạn chưa từng nói mình bị đỏ da hay dị ứng vì Stopirex.${detail}${review}`,
      "safety",
      "irritation",
      "reaction_owner_verification",
      true,
    );
  }

  if (/\bvan de chinh.*(?:mui|mh|mo hoi)|(?:mui|mh|mo hoi).*van de chinh\b/.test(text)) {
    return plan(`${mainConcern}.`, "consultation", "sweat", "primary_concern_recall", true);
  }

  if (input.attribution.quotedReview && !orderSupportQuestion) {
    return plan(
      "Em hiểu, đây là review của người khác mà mình gửi để tham khảo, không phải trải nghiệm của mình. Em sẽ không ghi nhận ngứa/đỏ da này vào tình trạng của bạn.",
      "safety",
      "irritation",
      "quoted_review_attribution",
      false,
    );
  }

  if (
    input.attribution.primarySubjectId === "friend-1" &&
    input.claims.some((claim) => claim.predicate === "product_reaction") &&
    !orderSupportQuestion
  ) {
    return plan(
      "Em hiểu, người từng dùng rồi bị ngứa vài ngày là bạn của mình, không phải mình. Hai trường hợp sẽ được tách riêng để không ghi nhầm triệu chứng.",
      "safety",
      "irritation",
      "third_party_reaction_attribution",
      false,
    );
  }

  const selfNormal = input.claims.some(
    (claim) => claim.subjectId === "self" && claim.predicate === "skin_type" && claim.value === "normal",
  );
  const siblingSensitive = input.claims.some(
    (claim) =>
      claim.subjectId === "sibling-1" && claim.predicate === "skin_type" && claim.value === "sensitive",
  );
  if (selfNormal && siblingSensitive) {
    return plan(
      "Em nhớ đúng rồi nha: da mình bình thường, chỉ đôi khi dễ xót sau wax; người có da nhạy cảm là em của mình. Em sẽ tư vấn hai trường hợp riêng.",
      "safety",
      "sensitive_skin",
      "subject_skin_correction",
      true,
    );
  }

  if (selfNormal && otherProductReaction) {
    return plan(
      "Em ghi nhận lại: da mình bình thường; lần bị rát trước là khi dùng một loại lăn khác ngay sau cạo, không phải do Stopirex và cũng không phải tình trạng đang xảy ra.",
      "safety",
      "irritation",
      "product_and_time_correction",
      true,
    );
  }

  const scheduleClaim = input.claims.find((claim) => claim.predicate === "exercise_schedule");
  if (scheduleClaim && /\b(?:xai|dung|boi|quet).*(?:luc nao|khi nao)\b/.test(text)) {
    return plan(
      `Với lịch gym ${formatSchedule(String(scheduleClaim.value))}, mình vẫn dùng Stopirex vào buổi tối trên da sạch, khô hoàn toàn. Tránh dùng ngay sau wax/cạo; nên để da ổn rồi mới dùng.`,
      "usage_time",
      "usage",
      "schedule_aware_usage",
      false,
    );
  }
  if (scheduleClaim && input.attribution.correction) {
    return plan(
      `Em cập nhật lịch mới là ${formatSchedule(String(scheduleClaim.value))}; lịch cũ không còn là lịch hiện tại nữa. Mình vẫn ưu tiên dùng Stopirex vào buổi tối.`,
      "usage_time",
      "usage",
      "schedule_correction",
      false,
    );
  }

  const hairReaction = input.claims.find((claim) => claim.predicate === "hair_removal_reaction");
  const hairTimeClaim = input.claims.find((claim) => claim.predicate === "hair_removal_time");
  if (
    hairTimeClaim &&
    /\b(?:quet|lan|boi|dung|xai).*(?:duoc chua|duoc khong|on khong|chua he)\b/.test(text)
  ) {
    return plan(
      "Mình mới cạo nên chưa dùng ngay nha. Sau khi cạo/wax, mình nên chờ ít nhất 24–48 giờ và chỉ dùng khi da đã ổn, sạch và khô hoàn toàn.",
      "safety",
      "sensitive_skin",
      "hair_removal_safety",
      false,
    );
  }
  if (hairReaction?.value === "none") {
    return plan(
      `Em cập nhật: lần wax/cạo ${formatHairTime(String(hairTime ?? "yesterday"))} mình không bị xót. Điều này không xóa thông tin rằng những lần khác da mình vẫn có thể dễ xót sau wax.`,
      "safety",
      "sensitive_skin",
      "hair_removal_event_update",
      true,
    );
  }
  if (hairTimeClaim && input.attribution.correction) {
    return plan(
      `Em sửa lại rồi nha: mình cạo/wax ${formatHairTime(String(hairTimeClaim.value))}, không phải hôm nay.`,
      "safety",
      "sensitive_skin",
      "hair_removal_time_correction",
      true,
    );
  }

  const sensitivityContext = input.claims.find((claim) => claim.predicate === "skin_sensitivity_context");
  if (sensitivityContext && !directQuestion) {
    return plan(
      "Em hiểu: da mình không nhất thiết là da nhạy cảm, nhưng có thể dễ xót sau wax. Khi vừa wax/cạo thì mình nên chờ da ổn hẳn rồi mới dùng.",
      "safety",
      "sensitive_skin",
      "skin_context_acknowledgement",
      false,
    );
  }

  const sweatClaim = input.claims.some((claim) => claim.predicate === "sweat_concern");
  const odorClaim = input.claims.some((claim) => claim.predicate === "odor_severity");
  // Only own a free-form acknowledgement when the turn carries context the
  // legacy discovery flow cannot express well (dialect/abbreviation, severity
  // contrast, or vivid weather analogy). Plain "ướt áo" must continue through
  // the existing guided opening, which asks the useful air-conditioned-room
  // follow-up.
  const descriptiveConcern = /\bmh\b|nhu tam|mua (?:lanh|nong)/.test(text) || odorClaim;
  const consultationTurn =
    !input.semanticIntent || ["consultation", "other", "knowledge_unknown"].includes(input.semanticIntent);
  if ((sweatClaim || odorClaim) && descriptiveConcern && !directQuestion && consultationTurn) {
    return plan(`${mainConcern}.`, "consultation", "sweat", "primary_concern_acknowledgement", false);
  }
  return undefined;
}

export function currentConversationFact(
  ledger: ConversationFactLedger,
  predicate: ConversationFactPredicate,
  subjectId = "self",
): ConversationFact | undefined {
  return currentFact(sanitizeConversationFactLedger(ledger), predicate, subjectId);
}

function extractConversationFactClaims(
  raw: string,
  attribution: ConversationTurnAttribution,
): ConversationFactClaim[] {
  const text = normalize(raw);
  const claims: ConversationFactClaim[] = [];
  const add = (claim: Omit<ConversationFactClaim, "confidence" | "evidence"> & { confidence?: number }) =>
    claims.push({ ...claim, confidence: claim.confidence ?? 0.96, evidence: raw.slice(0, 240) });
  const actualSelfReport = {
    subjectId: "self",
    temporal: "current" as const,
    scenario: "actual" as const,
    source: "self_report" as const,
    polarity: "positive" as const,
  };

  const selfContext = !attribution.quotedReview && attribution.primarySubjectId === "self";
  if (
    selfContext &&
    /\b(?:mo hoi|mh)\b|uot (?:het )?ao|ao (?:cu|cung|hay)\s*uot/.test(text) &&
    !/\b(?:khong|ko|k)\s+(?:ra |bi |co )?(?:mo hoi|mh)\b/.test(text)
  ) {
    add({ ...actualSelfReport, predicate: "sweat_concern", value: true, temporal: "habitual" });
  }
  if (
    selfContext &&
    /mui (?:thi )?(?:k|ko|khong) bao nhieu|mui (?:thi )?(?:binh thuong|bt)|mui (?:k|ko|khong) (?:nang|nhieu)|mui it/.test(
      text,
    )
  ) {
    add({ ...actualSelfReport, predicate: "odor_severity", value: "mild", temporal: "habitual" });
  }

  const selfNormal =
    /\b(?:tui|toi|minh) da (?:bt|binh thuong)\b|\bda (?:tui|toi|minh) (?:bt|binh thuong)\b/.test(text);
  const selfSensitive =
    /\b(?:tui|toi|minh) da (?:hoi )?nhay cam\b|\bda (?:tui|toi|minh|minh) (?:hoi )?nhay cam\b/.test(text) &&
    !attribution.memoryQuestion;
  if (selfNormal) add({ ...actualSelfReport, predicate: "skin_type", value: "normal" });
  if (selfSensitive) add({ ...actualSelfReport, predicate: "skin_type", value: "sensitive" });
  if (/\b(?:em|e|no|nho e|dua e).{0,45}\bda nhay cam\b|\bda nhay cam.{0,30}\b(?:em|e|no)\b/.test(text)) {
    add({
      subjectId: "sibling-1",
      predicate: "skin_type",
      value: "sensitive",
      temporal: "current",
      scenario: "actual",
      source: "third_party_report",
      polarity: "positive",
    });
  }
  if (selfContext && /(?:de|hay) xot.{0,30}(?:wax|cao)|(?:wax|cao).{0,30}(?:de|hay) xot/.test(text)) {
    add({
      ...actualSelfReport,
      predicate: "skin_sensitivity_context",
      value: "after_hair_removal",
      temporal: "habitual",
    });
  }

  const gym = text.match(/\bgym\s+(sang|toi)\s+([2-7](?:\s*[/,.-]?\s*[2-7]){1,5})/);
  if (gym?.[1] && gym[2]) {
    const days = [...gym[2].matchAll(/[2-7]/g)].map((match) => match[0]);
    add({
      ...actualSelfReport,
      predicate: "exercise_schedule",
      value: `${gym[1] === "sang" ? "morning" : "evening"}|${days.join(",")}`,
      temporal: "current",
    });
  }

  const mentionsHairRemoval = /\b(?:wax|cao|triet)\b/.test(text);
  if (selfContext && mentionsHairRemoval) {
    const time = /\b(?:hom qua|hqua|bua qua)\b/.test(text)
      ? "yesterday"
      : /\b(?:hom nay|bua ni|bua nay)\b/.test(text)
        ? "today"
        : undefined;
    if (time) {
      add({ ...actualSelfReport, predicate: "hair_removal_time", value: time, temporal: time });
    }
    if (/\b(?:khong|ko|k) (?:bi )?xot\b|\b(?:khong|ko|k) xot/.test(text)) {
      add({
        ...actualSelfReport,
        predicate: "hair_removal_reaction",
        value: "none",
        temporal: time ?? "past",
        polarity: "negative",
      });
    }
  }

  const adverse = text.match(/\b(ngua|rat|do da|kich ung|di ung|viem)\b/)?.[1];
  const reactionQuestion =
    attribution.memoryQuestion ||
    /\b(?:dung khong|phai khong|chua ta)\b/.test(text) ||
    (/\bchua\b/.test(text) && /\bnoi\b/.test(text));
  if (adverse && !reactionQuestion) {
    const subjectId = attribution.primarySubjectId;
    const product = attribution.product;
    add({
      subjectId,
      predicate: "product_reaction",
      value: adverse === "do da" ? "redness" : adverse === "ngua" ? "itching" : "irritation",
      product,
      temporal: attribution.scenario === "actual" ? "current" : "past",
      scenario: attribution.scenario,
      source: attribution.source,
      polarity: "positive",
      confidence: attribution.source === "copied_review" ? 0.99 : 0.95,
    });
  }
  return claims;
}

function currentFact(
  ledger: ConversationFactLedger,
  predicate: ConversationFactPredicate,
  subjectId = "self",
): ConversationFact | undefined {
  return [...ledger.facts]
    .reverse()
    .find(
      (fact) => fact.status === "current" && fact.subjectId === subjectId && fact.predicate === predicate,
    );
}

function mainConcernText(ledger: ConversationFactLedger): string {
  const sweat = currentFact(ledger, "sweat_concern")?.value === true;
  const odor = currentFact(ledger, "odor_severity")?.value;
  if (sweat && odor === "mild") {
    return "Vấn đề chính của bạn là mồ hôi nách nhiều làm ướt áo; mùi không đáng kể";
  }
  if (sweat) return "Vấn đề chính của bạn là mồ hôi nách nhiều và gây khó chịu vì ướt áo";
  if (odor === "mild") return "Bạn nói mùi ở mức bình thường và không phải vấn đề chính";
  return "Mình chưa có đủ dữ kiện để kết luận vấn đề chính của bạn";
}

function skinText(ledger: ConversationFactLedger): string {
  const skinType = currentFact(ledger, "skin_type")?.value;
  const context = currentFact(ledger, "skin_sensitivity_context")?.value;
  const lastReaction = currentFact(ledger, "hair_removal_reaction")?.value;
  if (skinType === "normal" && context === "after_hair_removal" && lastReaction === "none") {
    return "Da bạn bình thường nhưng đôi khi dễ xót sau wax; lần wax/cạo gần nhất không bị xót";
  }
  if (skinType === "normal" && context === "after_hair_removal") {
    return "Da bạn bình thường nhưng đôi khi dễ xót sau wax";
  }
  if (skinType === "normal") return "Da bạn bình thường";
  if (skinType === "sensitive") return "Bạn đã xác nhận da mình nhạy cảm";
  if (context === "after_hair_removal")
    return "Bạn chỉ nói da đôi khi dễ xót sau wax, chưa xác nhận là da nhạy cảm";
  return "Bạn chưa xác nhận loại da của mình";
}

function formatSchedule(value: string): string {
  const [period, days] = value.split("|");
  return `${period === "morning" ? "sáng" : "tối"} thứ ${(days ?? "").split(",").join(", ")}`;
}

function formatHairTime(value: string): string {
  if (value === "today") return "hôm nay";
  if (value === "yesterday") return "hôm qua";
  return "trước đó";
}

function joinSentences(parts: Array<string | undefined>): string {
  return parts
    .filter((part): part is string => Boolean(part?.trim()))
    .map((part) => part.trim().replace(/[.!?]+$/u, ""))
    .join(". ");
}

function lowerFirst(value: string): string {
  return value ? `${value[0]?.toLocaleLowerCase("vi-VN")}${value.slice(1)}` : value;
}

function plan(
  reply: string,
  intent: ConversationFactResponsePlan["intent"],
  topic: ConversationFactResponsePlan["topic"],
  reason: string,
  dismissCare: boolean,
): ConversationFactResponsePlan {
  return { reply, intent, topic, reason, dismissCare };
}

function isSingleValuePredicate(predicate: ConversationFactPredicate): boolean {
  return [
    "odor_severity",
    "skin_type",
    "exercise_schedule",
    "hair_removal_time",
    "hair_removal_reaction",
  ].includes(predicate);
}

function ensureSubject(ledger: ConversationFactLedger, id: string): void {
  if (ledger.subjects.some((subject) => subject.id === id)) return;
  if (id === "friend-1") ledger.subjects.push({ id, type: "friend", label: "bạn của khách" });
  else if (id === "sibling-1") ledger.subjects.push({ id, type: "sibling", label: "em của khách" });
  else if (id === "external-reviewer-1") {
    ledger.subjects.push({ id, type: "external_reviewer", label: "người viết review" });
  }
}

function factId(turn: number, claim: ConversationFactClaim, offset: number): string {
  const digest = createHash("sha256")
    .update(`${turn}:${offset}:${claim.subjectId}:${claim.predicate}:${claim.value}:${claim.evidence}`)
    .digest("hex")
    .slice(0, 12);
  return `fact-${turn}-${digest}`;
}

function normalize(value: string): string {
  return value
    .toLocaleLowerCase("vi-VN")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/đ/gu, "d")
    .replace(/[“”„‟«»]/gu, '"')
    .replace(/[^a-z0-9"/.,?\s-]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function isConversationSubject(value: unknown): value is ConversationSubject {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const input = value as Partial<ConversationSubject>;
  return (
    typeof input.id === "string" &&
    typeof input.label === "string" &&
    ["self", "sibling", "friend", "external_reviewer"].includes(input.type ?? "")
  );
}

function isConversationFact(value: unknown): value is ConversationFact {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const input = value as Partial<ConversationFact>;
  return (
    typeof input.id === "string" &&
    typeof input.subjectId === "string" &&
    typeof input.predicate === "string" &&
    typeof input.evidence === "string" &&
    typeof input.sourceTurn === "number" &&
    (input.status === "current" || input.status === "superseded")
  );
}

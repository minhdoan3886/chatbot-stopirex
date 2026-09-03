import { ClaimRegistry, defaultBlockedClaims } from "./claims.js";
import type { ConversationSkillId } from "./chatSkills.js";
import type { CustomerIntent } from "./consultation.js";
import { missingRequiredAnswerTopics } from "./requiredAnswerTopics.js";

export type ConversationQualityEvaluation = {
  intent: CustomerIntent | null;
  skill: ConversationSkillId;
  answeredDirectly: boolean | null;
  oneRelevantQuestion: boolean;
  nextStepClear: boolean;
  under500Characters: boolean;
  noMoreThan3Bubbles: boolean;
  priceFactsPreserved: boolean | null;
  questionCoverageComplete: boolean | null;
  unsafeClaim: boolean;
  internalLanguageLeaked: boolean;
  responseCharacters: number;
  bubbleCount: number;
  questionCount: number;
  passed: boolean;
  hardFailReasons: string[];
};

export type EvaluateConversationQualityInput = {
  customerMessage: string;
  baseReply: string;
  replies: readonly string[];
  skill: ConversationSkillId;
  intent?: CustomerIntent;
  asksDirectAnswer?: boolean;
  expectedQuestionEvidence?: string[];
};

const claims = new ClaimRegistry(defaultBlockedClaims);

export function evaluateConversationQuality(
  input: EvaluateConversationQualityInput,
): ConversationQualityEvaluation {
  const reply = input.replies.join("\n\n").trim();
  const questionCount = (reply.match(/[?？]/gu) ?? []).length;
  const bubbleCount = input.replies.filter((item) => item.trim()).length;
  const unsafeClaim = hasUnsafeClaim(reply);
  const internalLanguageLeaked =
    /\b(?:intent|pipeline|routing agent|skill|guardrail|rule|knowledge|sandbox flow|luồng nội bộ)\b/iu.test(
      reply,
    ) ||
    /hồ sơ hiện có không công bố|bên em không tự nêu|hệ thống (?:em )?(?:không có|chưa có) dữ liệu/iu.test(
      reply,
    );
  const answeredDirectly = input.asksDirectAnswer ? directAnswerHeuristic(reply) : null;
  const priceFactsPreserved = shouldCheckPrice(input)
    ? requiredCommerceFacts(input.baseReply).every((fact) => canonicalCommerce(reply).includes(fact))
    : null;
  // A complete answer to a direct FAQ is already a valid next step. Requiring a
  // CTA here made concise usage answers fail quality even when nothing else was
  // needed from the customer.
  const nextStepClear =
    needsExplicitNextStep(input.skill) && input.asksDirectAnswer !== true
      ? hasNextStep(reply)
      : true;
  const questionCoverageComplete = assessQuestionCoverage(input, reply);
  const hardFailReasons: string[] = [];
  if (unsafeClaim) hardFailReasons.push("unsafe_claim");
  if (internalLanguageLeaked) hardFailReasons.push("internal_language_leaked");
  if (questionCount > 1) hardFailReasons.push("too_many_questions");
  if (bubbleCount > 3) hardFailReasons.push("too_many_bubbles");
  if (reply.length > 500) hardFailReasons.push("response_over_500_characters");
  if (answeredDirectly === false) hardFailReasons.push("direct_question_not_answered_first");
  if (priceFactsPreserved === false) hardFailReasons.push("price_fact_missing_or_changed");
  if (!nextStepClear) hardFailReasons.push("next_step_missing");
  if (questionCoverageComplete === false) hardFailReasons.push("question_coverage_incomplete");

  return {
    intent: input.intent ?? null,
    skill: input.skill,
    answeredDirectly,
    oneRelevantQuestion: questionCount <= 1,
    nextStepClear,
    under500Characters: reply.length <= 500,
    noMoreThan3Bubbles: bubbleCount <= 3,
    priceFactsPreserved,
    questionCoverageComplete,
    unsafeClaim,
    internalLanguageLeaked,
    responseCharacters: reply.length,
    bubbleCount,
    questionCount,
    passed: hardFailReasons.length === 0,
    hardFailReasons,
  };
}

function assessQuestionCoverage(input: EvaluateConversationQualityInput, _reply: string): boolean | null {
  const questionCount = (input.customerMessage.match(/[?？]/gu) ?? []).length;
  if (questionCount === 0) return null;
  const response = normalize(input.replies.join(" "));
  const customer = normalize(input.customerMessage);
  if (missingRequiredAnswerTopics(input.customerMessage, input.replies.join(" ")).length > 0) {
    return false;
  }

  const asksAlcoholAndScent =
    /\b(?:100|hoan toan)?\s*khong con\b|\bco con khong\b/.test(customer) &&
    /\b(?:hoan toan|100)?\s*khong mui\b|\b(?:lon mui|lan mui)\b/.test(customer);
  if (asksAlcoholAndScent) {
    return (
      /\bco (?:chua )?(?:con|alcohol)(?: alcohol)?\b/.test(response) &&
      /\b(?:dong vai tro|dung) lam dung moi\b/.test(response) &&
      /\bnguong an toan\b/.test(response) &&
      /\bmui (?:duoc tinh )?dac trung nhe\b/.test(response) &&
      /\bbay (?:hoi )?(?:rat |cuc ky )?nhanh\b/.test(response) &&
      /\bkhong (?:so bi |lam )?(?:lan|lon|tron) mui\b/.test(response)
    );
  }

  const asksHairRemovalMorningAndClothing =
    /\b(?:nho|cao|wax|triet)\b.{0,25}\b(?:long )?nach\b/.test(customer) &&
    /\b(?:sang|sang nay|quet luon|boi luon|lan luon)\b/.test(customer) &&
    /\b(?:o vang|ao so mi|vang nach ao)\b/.test(customer);
  if (asksHairRemovalMorningAndClothing) {
    return (
      /\b24\s*48 gio\b/.test(response) &&
      /\bda da on\b|\bda on\b/.test(response) &&
      /\bbuoi toi\b/.test(response) &&
      /\bda sach\b.{0,20}\bkho\b/.test(response) &&
      /\bkhong bet\b/.test(response) &&
      /\bkhong gay o vang\b|\bkhong o vang\b/.test(response)
    );
  }

  const asksCompetitorAfterAdverseExperience =
    /\b(?:etiaxil|perspirex)\b/.test(customer) &&
    /\b(?:ngua|rat|do|tray|kich ung)\b/.test(customer) &&
    /\b(?:stopirex|loai (?:nay|nha ban))\b/.test(customer);
  if (asksCompetitorAfterAdverseExperience) {
    return (
      /\b(?:khong nhan xet|khong binh luan)\b/.test(response) &&
      /\b(?:kiem nghiem|thu nghiem)\b/.test(response) &&
      /\b(?:bisabolol|cuc la ma|cuc duc)\b/.test(response) &&
      /\b(?:lop mong|lan mong)\b/.test(response)
    );
  }

  const asksWholesaleSupport =
    /\b(?:nhap si|dai ly|nha thuoc|tiem thuoc|\d{2,}\s*lo)\b/.test(customer) &&
    /\b(?:chiet khau|vat|hoa don|tu ke|banner)\b/.test(customer);
  if (asksWholesaleSupport) {
    const coversDiscount = !/\bchiet khau\b/.test(customer) || /\bchiet khau\b/.test(response);
    const coversVat = !/\b(?:vat|hoa don)\b/.test(customer) || /\b(?:vat|hoa don)\b/.test(response);
    const coversDisplay =
      !/\b(?:tu ke|banner)\b/.test(customer) || /\b(?:tu ke|banner)\b/.test(response);
    return (
      coversDiscount &&
      coversVat &&
      coversDisplay &&
      /\bbo phan lien quan\b/.test(response) &&
      !/\b\d+\s*(?:%|phan tram)\b/.test(response)
    );
  }

  const cancelsWholesaleForRetailOrder =
    /\b(?:chua|khong|thoi|tu tu)\b.{0,30}\bnhap si\b/.test(customer) &&
    /\b(?:chot|lay|mua|gui)\b.{0,25}\b(?:1|mot) lo\b/.test(customer);
  if (cancelsWholesaleForRetailOrder) {
    return (
      /\b1 lo\b/.test(response) &&
      /\b0987654321\b/.test(response) &&
      /\btoa v6\b/.test(response) &&
      /\bgio hanh chinh\b/.test(response) &&
      /\bkhong theo doi thoi tiet\b/.test(response) &&
      !/\b(?:nhap hang|don si|chiet khau|tu ke|banner)\b/.test(response)
    );
  }

  const asksUsedIneffectiveRefund =
    /\b(?:sau|du) 2 tuan\b.{0,45}\b(?:van uot|van ra mo hoi|khong cai thien)\b/.test(customer) &&
    /\bhoan tien\b/.test(customer);
  if (asksUsedIneffectiveRefund) {
    return (
      /\bdung dung huong dan\b.{0,25}\bdu 2 tuan\b/.test(response) &&
      /\bclip\b.{0,30}\bnhung huy\b/.test(response) &&
      /\bkhong can\b.{0,35}\bvo hop\b/.test(response) &&
      (/\bkhong (?:can )?gui (?:san pham|hang) ve\b/.test(response) ||
        /\bkhong can\b.{0,35}\bvo hop\b.{0,35}\bgui (?:san pham|hang) ve\b/.test(response)) &&
      !/\bnguyen seal\b|\b7 ngay\b|\b48 gio\b/.test(response)
    );
  }

  const asksInternationalShippingAndCompensation =
    /\b(?:nhat ban|nuoc ngoai|quoc te)\b/.test(customer) &&
    /\b(?:phi ship|phi giao|den gap doi|boi thuong|mop meo)\b/.test(customer);
  if (asksInternationalShippingAndCompensation) {
    return (
      /\bnhan vien\b.{0,40}\b(?:van hanh|kiem tra)\b|\b(?:van hanh|kiem tra)\b.{0,40}\bnhan vien\b/.test(
        response,
      ) &&
      /\bphi\b/.test(response) &&
      /\bboi thuong\b/.test(response) &&
      !/\bden gap doi\b.{0,20}\b(?:duoc|se|cam ket)\b/.test(response)
    );
  }

  const asksMissedEveningMakeupDose =
    /\b(?:quen|lo|bo)\b.{0,50}\b(?:boi|lan|dung)\b.{0,30}\btoi\b/.test(customer) &&
    /\b(?:sang|buoi sang)\b.{0,40}\b(?:boi|lan|quet|dung)\b|\b(?:boi|lan|quet) bu\b.{0,30}\bsang\b/.test(
      customer,
    );
  if (asksMissedEveningMakeupDose) {
    return (
      /\bkhong (?:can )?(?:boi|lan|quet) bu\b.{0,30}\b(?:sang|buoi sang)\b/.test(response) &&
      /\bda sach\b.{0,20}\bkho\b/.test(response) &&
      /\btuyen mo hoi\b.{0,50}\bhoat dong it hon\b/.test(response) &&
      /\bboi (?:buoi )?sang\b.{0,40}\bkem hieu qua hon\b/.test(response)
    );
  }

  // This is a two-part mechanism question, but neither part is a support case:
  // the product controls secretion without removing the gland, therefore an
  // after-one-year "recurrence rate" is not an applicable product statistic.
  const asksGlandRemovalAndRecurrence =
    /\b(?:tuyen mo hoi|apocrine)\b/.test(customer) &&
    /\b(?:vinh vien|triet tieu|loai bo)\b/.test(customer) &&
    /\b(?:tai phat|sau 1 nam|ty le|ti le|phan tram)\b/.test(customer);
  if (asksGlandRemovalAndRecurrence) {
    return (
      /\b(?:uc che|giam)\b.{0,50}\b(?:mo hoi|tiet ra|tiet mo hoi)\b/.test(response) &&
      /\bkhong\b.{0,50}\b(?:loai bo|can thiep)\b.{0,50}\b(?:tuyen mo hoi|phau thuat|thu thuat)\b/.test(
        response,
      ) &&
      /\b(?:ty le|ti le)\b.{0,40}\b(?:tai phat|sau 1 nam)\b.{0,60}\bkhong ap dung\b/.test(response)
    );
  }

  const requirements: boolean[] = [];
  const asksMorningApplication =
    /\b(?:sang|buoi sang|sang day|sang ngu day)\b/.test(customer) &&
    /\b(?:boi|lan|quet|dung)\b/.test(customer) &&
    !/\b(?:nuoc hoa|lan khu mui|romano)\b/.test(customer);
  if (asksMorningApplication) {
    requirements.push(
      /\bbuoi toi\b/.test(response) &&
        (/\bkhong\b.{0,80}\b(?:buoi )?sang\b/.test(response) ||
          /\b(?:boi|lan|quet|dung) (?:vao )?(?:buoi )?sang\b.{0,45}\b(?:kem hieu qua|khong dung huong dan)\b/.test(
            response,
          )),
    );
  }
  if (/\b(?:gia|gia ro|bao nhieu tien)\b/.test(customer)) {
    requirements.push(/285.?000|510.?000|gia/.test(response));
  }
  if (/\b(?:freeship|free ship|mien phi giao|phi ship|phi giao)\b/.test(customer)) {
    requirements.push(/mien phi giao|30.?000|phi giao/.test(response));
  }
  if (/\b(?:khoi vinh vien|vinh vien|khong bao gio bi lai|dut diem)\b/.test(customer)) {
    requirements.push(/khong.{0,40}vinh vien|khong phai.{0,40}(?:chua|loai bo)|kiem soat/.test(response));
  }
  if (/\b(?:bao lau|khi nao)\b.*\b(?:kho|hieu qua|tac dung)\b/.test(customer)) {
    requirements.push(
      /tuan dau|bat dau/.test(response) && /72 gio/.test(response) && /2.?3 (?:lan|ngay)/.test(response),
    );
  }
  if (/\b(?:ngay nao cung|hang ngay|ban ngay|cach boi|cach dung)\b/.test(customer)) {
    requirements.push(/buoi toi/.test(response) && /2.?3 lan|khong can boi hang ngay/.test(response));
  }
  if (/\b(?:tham|den xi|sam nach)\b/.test(customer)) requirements.push(/tham|doi mau/.test(response));
  if (/\b(?:o vang|vang nach ao|ao so mi trang)\b/.test(customer))
    requirements.push(/o vang|khong bam/.test(response));
  if (/\b(?:cho con bu|me bim sua|tuyen sua)\b/.test(customer))
    requirements.push(/bac si|cho con bu/.test(response));
  if (/\b(?:da nhay cam|ngua|gai do|co em khong)\b/.test(customer)) {
    requirements.push(/diu nhe|kich ung da khong dang ke|nhay cam/.test(response));
  }
  if (/\b(?:be|tre)\b.*\b(?:tuoi|day thi)\b/.test(customer))
    requirements.push(/12 tuoi|14 tuoi/.test(response));
  if (
    /\b(?:la|hay la|co phai)\b.{0,40}\b(?:lan khu mui|thuoc tri|ngan tiet)\b/.test(customer) ||
    /\b(?:lan khu mui|thuoc tri)\b.{0,20}\b(?:hay|hay la)\b/.test(customer)
  )
    requirements.push(/ngan tiet mo hoi|kiem soat mo hoi/.test(response));
  const asksProductScent =
    /\b(?:san pham|stopirex|cai nay|loai nay|lan nay)\b.{0,40}\b(?:co mui|mui gi|thom|khong mui)\b/.test(
      customer,
    ) ||
    /\b(?:co mui|mui gi|khong mui)\b.{0,30}\b(?:san pham|stopirex|cai nay|loai nay|lan nay)\b/.test(
      customer,
    );
  if (asksProductScent)
    requirements.push(/mui (?:duoc tinh )?dac trung|khong dung huong/.test(response));
  if (/\b(?:may ngay|bao lau|khi nao)\b.*\b(?:nhan|giao|toi)\b/.test(customer)) {
    requirements.push(/thoi gian giao|van don|so ngay|ngay/.test(response));
  }
  if (/\b(?:boc|mo|kiem|dong kiem)\b.{0,35}\b(?:hang|hop|seal|tem)\b/.test(customer)) {
    requirements.push(/kiem tra/.test(response) && /seal|tem|bao bi/.test(response));
  }
  if (requirements.length > 0) return requirements.every(Boolean);
  const evidence = (input.expectedQuestionEvidence ?? []).filter(Boolean);
  return evidence.length === 0 || evidence.every((item) => coverageOverlap(item, response) >= 0.15);
}

function coverageOverlap(evidence: string, normalizedReply: string): number {
  const ignored = new Set([
    "anh",
    "chi",
    "em",
    "minh",
    "shop",
    "co",
    "khong",
    "duoc",
    "nay",
    "kia",
    "mot",
    "cai",
  ]);
  const terms = [...new Set(normalize(evidence).split(" "))].filter(
    (term) => term.length > 1 && !ignored.has(term),
  );
  if (terms.length === 0) return 1;
  const matches = terms.filter((term) => normalizedReply.includes(term)).length;
  return matches / terms.length;
}

function normalize(value: string): string {
  return value
    .toLocaleLowerCase("vi-VN")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/đ/gu, "d")
    .replace(/[^a-z0-9]+/gu, " ")
    .trim();
}

function directAnswerHeuristic(reply: string): boolean {
  const firstBlock = reply.split(/\n\s*\n+/u)[0]?.trim() ?? "";
  if (!firstBlock) return false;
  if (/^(?:dạ\s+)?(?:em\s+)?(?:hỏi|xin hỏi|kiểm tra nhanh)/iu.test(firstBlock)) {
    return false;
  }
  return firstBlock.replace(/[?？]/gu, "").trim().length >= 12;
}

function needsExplicitNextStep(skill: ConversationSkillId): boolean {
  return !["direct-answer", "safety-first"].includes(skill);
}

function hasNextStep(reply: string): boolean {
  return (
    /[?？]/u.test(reply) ||
    /\b(?:gửi giúp|bổ sung|phản hồi|xác nhận|chuyển (?:nhân viên|bộ phận liên quan)|cập nhật|tạm ngưng|nhắn lại|mua thêm|chọn|lên đơn|theo dõi)\b/iu.test(
      reply,
    )
  );
}

function shouldCheckPrice(input: EvaluateConversationQualityInput): boolean {
  if (!requiredCommerceFacts(input.baseReply).length) return false;
  return [
    "price_change",
    "price_request",
    "price_objection",
    "negotiation",
    "promotion_inquiry",
    "buying",
  ].includes(input.intent ?? "");
}

function requiredCommerceFacts(value: string): string[] {
  return [
    ...(value.match(/\d{1,3}(?:[.]\d{3})+đ/gu) ?? []),
    ...(value.match(/\b(?:miễn phí giao|freeship|free ship)\b/giu) ?? []),
  ].map(canonicalCommerce);
}

function canonicalCommerce(value: string): string {
  return value.toLocaleLowerCase("vi-VN").replace(/\s+/gu, "");
}

function hasUnsafeClaim(reply: string): boolean {
  try {
    claims.assertSafe(reply);
    return false;
  } catch {
    return true;
  }
}

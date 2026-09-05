function normalize(value: string): string {
  return value
    .toLocaleLowerCase("vi-VN")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/đ/gu, "d")
    .replace(/[^a-z0-9]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

export function isGarmentStainRemovalQuestion(value: string): boolean {
  const text = normalize(value);
  const asksCleaningMethod = /\b(?:javel|baking soda|thuoc tay|tay ao|ngam|giat tay|xu ly vet)\b/u.test(text);
  const existingGarmentStain =
    /\b(?:ao|so mi|vai|quan ao)\b.{0,55}\b(?:o vang|vet vang|vet o|bi o)\b/u.test(text) ||
    /\b(?:o vang|vet vang|vet o|bi o)\b.{0,55}\b(?:ao|so mi|vai|quan ao)\b/u.test(text);
  return asksCleaningMethod && existingGarmentStain;
}

export function isAbsurdProductRumor(value: string): boolean {
  const text = normalize(value);
  const mentionsProduct = /\b(?:stopirex|san pham|loai nay|lan nay)\b/u.test(text);
  const impossibleEffect =
    /\b(?:xanh la cay|doi (?:sang )?mau xanh|phat sang|phat quang|sang trong dem)\b/u.test(text);
  return mentionsProduct && impossibleEffect;
}

export function isThirdPartyPersonalDataRequest(value: string): boolean {
  const text = normalize(value);
  const thirdParty =
    /\b(?:nguoi ban|ban minh|ban cua (?:toi|minh|tui)|nguoi quen|dong nghiep|anh ay|chi ay|nguoi khac)\b/u.test(
      text,
    ) || /\b(?:cua|cho) (?:nguoi ban|ban minh|nguoi quen|dong nghiep|anh ay|chi ay|nguoi khac)\b/u.test(text);
  const requestsLookup =
    /\b(?:check|kiem tra|tra cuu|tim|xem)\b.{0,65}\b(?:so dien thoai|sdt|don|don hang|lich su|he thong|mua)\b/u.test(
      text,
    ) ||
    /\b(?:so dien thoai|sdt|don|don hang|lich su)\b.{0,65}\b(?:check|kiem tra|tra cuu|tim|xem)\b/u.test(text);
  return thirdParty && requestsLookup;
}

export function isNamedCompetitorDecisionQuestion(value: string): boolean {
  const text = normalize(value);
  const namesCompetitor = /\b(?:etiaxil|perspirex)\b/u.test(text);
  const asksComparison =
    /\b(?:gia|tien|mac|re hon|mac hon|khac gi|hon gi|co gi hon|tai sao (?:nen|phai) mua|vi sao (?:nen|phai) mua|\d+\s*k)\b/u.test(
      text,
    );
  return namesCompetitor && asksComparison;
}

export function isSplitShipmentQuoteRequest(value: string): boolean {
  const text = normalize(value);
  const asksShipping = /\b(?:gui|giao|ship|phi ship|phi giao)\b/u.test(text);
  const multipleDestinations =
    /\b(?:2|hai)\s+(?:noi|dia chi|don|kien)\b/u.test(text) ||
    (/\b(?:ha noi|hn)\b/u.test(text) && /\b(?:da nang|dn|sai gon|tp hcm|ho chi minh)\b/u.test(text));
  const splitQuantity =
    (text.match(/\b(?:1|mot)\s+(?:lo|hop)\b/gu)?.length ?? 0) >= 2 ||
    /\b(?:moi|moi dia chi|moi noi)\b.{0,25}\b(?:1|mot)\s+(?:lo|hop)\b/u.test(text);
  return asksShipping && multipleDestinations && splitQuantity;
}

export function isSensitiveSkinConsultationRequest(value: string): boolean {
  const text = normalize(value);
  const sensitiveSkin = /\b(?:da (?:minh )?(?:la da )?nhay cam|da nhay cam|de kich ung)\b/u.test(text);
  const symptoms = /\b(?:mo hoi|hoi nach|co mui|mui nua|mui nach)\b/u.test(text);
  const asksAdvice = /\b(?:tu van|phu hop|nen dung|dung loai|chon loai)\b/u.test(text);
  return sensitiveSkin && symptoms && asksAdvice;
}

export function isCombinedOrderUpdateAndContextRecap(value: string): boolean {
  const text = normalize(value);
  // "chốt lại" on its own is an ordinary order edit. This boundary only
  // owns turns that also explicitly ask the bot to recall consultation facts.
  const recap =
    /\b(?:tom tat|nhac lai)\b.{0,70}\b(?:tinh trang|da|mo hoi|mui|tu van)\b/u.test(text) ||
    /\b(?:tinh trang ban dau|luc dau minh bi gi|ban dau minh bi gi)\b/u.test(text);
  const orderUpdate =
    /\b(?:lay|nhan|giao|gui|chot)\b.{0,50}\b(?:[1-5]|mot|hai|ba|bon|nam)\s+(?:lo|hop)\b/u.test(text) ||
    /\b(?:[1-5]|mot|hai|ba|bon|nam)\s+(?:lo|hop)\b.{0,50}\b(?:lay|nhan|giao|gui|chot)\b/u.test(text);
  return recap && orderUpdate;
}

export function isDeterministicBoundaryTurn(value: string): boolean {
  return (
    isGarmentStainRemovalQuestion(value) ||
    isAbsurdProductRumor(value) ||
    isThirdPartyPersonalDataRequest(value) ||
    isNamedCompetitorDecisionQuestion(value) ||
    isSplitShipmentQuoteRequest(value) ||
    isSensitiveSkinConsultationRequest(value) ||
    isCombinedOrderUpdateAndContextRecap(value)
  );
}

import type { DecisionTrace } from "./conversationDecision.js";
import type { SupportedOrderQuantity } from "./conversationActions.js";
import type { OrderDraft } from "./orders.js";
import type { ClaimedSavedField } from "./propositions.js";

export function assertReplyMatchesConversationState(input: {
  reply: string;
  trace?: DecisionTrace;
  selectedQuantity?: SupportedOrderQuantity;
  orderId?: string;
  orderReceived?: boolean;
  botPaused: boolean;
  freeShippingApproved: boolean;
  orderDraft?: OrderDraft;
  claimedSavedFields?: readonly ClaimedSavedField[];
  acceptedOrderMutations?: readonly { type: string }[];
}): void {
  if (input.trace?.actionExecutionMode !== "multi_action") {
    assertDeclaredSavedFieldsCommitted(input);
    assertClaimedSavedValuesMatchState(input);
    assertOrderValuesDerivableFromState(input.reply, input.orderDraft, input.selectedQuantity);
    return;
  }
  const text = normalize(input.reply);
  const plan = input.trace.actionPlan;

  if (plan?.quantity && input.selectedQuantity !== plan.quantity) {
    throw consistencyError("selected_quantity_not_committed");
  }
  if (
    /(?:ghi nhan|ghi)\s+(?:(?:minh|anh|chi|em)\s+)?(?:(?:lay|chon|dat)\s+)?(?:1|mot)\s+lo/.test(text) &&
    input.selectedQuantity !== 1
  ) {
    throw consistencyError("reply_claims_uncommitted_quantity_1");
  }
  const claimedCombo = text.match(
    /(?:ghi nhan|ghi)\s+(?:(?:minh|anh|chi|em)\s+)?(?:(?:lay|chon|dat)\s+)?(?:combo\s+)?([2-5])\s+lo/,
  )?.[1];
  if (claimedCombo && input.selectedQuantity !== Number(claimedCombo)) {
    throw consistencyError(`reply_claims_uncommitted_quantity_${claimedCombo}`);
  }
  if (/da (?:len|tao) don thanh cong|ma van don/.test(text) && !input.orderId && !input.orderReceived) {
    throw consistencyError("reply_claims_uncommitted_order");
  }
  if (input.botPaused && /gui.*ten nguoi nhan|gui.*sdt|gui.*dia chi/.test(text)) {
    throw consistencyError("paused_bot_continues_order_collection");
  }

  assertDeclaredSavedFieldsCommitted(input);
  assertClaimedSavedValuesMatchState(input);
  assertOrderValuesDerivableFromState(input.reply, input.orderDraft, input.selectedQuantity);
}

function assertDeclaredSavedFieldsCommitted(input: {
  claimedSavedFields?: readonly ClaimedSavedField[];
  acceptedOrderMutations?: readonly { type: string }[];
}): void {
  if (!input.claimedSavedFields?.length) return;
  const mutationFields = new Set(
    (input.acceptedOrderMutations ?? []).map((mutation) => {
      if (mutation.type === "set_quantity") return "quantity";
      if (mutation.type === "set_phone") return "phone";
      if (mutation.type === "set_recipient_name") return "recipientName";
      if (mutation.type === "set_address") return "legacyAddress";
      if (mutation.type === "set_delivery_note") return "deliveryNote";
      return mutation.type;
    }),
  );
  for (const claim of input.claimedSavedFields) {
    if (!mutationFields.has(claim.field)) {
      throw consistencyError(`reply_claims_uncommitted_field_${claim.field}`);
    }
  }
}

function assertClaimedSavedValuesMatchState(input: {
  claimedSavedFields?: readonly ClaimedSavedField[];
  orderDraft?: OrderDraft;
  selectedQuantity?: SupportedOrderQuantity;
}): void {
  for (const claim of input.claimedSavedFields ?? []) {
    const committed =
      claim.field === "quantity"
        ? (input.orderDraft?.quantity ?? input.selectedQuantity)
        : input.orderDraft?.[claim.field];
    if (
      committed === undefined ||
      normalizeClaimValue(String(committed)) !== normalizeClaimValue(claim.value)
    ) {
      throw consistencyError(`reply_claimed_value_mismatch_${claim.field}`);
    }
  }
}

function assertOrderValuesDerivableFromState(
  reply: string,
  order: OrderDraft | undefined,
  selectedQuantity: SupportedOrderQuantity | undefined,
): void {
  const phones = [...reply.matchAll(/(?:sđt|sdt|số điện thoại)\s*:\s*(0\d{9})/giu)].map((match) => match[1]);
  if (phones.some((phone) => phone !== order?.phone)) {
    throw consistencyError("reply_contains_phone_not_in_committed_state");
  }
  const explicitQuantity = normalize(reply).match(
    /(?:san pham\s*:\s*stopirex\s*(?:x|×)?\s*|stopirex\s*(?:x|×)\s*)([1-5])(?:\s*lo)?/u,
  )?.[1];
  if (explicitQuantity && Number(explicitQuantity) !== (order?.quantity ?? selectedQuantity)) {
    throw consistencyError("reply_contains_quantity_not_in_committed_state");
  }
}

function consistencyError(code: string): Error {
  const error = new Error(`response_state_mismatch:${code}`);
  error.name = "ResponseStateMismatchError";
  return error;
}

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase()
    .replace(/\s+/gu, " ")
    .trim();
}

function normalizeClaimValue(value: string): string {
  return normalize(value)
    .replace(/[^a-z0-9]+/gu, " ")
    .trim();
}

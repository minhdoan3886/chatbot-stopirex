import type { DecisionTrace } from "./conversationDecision.js";
import type { SupportedOrderQuantity } from "./conversationActions.js";

export function assertReplyMatchesConversationState(input: {
  reply: string;
  trace?: DecisionTrace;
  selectedQuantity?: SupportedOrderQuantity;
  orderId?: string;
  botPaused: boolean;
  freeShippingApproved: boolean;
}): void {
  if (input.trace?.actionExecutionMode !== "multi_action") return;
  const text = normalize(input.reply);
  const plan = input.trace.actionPlan;

  if (plan?.quantity && input.selectedQuantity !== plan.quantity) {
    throw consistencyError("selected_quantity_not_committed");
  }
  if (
    /ghi nhan\s+(?:(?:minh|anh|chi|em)\s+)?(?:lay|chon|dat)\s+(?:1|mot)\s+lo/.test(text) &&
    input.selectedQuantity !== 1
  ) {
    throw consistencyError("reply_claims_uncommitted_quantity_1");
  }
  const claimedCombo = text.match(
    /ghi nhan\s+(?:(?:minh|anh|chi|em)\s+)?(?:lay|chon|dat)?\s*(?:combo\s+)?([2-5])\s+lo/,
  )?.[1];
  if (claimedCombo && input.selectedQuantity !== Number(claimedCombo)) {
    throw consistencyError(`reply_claims_uncommitted_quantity_${claimedCombo}`);
  }
  if (/da (?:len|tao) don thanh cong|ma van don/.test(text) && !input.orderId) {
    throw consistencyError("reply_claims_uncommitted_order");
  }
  if (input.botPaused && /gui.*ten nguoi nhan|gui.*sdt|gui.*dia chi/.test(text)) {
    throw consistencyError("paused_bot_continues_order_collection");
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

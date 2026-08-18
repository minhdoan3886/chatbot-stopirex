import type { PancakeAdapter, SapoAdapter } from "../integrations/contracts.js";
import type { OrderDraft } from "./orders.js";
import { assertOrderReady } from "./orders.js";

export type SagaState = {
  pancakeOrderId?: string;
  sapoOrderId?: string;
  status: "ready" | "creating" | "created" | "partial_failure";
};

export async function runOrderSaga(input: {
  idempotencyKey: string;
  draft: Required<OrderDraft>;
  productId: string;
  pancake: PancakeAdapter;
  sapo: SapoAdapter;
  prior?: SagaState;
}): Promise<SagaState> {
  assertOrderReady(input.draft);
  const state: SagaState = { ...(input.prior ?? { status: "ready" }), status: "creating" };
  if (!state.pancakeOrderId) {
    const pancake = await input.pancake.createOrder({
      idempotencyKey: input.idempotencyKey,
      draft: input.draft,
    });
    if (!pancake.ok) return { ...state, status: "partial_failure" };
    state.pancakeOrderId = pancake.value.orderId;
  }
  if (!state.sapoOrderId) {
    const sapo = await input.sapo.createOrder({
      idempotencyKey: input.idempotencyKey,
      productId: input.productId,
      draft: input.draft,
    });
    if (!sapo.ok) return { ...state, status: "partial_failure" };
    state.sapoOrderId = sapo.value.orderId;
  }
  return { ...state, status: "created" };
}

export function orderChecklist(input: {
  draftValid: boolean;
  priceVerified: boolean;
  pipelineTag: string;
  staleTagsRemoved: boolean;
  sapoOrderId?: string;
}): boolean {
  return (
    input.draftValid &&
    input.priceVerified &&
    input.pipelineTag === "6.Đã tạo đơn" &&
    input.staleTagsRemoved &&
    Boolean(input.sapoOrderId)
  );
}

export type BankAccountVersion = {
  accountNumber: string;
  accountName: string;
  bank: string;
  effectiveFrom: Date;
  effectiveTo?: Date;
};
export function activeBankAccount(
  records: readonly BankAccountVersion[],
  at = new Date(),
): BankAccountVersion {
  const active = records.filter(
    (item) => item.effectiveFrom <= at && (!item.effectiveTo || item.effectiveTo > at),
  );
  if (active.length !== 1) throw new Error("bank_account_version_conflict");
  return { ...active[0]! };
}

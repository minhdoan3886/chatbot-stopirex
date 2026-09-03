import type { SupportedOrderQuantity } from "./conversationActions.js";
import { missingOrderFields, type OrderDraft } from "./orders.js";
import type { VietnameseAddress } from "./orderNormalization.js";
import { isVietnameseMobilePhone } from "./orderNormalization.js";

type OrderMutationMetadata = {
  propositionId?: string;
  source?: "llm_extraction" | "deterministic_parser" | "facebook_profile" | "state";
  confidence?: number;
};

export type OrderMutationAction = (
  | { type: "set_quantity"; quantity: SupportedOrderQuantity; evidence: string }
  | { type: "set_phone"; phone: string; evidence: string }
  | { type: "set_recipient_name"; recipientName: string; evidence: string }
  | {
      type: "set_address";
      address: string;
      structured?: VietnameseAddress;
      operation: "replace" | "append";
      evidence: string;
    }
  | { type: "set_delivery_note"; deliveryNote: string; evidence: string }
  | { type: "confirm_order"; confirmedAt: Date; evidence: string }
) &
  OrderMutationMetadata;

export type OrderMutationRejection = {
  action: OrderMutationAction;
  reason:
    | "low_confidence"
    | "missing_evidence"
    | "invalid_phone"
    | "invalid_name"
    | "invalid_address"
    | "invalid_delivery_note";
};

export type OrderTransactionState = {
  selectedQuantity?: SupportedOrderQuantity;
  order: OrderDraft;
};

export type ExecutedOrderTransaction = {
  before: OrderTransactionState;
  after: OrderTransactionState;
  accepted: OrderMutationAction[];
  rejected: OrderMutationRejection[];
  unchanged: OrderMutationAction[];
  missingFields: Array<ReturnType<typeof missingOrderFields>[number]>;
  conflicts: string[];
  changedFields: Array<keyof OrderDraft | "selectedQuantity">;
};

export type OrderTransactionOptions = {
  sku: string;
  paymentMethod: NonNullable<OrderDraft["paymentMethod"]>;
  totalForQuantity: (quantity: SupportedOrderQuantity) => number;
};

/**
 * The only reducer allowed to commit order mutations. It is deliberately pure:
 * the response layer receives the executed transaction and cannot mutate it.
 */
export function reduceOrderTransaction(
  current: OrderTransactionState,
  proposed: readonly OrderMutationAction[],
  options: OrderTransactionOptions,
): ExecutedOrderTransaction {
  const before: OrderTransactionState = {
    ...(current.selectedQuantity ? { selectedQuantity: current.selectedQuantity } : {}),
    order: { ...current.order },
  };
  const validation = validateOrderMutations(proposed);
  const accepted = reconcileOrderMutations(validation.accepted);
  const conflicts = collectMutationConflicts(validation.accepted);
  const after: OrderTransactionState = {
    ...(current.selectedQuantity ? { selectedQuantity: current.selectedQuantity } : {}),
    order: { ...current.order },
  };
  const changedFields = new Set<keyof OrderDraft | "selectedQuantity">();

  for (const action of accepted) {
    switch (action.type) {
      case "set_quantity": {
        const nextTotal = options.totalForQuantity(action.quantity);
        if (after.selectedQuantity !== action.quantity) changedFields.add("selectedQuantity");
        if (after.order.sku !== options.sku) changedFields.add("sku");
        if (after.order.quantity !== action.quantity) changedFields.add("quantity");
        if (after.order.totalVnd !== nextTotal) changedFields.add("totalVnd");
        if (after.order.paymentMethod !== options.paymentMethod) changedFields.add("paymentMethod");
        after.selectedQuantity = action.quantity;
        after.order.sku = options.sku;
        after.order.quantity = action.quantity;
        after.order.totalVnd = nextTotal;
        after.order.paymentMethod = options.paymentMethod;
        break;
      }
      case "set_phone":
        if (after.order.phone !== action.phone) changedFields.add("phone");
        after.order.phone = action.phone;
        break;
      case "set_recipient_name":
        if (after.order.recipientName !== action.recipientName) changedFields.add("recipientName");
        after.order.recipientName = action.recipientName;
        break;
      case "set_address": {
        const nextAddress =
          action.operation === "replace"
            ? action.address
            : appendUniqueAddress(after.order.legacyAddress, action.address);
        if (after.order.legacyAddress !== nextAddress) changedFields.add("legacyAddress");
        after.order.legacyAddress = nextAddress;
        break;
      }
      case "set_delivery_note":
        if (after.order.deliveryNote !== action.deliveryNote) changedFields.add("deliveryNote");
        after.order.deliveryNote = action.deliveryNote;
        break;
      case "confirm_order":
        if (after.order.customerConfirmedAt?.getTime() !== action.confirmedAt.getTime()) {
          changedFields.add("customerConfirmedAt");
        }
        after.order.customerConfirmedAt = action.confirmedAt;
        break;
    }
  }

  assertOrderTransactionInvariant(after, accepted, options);
  const unchanged = accepted.filter((action) => !mutationChanged(action, before, after));
  return {
    before,
    after,
    accepted,
    rejected: validation.rejected,
    unchanged,
    missingFields: missingOrderFields(after.order),
    conflicts,
    changedFields: [...changedFields],
  };
}

function validateOrderMutations(actions: readonly OrderMutationAction[]): {
  accepted: OrderMutationAction[];
  rejected: OrderMutationRejection[];
} {
  const accepted: OrderMutationAction[] = [];
  const rejected: OrderMutationRejection[] = [];
  for (const action of actions) {
    if (!action.evidence.trim()) {
      rejected.push({ action, reason: "missing_evidence" });
      continue;
    }
    if (action.confidence !== undefined && action.confidence < 0.75) {
      rejected.push({ action, reason: "low_confidence" });
      continue;
    }
    if (action.type === "set_phone" && !isVietnameseMobilePhone(action.phone)) {
      rejected.push({ action, reason: "invalid_phone" });
      continue;
    }
    if (
      action.type === "set_recipient_name" &&
      (!action.recipientName.trim() || action.recipientName.length > 80 || /\d/u.test(action.recipientName))
    ) {
      rejected.push({ action, reason: "invalid_name" });
      continue;
    }
    if (action.type === "set_address" && !action.address.trim()) {
      rejected.push({ action, reason: "invalid_address" });
      continue;
    }
    if (action.type === "set_delivery_note" && !action.deliveryNote.trim()) {
      rejected.push({ action, reason: "invalid_delivery_note" });
      continue;
    }
    accepted.push(action);
  }
  return { accepted, rejected };
}

function mutationChanged(
  action: OrderMutationAction,
  before: OrderTransactionState,
  after: OrderTransactionState,
): boolean {
  switch (action.type) {
    case "set_quantity":
      return before.selectedQuantity !== after.selectedQuantity;
    case "set_phone":
      return before.order.phone !== after.order.phone;
    case "set_recipient_name":
      return before.order.recipientName !== after.order.recipientName;
    case "set_address":
      return before.order.legacyAddress !== after.order.legacyAddress;
    case "set_delivery_note":
      return before.order.deliveryNote !== after.order.deliveryNote;
    case "confirm_order":
      return before.order.customerConfirmedAt?.getTime() !== after.order.customerConfirmedAt?.getTime();
  }
}

function reconcileOrderMutations(actions: readonly OrderMutationAction[]): OrderMutationAction[] {
  const lastByField = new Map<string, OrderMutationAction>();
  for (const action of actions) {
    const key =
      action.type === "set_address" && action.operation === "append"
        ? `${action.type}:${action.address}`
        : action.type;
    lastByField.set(key, action);
  }
  return [...lastByField.values()];
}

function collectMutationConflicts(actions: readonly OrderMutationAction[]): string[] {
  const conflicts: string[] = [];
  const quantities = new Set(
    actions
      .filter(
        (action): action is Extract<OrderMutationAction, { type: "set_quantity" }> =>
          action.type === "set_quantity",
      )
      .map((action) => action.quantity),
  );
  if (quantities.size > 1) conflicts.push("multiple_quantity_values_last_write_wins");
  const replacements = new Set(
    actions
      .filter(
        (action): action is Extract<OrderMutationAction, { type: "set_address" }> =>
          action.type === "set_address" && action.operation === "replace",
      )
      .map((action) => action.address),
  );
  if (replacements.size > 1) conflicts.push("multiple_address_replacements_last_write_wins");
  return conflicts;
}

function appendUniqueAddress(existing: string | undefined, addition: string): string {
  if (!existing) return addition;
  const normalizedExisting = normalize(existing);
  const normalizedAddition = normalize(addition);
  if (normalizedExisting.includes(normalizedAddition)) return existing;
  return `${existing}, ${addition}`;
}

function assertOrderTransactionInvariant(
  state: OrderTransactionState,
  accepted: readonly OrderMutationAction[],
  options: OrderTransactionOptions,
): void {
  const quantityAction = [...accepted]
    .reverse()
    .find(
      (action): action is Extract<OrderMutationAction, { type: "set_quantity" }> =>
        action.type === "set_quantity",
    );
  if (quantityAction) {
    if (
      state.selectedQuantity !== quantityAction.quantity ||
      state.order.quantity !== quantityAction.quantity ||
      state.order.totalVnd !== options.totalForQuantity(quantityAction.quantity)
    ) {
      throw new Error("order_transaction_invariant:quantity_not_committed_atomically");
    }
  }
  if (
    state.selectedQuantity !== undefined &&
    state.order.quantity !== undefined &&
    state.selectedQuantity !== state.order.quantity
  ) {
    throw new Error("order_transaction_invariant:selected_quantity_differs_from_order");
  }
}

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase()
    .replace(/[^\p{L}\d]+/gu, " ")
    .trim();
}

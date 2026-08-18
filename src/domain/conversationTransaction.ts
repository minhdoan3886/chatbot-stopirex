import type { SupportedOrderQuantity } from "./conversationActions.js";
import type { OrderDraft } from "./orders.js";

export type OrderMutationAction =
  | { type: "set_quantity"; quantity: SupportedOrderQuantity; evidence: string }
  | { type: "set_phone"; phone: string; evidence: string }
  | { type: "set_recipient_name"; recipientName: string; evidence: string }
  | { type: "set_address"; address: string; operation: "replace" | "append"; evidence: string }
  | { type: "set_delivery_note"; deliveryNote: string; evidence: string }
  | { type: "confirm_order"; confirmedAt: Date; evidence: string };

export type OrderTransactionState = {
  selectedQuantity?: SupportedOrderQuantity;
  order: OrderDraft;
};

export type ExecutedOrderTransaction = {
  before: OrderTransactionState;
  after: OrderTransactionState;
  accepted: OrderMutationAction[];
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
  const accepted = reconcileOrderMutations(proposed);
  const conflicts = collectMutationConflicts(proposed);
  const after: OrderTransactionState = {
    ...(current.selectedQuantity ? { selectedQuantity: current.selectedQuantity } : {}),
    order: { ...current.order },
  };
  const changedFields = new Set<keyof OrderDraft | "selectedQuantity">();

  for (const action of accepted) {
    switch (action.type) {
      case "set_quantity":
        after.selectedQuantity = action.quantity;
        after.order.sku = options.sku;
        after.order.quantity = action.quantity;
        after.order.totalVnd = options.totalForQuantity(action.quantity);
        after.order.paymentMethod = options.paymentMethod;
        changedFields.add("selectedQuantity");
        changedFields.add("sku");
        changedFields.add("quantity");
        changedFields.add("totalVnd");
        changedFields.add("paymentMethod");
        break;
      case "set_phone":
        after.order.phone = action.phone;
        changedFields.add("phone");
        break;
      case "set_recipient_name":
        after.order.recipientName = action.recipientName;
        changedFields.add("recipientName");
        break;
      case "set_address":
        after.order.legacyAddress =
          action.operation === "replace"
            ? action.address
            : appendUniqueAddress(after.order.legacyAddress, action.address);
        changedFields.add("legacyAddress");
        break;
      case "set_delivery_note":
        after.order.deliveryNote = action.deliveryNote;
        changedFields.add("deliveryNote");
        break;
      case "confirm_order":
        after.order.customerConfirmedAt = action.confirmedAt;
        changedFields.add("customerConfirmedAt");
        break;
    }
  }

  assertOrderTransactionInvariant(after, accepted, options);
  return {
    before,
    after,
    accepted,
    conflicts,
    changedFields: [...changedFields],
  };
}

function reconcileOrderMutations(actions: readonly OrderMutationAction[]): OrderMutationAction[] {
  const lastByField = new Map<string, OrderMutationAction>();
  for (const action of actions) {
    const key = action.type === "set_address" && action.operation === "append" ? `${action.type}:${action.address}` : action.type;
    lastByField.set(key, action);
  }
  return [...lastByField.values()];
}

function collectMutationConflicts(actions: readonly OrderMutationAction[]): string[] {
  const conflicts: string[] = [];
  const quantities = new Set(
    actions.filter((action): action is Extract<OrderMutationAction, { type: "set_quantity" }> => action.type === "set_quantity").map((action) => action.quantity),
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

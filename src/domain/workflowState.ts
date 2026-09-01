import type { OrderDraft } from "./orders.js";

export type OrderLifecycle =
  | "idle"
  | "draft"
  | "ready_to_submit"
  | "submitted"
  | "pending_tracking"
  | "tracked"
  | "cancelled";

export type WorkflowStateEvent =
  | {
      type: "order_mutated";
      evidence: string;
      changedFields: string[];
    }
  | { type: "draft_discarded"; evidence: string }
  | { type: "order_submitted"; evidence: string }
  | { type: "tracking_pending"; evidence: string }
  | { type: "order_cancelled"; evidence: string }
  | { type: "turn_completed"; evidence: string };

export type WorkflowStateEventReceipt = WorkflowStateEvent & {
  version: number;
  orderRevision: number;
};

export type WorkflowStateMeta = {
  version: number;
  orderRevision: number;
  orderLifecycle: OrderLifecycle;
  recentEvents: WorkflowStateEventReceipt[];
};

export function initialWorkflowStateMeta(): WorkflowStateMeta {
  return {
    version: 0,
    orderRevision: 0,
    orderLifecycle: "idle",
    recentEvents: [],
  };
}

/**
 * Reducer for workflow metadata. Business state changes are committed by their
 * domain reducer first; this reducer then records one versioned receipt. UI
 * routes and response rendering are not allowed to manufacture these receipts.
 */
export function reduceWorkflowStateMeta(
  current: WorkflowStateMeta,
  event: WorkflowStateEvent,
  order: { selectedQuantity?: number; draft: OrderDraft; trackingNumber?: string },
): WorkflowStateMeta {
  const version = current.version + 1;
  const orderRevision =
    event.type === "order_mutated" ||
    event.type === "draft_discarded" ||
    event.type === "order_submitted" ||
    event.type === "order_cancelled"
      ? current.orderRevision + 1
      : current.orderRevision;
  const orderLifecycle =
    event.type === "draft_discarded"
      ? "idle"
      : event.type === "order_cancelled"
      ? "cancelled"
      : event.type === "order_submitted"
        ? "submitted"
        : event.type === "tracking_pending"
          ? "pending_tracking"
      : deriveOrderLifecycle({
          ...(order.selectedQuantity !== undefined
            ? { selectedQuantity: order.selectedQuantity }
            : {}),
          draft: order.draft,
          ...(order.trackingNumber ? { trackingNumber: order.trackingNumber } : {}),
        });
  const receipt: WorkflowStateEventReceipt = {
    ...event,
    version,
    orderRevision,
  };
  return {
    version,
    orderRevision,
    orderLifecycle,
    recentEvents: [...current.recentEvents, receipt].slice(-12),
  };
}

export function deriveOrderLifecycle(input: {
  selectedQuantity?: number;
  draft: OrderDraft;
  trackingNumber?: string;
}): OrderLifecycle {
  if (input.trackingNumber?.trim()) return "tracked";
  if (input.draft.customerConfirmedAt) return "pending_tracking";
  if (
    input.selectedQuantity &&
    input.draft.recipientName?.trim() &&
    input.draft.phone?.trim() &&
    input.draft.legacyAddress?.trim()
  ) {
    return "ready_to_submit";
  }
  if (input.selectedQuantity || Object.keys(input.draft).length > 0) return "draft";
  return "idle";
}

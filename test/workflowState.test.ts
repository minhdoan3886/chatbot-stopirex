import assert from "node:assert/strict";
import test from "node:test";
import {
  deriveOrderLifecycle,
  initialWorkflowStateMeta,
  reduceWorkflowStateMeta,
} from "../src/domain/workflowState.js";

test("order lifecycle độc lập với topic hội thoại", () => {
  const draft = { sku: "STOPIREX", quantity: 1, totalVnd: 315_000 };
  const first = reduceWorkflowStateMeta(
    initialWorkflowStateMeta(),
    { type: "order_mutated", evidence: "cho 1 lọ", changedFields: ["quantity"] },
    { selectedQuantity: 1, draft },
  );
  const afterConversationTurn = reduceWorkflowStateMeta(
    first,
    { type: "turn_completed", evidence: "hỏi cách dùng" },
    { selectedQuantity: 1, draft },
  );
  assert.equal(afterConversationTurn.orderLifecycle, "draft");
  assert.equal(afterConversationTurn.orderRevision, 1);
  assert.equal(afterConversationTurn.version, 2);
});

test("đơn xác nhận chờ vận đơn và chỉ tracked khi có mã", () => {
  const confirmedAt = new Date("2026-08-31T10:00:00.000Z");
  assert.equal(
    deriveOrderLifecycle({ selectedQuantity: 1, draft: { customerConfirmedAt: confirmedAt } }),
    "pending_tracking",
  );
  assert.equal(
    deriveOrderLifecycle({
      selectedQuantity: 1,
      draft: { customerConfirmedAt: confirmedAt },
      trackingNumber: "VTP123",
    }),
    "tracked",
  );
});

test("xóa đơn phát receipt cancelled có revision mới", () => {
  const state = reduceWorkflowStateMeta(
    initialWorkflowStateMeta(),
    { type: "order_cleared", evidence: "khách hủy" },
    { draft: {} },
  );
  assert.equal(state.orderLifecycle, "cancelled");
  assert.equal(state.orderRevision, 1);
  assert.equal(state.recentEvents[0]?.type, "order_cleared");
});


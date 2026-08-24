import assert from "node:assert/strict";
import test from "node:test";
import { assertReplyMatchesConversationState } from "../src/domain/responseConsistency.js";

const trace = {
  semantic: { confidence: 1, needsClarification: false, evidence: [] },
  ruleMatches: [],
  conflicts: [],
  selectedRoute: "direct_intent" as const,
  reason: "test",
  knowledgeEntityIds: [],
  actionExecutionMode: "multi_action" as const,
  actionPlan: {
    accepted: [],
    rejected: [],
    conflicts: [],
    answerTopics: [],
    quantity: 1 as const,
    shouldClarify: false,
    hasMultipleActions: true,
  },
};

test("response consistency chặn câu trả lời nói đã chốt nhưng state chưa lưu", () => {
  assert.throws(
    () =>
      assertReplyMatchesConversationState({
        reply: "Dạ em ghi nhận mình lấy 1 lọ ạ.",
        trace,
        botPaused: false,
        freeShippingApproved: false,
      }),
    /selected_quantity_not_committed/u,
  );
});

test("response consistency chấp nhận khi reply và state cùng số lượng", () => {
  assert.doesNotThrow(() =>
    assertReplyMatchesConversationState({
      reply: "Dạ em ghi nhận mình lấy 1 lọ ạ.",
      trace,
      selectedQuantity: 1,
      botPaused: false,
      freeShippingApproved: false,
    }),
  );
});

test("response consistency chặn cách nói em ghi 1 lọ khi state chưa lưu", () => {
  const { quantity: _quantity, ...actionPlanWithoutQuantity } = trace.actionPlan;
  assert.throws(
    () =>
      assertReplyMatchesConversationState({
        reply: "Dạ em ghi 1 lọ cho mình ạ.",
        trace: { ...trace, actionPlan: actionPlanWithoutQuantity },
        botPaused: false,
        freeShippingApproved: false,
      }),
    /reply_claims_uncommitted_quantity_1/u,
  );
});

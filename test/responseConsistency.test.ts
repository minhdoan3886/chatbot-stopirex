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
  const { quantity, ...actionPlanWithoutQuantity } = trace.actionPlan;
  void quantity;
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

test("không được khai báo đã lưu field nếu reducer chưa accept mutation", () => {
  assert.throws(
    () =>
      assertReplyMatchesConversationState({
        reply: "Dạ em đã ghi nhận SĐT 0987654321 ạ.",
        botPaused: false,
        freeShippingApproved: false,
        orderDraft: { phone: "0987654321" },
        claimedSavedFields: [{ field: "phone", value: "0987654321" }],
        acceptedOrderMutations: [],
      }),
    /reply_claims_uncommitted_field_phone/u,
  );
});

test("recap không được chứa SĐT khác post-commit state", () => {
  assert.throws(
    () =>
      assertReplyMatchesConversationState({
        reply: "SĐT: 0916420064",
        botPaused: false,
        freeShippingApproved: false,
        orderDraft: { phone: "0987654321" },
      }),
    /reply_contains_phone_not_in_committed_state/u,
  );
});

test("field đã được reducer accept và có trong state được phép xác nhận", () => {
  assert.doesNotThrow(() =>
    assertReplyMatchesConversationState({
      reply: "Dạ em đã ghi nhận SĐT 0987654321 ạ.",
      botPaused: false,
      freeShippingApproved: false,
      orderDraft: { phone: "0987654321" },
      claimedSavedFields: [{ field: "phone", value: "0987654321" }],
      acceptedOrderMutations: [{ type: "set_phone" }],
    }),
  );
});

test("claimedSavedFields không được khai giá trị khác post-commit state", () => {
  assert.throws(
    () =>
      assertReplyMatchesConversationState({
        reply: "Dạ em đã cập nhật SĐT 0916420064 ạ.",
        botPaused: false,
        freeShippingApproved: false,
        orderDraft: { phone: "0987654321" },
        claimedSavedFields: [{ field: "phone", value: "0916420064" }],
        acceptedOrderMutations: [{ type: "set_phone" }],
      }),
    /reply_claimed_value_mismatch_phone/u,
  );
});

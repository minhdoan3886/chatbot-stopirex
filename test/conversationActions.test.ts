import assert from "node:assert/strict";
import test from "node:test";
import type { SemanticUnderstanding } from "../src/domain/consultation.js";
import { reconcileConversationActions } from "../src/domain/conversationActions.js";

const semantic = (overrides: Partial<SemanticUnderstanding> = {}): SemanticUnderstanding => ({
  slots: {},
  confidence: 0.95,
  ...overrides,
});

test("hợp nhất nhiều hành động theo thứ tự trả lời rồi chọn số lượng và thu đơn", () => {
  const plan = reconcileConversationActions({
    customerMessage: "Nếu đúng như lời nói thì cho mình 1 lọ",
    semantic: semantic({
      intent: "buying",
      actions: [
        {
          type: "answer_question",
          topic: "effectiveness",
          confidence: 0.96,
          evidence: ["nếu đúng như lời nói"],
          source: "llm",
        },
        {
          type: "select_quantity",
          quantity: 1,
          confidence: 0.99,
          evidence: ["cho mình 1 lọ"],
          source: "llm",
        },
        {
          type: "continue_order_collection",
          confidence: 0.95,
          evidence: ["cho mình 1 lọ"],
          source: "llm",
        },
      ],
    }),
    exactIntent: "buying",
    optOut: false,
    collectingOrder: false,
  });

  assert.deepEqual(
    plan.accepted.map((action) => action.type),
    ["answer_question", "select_quantity", "continue_order_collection"],
  );
  assert.equal(plan.quantity, 1);
  assert.equal(plan.primaryIntent, "buying");
  assert.equal(plan.hasMultipleActions, true);
});

test("an toàn kích ứng chặn chọn số lượng trong cùng tin nhắn", () => {
  const plan = reconcileConversationActions({
    customerMessage: "Da đang rát đỏ nhưng cho mình 1 lọ",
    semantic: semantic({ intent: "safety", topic: "irritation", scenario: "actual" }),
    exactIntent: "buying",
    detectedCareIssue: "irritation",
    careScenario: "actual",
    optOut: false,
    collectingOrder: false,
  });

  assert.equal(plan.careIssue, "irritation");
  assert.equal(plan.quantity, undefined);
  assert.deepEqual(
    plan.accepted.map((action) => action.type),
    ["start_customer_care", "answer_question", "pause_order"],
  );
  assert.ok(plan.rejected.some((item) => item.reason === "safety_precedence"));
});

test("Reconciler chấp nhận số lượng 3 đến 5 lọ đã duyệt", () => {
  for (const quantity of [3, 4, 5] as const) {
    const plan = reconcileConversationActions({
      customerMessage: `Cho mình ${quantity} lọ`,
      semantic: semantic({ intent: "buying" }),
      exactIntent: "buying",
      optOut: false,
      collectingOrder: false,
    });
    assert.equal(plan.quantity, quantity);
    assert.equal(plan.accepted.some((action) => action.type === "select_quantity"), true);
  }
});

test("tự hoàn thiện đủ ba hành động khi LLM chỉ trả continue_order_collection", () => {
  const plan = reconcileConversationActions({
    customerMessage: "Nếu đúng như lời nói thì cho mình 1 lọ",
    semantic: semantic({
      intent: "buying",
      actions: [
        {
          type: "continue_order_collection",
          confidence: 0.96,
          evidence: ["cho mình 1 lọ"],
          source: "llm",
        },
      ],
    }),
    exactIntent: "buying",
    optOut: false,
    collectingOrder: false,
  });

  assert.deepEqual(
    plan.accepted.map((action) => action.type),
    ["answer_question", "select_quantity", "continue_order_collection"],
  );
  assert.equal(plan.quantity, 1);
});

test("câu điều kiện mua sửa topic LLM sai về đúng effectiveness", () => {
  const plan = reconcileConversationActions({
    customerMessage: "Nếu đúng như lời nói thì cho mình 1 lọ",
    semantic: semantic({
      intent: "buying",
      actions: [
        {
          type: "answer_question",
          topic: "other",
          confidence: 0.96,
          evidence: ["nếu đúng như lời nói"],
          source: "llm",
        },
      ],
    }),
    exactIntent: "buying",
    optOut: false,
    collectingOrder: false,
  });

  assert.deepEqual(plan.answerTopics, ["effectiveness"]);
  assert.deepEqual(
    plan.accepted.map((action) => action.type),
    ["answer_question", "select_quantity", "continue_order_collection"],
  );
});

test("tín hiệu vừa mua vừa từ chối phải hỏi lại thay vì tự chọn", () => {
  const plan = reconcileConversationActions({
    customerMessage: "Cho mình 1 lọ, nhưng thôi không mua nữa",
    semantic: semantic({ intent: "decline_purchase" }),
    exactIntent: "decline_purchase",
    optOut: false,
    collectingOrder: false,
  });

  assert.equal(plan.shouldClarify, true);
  assert.equal(plan.quantity, undefined);
  assert.ok(plan.conflicts.some((conflict) => conflict.includes("vừa có tín hiệu mua")));
});

test("không nhận số lượng do LLM suy diễn nếu không có bằng chứng trong tin khách", () => {
  const plan = reconcileConversationActions({
    customerMessage: "Mình muốn hỏi sản phẩm có đỡ mùi không?",
    semantic: semantic({
      intent: "product_effect",
      actions: [
        {
          type: "select_quantity",
          quantity: 2,
          confidence: 0.99,
          evidence: ["combo 2 lọ"],
          source: "llm",
        },
      ],
    }),
    exactIntent: "product_effect",
    optOut: false,
    collectingOrder: false,
  });

  assert.equal(plan.quantity, undefined);
  assert.ok(plan.rejected.some((item) => item.reason === "missing_evidence"));
});

test("Reconciler không mở ca kích ứng từ câu hỏi giả định về sản phẩm", () => {
  const plan = reconcileConversationActions({
    customerMessage: "Nghe nói 50% muối nhôm có bị viêm nang lông không?",
    semantic: semantic({
      intent: "authenticity_question",
      subject: "product",
      scenario: "hypothetical",
      actions: [
        {
          type: "answer_question",
          topic: "irritation",
          confidence: 0.97,
          evidence: ["có bị viêm nang lông không"],
          source: "llm",
        },
      ],
    }),
    detectedCareIssue: "irritation",
    careScenario: "hypothetical",
    optOut: false,
    collectingOrder: false,
  });

  assert.equal(plan.careIssue, undefined);
  assert.equal(plan.accepted.some((action) => action.type === "start_customer_care"), false);
  assert.equal(plan.accepted.some((action) => action.type === "answer_question"), true);
});

test("phần chưa có nguồn tự tạo handoff nhưng vẫn giữ action trả lời phần đã biết", () => {
  const plan = reconcileConversationActions({
    customerMessage: "Sáng tắm xà phòng có mất tác dụng không và có VAT không?",
    semantic: semantic({
      intent: "order_support",
      topic: "usage",
      unsupportedQuestions: ["Shop có xuất hóa đơn VAT không?"],
      actions: [
        {
          type: "answer_question",
          topic: "usage",
          confidence: 0.98,
          evidence: ["tắm xà phòng có mất tác dụng không"],
          source: "llm",
        },
      ],
    }),
    optOut: false,
    collectingOrder: false,
  });

  assert.equal(plan.accepted.some((action) => action.type === "answer_question"), true);
  assert.equal(plan.accepted.some((action) => action.type === "handoff_to_human"), true);
});

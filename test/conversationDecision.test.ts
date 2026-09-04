import assert from "node:assert/strict";
import test from "node:test";
import { resolveConversationDecision } from "../src/domain/conversationDecision.js";

test("pending action hiểu câu ok theo đề nghị ngay trước đó", () => {
  const result = resolveConversationDecision({
    semantic: {
      slots: {},
      intent: "usage_guidance",
      replyTo: "offer_usage_guidance",
      affirmation: true,
      confidence: 0.98,
    },
    pendingAction: "send_usage_guidance",
    optOut: false,
    activeCare: false,
    orderConfirmation: false,
    collectingOrder: false,
    affirmativeFollowup: true,
  });

  assert.equal(result.route, "pending_action");
  assert.equal(result.intent, "usage_guidance");
  assert.match(result.trace.reason, /đề nghị ngay trước/);
});

test("thông tin mới không bị intent usage lôi vào pending action cũ", () => {
  const result = resolveConversationDecision({
    semantic: {
      slots: { primarySymptom: "sweat", odorPresent: true },
      intent: "usage_guidance",
      topic: "odor",
      confidence: 0.92,
      needsClarification: false,
      evidence: ["mùi thì cũng có nhưng không nặng lắm"],
    },
    pendingAction: "send_usage_guidance",
    optOut: false,
    activeCare: false,
    orderConfirmation: false,
    collectingOrder: false,
    affirmativeFollowup: false,
  });

  assert.equal(result.route, "direct_intent");
  assert.equal(result.intent, "usage_guidance");
});

test("lệnh mua rõ ràng ghi đè đề nghị gửi giá đang chờ", () => {
  const result = resolveConversationDecision({
    semantic: {
      slots: {},
      intent: "buying",
      topic: "order",
      affirmation: true,
      confidence: 0.99,
    },
    pendingAction: "send_price",
    exactIntent: "buying",
    explicitPurchaseSelection: true,
    optOut: false,
    activeCare: false,
    orderConfirmation: false,
    collectingOrder: false,
    affirmativeFollowup: true,
  });

  assert.equal(result.route, "direct_intent");
  assert.equal(result.intent, "buying");
});

test("xác nhận đơn rõ ràng thắng nhãn LLM không ổn định", () => {
  const result = resolveConversationDecision({
    semantic: {
      slots: {},
      intent: "consultation",
      topic: "other",
      confidence: 0.99,
    },
    exactIntent: "buying",
    optOut: false,
    activeCare: false,
    orderConfirmation: true,
    collectingOrder: true,
    affirmativeFollowup: false,
  });

  assert.equal(result.route, "order_confirmation");
  assert.equal(result.intent, "buying");
  assert.match(result.trace.reason, /xác nhận đơn đã đủ dữ liệu/iu);
});

test("câu hỏi trực tiếp ngắt bước chọn số lượng dù LLM nhận diện đang trả lời bước đó", () => {
  const result = resolveConversationDecision({
    semantic: {
      slots: {
        primarySymptom: "sweat",
        workContext: "rest_or_stress",
      },
      intent: "product_effect",
      topic: "sweat",
      replyTo: "choose_quantity",
      asksDirectAnswer: true,
      confidence: 0.97,
      needsClarification: false,
      evidence: ["lăn cái này có tốt k", "a ra nhiều mồ hôi", "ngồi ko cũng ướt"],
    },
    pendingAction: "choose_quantity",
    optOut: false,
    activeCare: false,
    orderConfirmation: false,
    collectingOrder: true,
    orderDataCandidate: false,
    affirmativeFollowup: false,
  });

  assert.equal(result.route, "direct_intent");
  assert.equal(result.intent, "product_effect");
  assert.match(result.trace.reason, /LLM xác định rõ ý định hiện tại/);
});

test("rule thương mại chỉ hậu kiểm và không được đổi intent LLM", () => {
  const result = resolveConversationDecision({
    semantic: {
      slots: {},
      intent: "consultation",
      confidence: 0.82,
      evidence: ["freeship"],
    },
    exactIntent: "negotiation",
    optOut: false,
    activeCare: false,
    orderConfirmation: false,
    collectingOrder: false,
    affirmativeFollowup: false,
  });

  assert.equal(result.intent, "consultation");
  assert.deepEqual(result.trace.conflicts, ["rule:negotiation ≠ semantic:consultation"]);
  assert.match(result.trace.reason, /hậu kiểm/);
});

test("LLM rất chắc chắn được quyền sửa một rule mềm nhận nhầm", () => {
  const result = resolveConversationDecision({
    semantic: {
      slots: {},
      intent: "safety",
      topic: "child_age",
      subject: "child",
      confidence: 0.99,
      evidence: ["bé nhà chị", "13 tuổi"],
    },
    exactIntent: "order_support",
    optOut: false,
    activeCare: false,
    orderConfirmation: false,
    collectingOrder: false,
    affirmativeFollowup: false,
  });

  assert.equal(result.intent, "safety");
  assert.match(result.trace.reason, /hậu kiểm/);
});

test("LLM là bộ định tuyến chính với rule từ khóa không thuộc guardrail", () => {
  const result = resolveConversationDecision({
    semantic: {
      slots: {},
      intent: "product_comparison",
      topic: "comparison",
      confidence: 0.99,
      evidence: ["khác gì", "lăn truyền thống"],
    },
    exactIntent: "product_effect",
    optOut: false,
    activeCare: false,
    orderConfirmation: false,
    collectingOrder: false,
    affirmativeFollowup: false,
  });

  assert.equal(result.route, "direct_intent");
  assert.equal(result.intent, "product_comparison");
  assert.match(result.trace.reason, /định tuyến chính/);
});

test("state nghi là dữ liệu đơn không được đè intent LLM hiện tại", () => {
  const result = resolveConversationDecision({
    semantic: {
      slots: {},
      intent: "consultation",
      confidence: 0.99,
    },
    exactIntent: "consultation",
    optOut: false,
    activeCare: false,
    orderConfirmation: false,
    collectingOrder: true,
    orderDataCandidate: true,
    affirmativeFollowup: false,
  });

  assert.equal(result.route, "direct_intent");
  assert.equal(result.intent, "consultation");
});

test("đơn đang dở không được biến tin không rõ thành dữ liệu đơn", () => {
  const result = resolveConversationDecision({
    semantic: {
      slots: {},
      confidence: 0,
    },
    optOut: false,
    activeCare: false,
    orderConfirmation: false,
    collectingOrder: true,
    orderDataCandidate: false,
    affirmativeFollowup: false,
  });

  assert.equal(result.route, "clarification");
  assert.equal(result.intent, undefined);
  assert.match(result.trace.reason, /không có bằng chứng là dữ liệu đơn/);
});

test("câu hỏi mặc cả do LLM nhận diện được ngắt bước thu đơn", () => {
  const result = resolveConversationDecision({
    semantic: {
      slots: {},
      intent: "negotiation",
      confidence: 0.99,
    },
    exactIntent: "order_support",
    optOut: false,
    activeCare: false,
    orderConfirmation: false,
    collectingOrder: true,
    orderDataCandidate: false,
    affirmativeFollowup: false,
  });

  assert.equal(result.route, "direct_intent");
  assert.equal(result.intent, "negotiation");
});

test("câu giả định có chữ bị rát không được mở ca kích ứng", () => {
  const result = resolveConversationDecision({
    semantic: {
      slots: {},
      intent: "safety",
      topic: "irritation",
      scenario: "hypothetical",
      confidence: 0.98,
    },
    exactIntent: "safety",
    careIssue: "irritation",
    careScenario: "hypothetical",
    optOut: false,
    activeCare: false,
    orderConfirmation: false,
    collectingOrder: false,
    affirmativeFollowup: false,
  });

  assert.equal(result.route, "direct_intent");
  assert.equal(result.intent, "safety");
  assert.equal(result.trace.semantic.scenario, "hypothetical");
});

test("kích ứng đang xảy ra thật vẫn mở flow CSKH", () => {
  const result = resolveConversationDecision({
    semantic: {
      slots: {},
      intent: "safety",
      topic: "irritation",
      scenario: "actual",
      confidence: 0.99,
    },
    exactIntent: "safety",
    careIssue: "irritation",
    careScenario: "actual",
    optOut: false,
    activeCare: false,
    orderConfirmation: false,
    collectingOrder: false,
    affirmativeFollowup: false,
  });

  assert.equal(result.route, "start_care");
  assert.equal(result.careIssue, "irritation");
});

test("câu hỏi trực tiếp mới được tạm ngắt phiên CSKH đang hoạt động", () => {
  const result = resolveConversationDecision({
    semantic: {
      slots: {},
      intent: "product_effect",
      topic: "effectiveness",
      confidence: 0.99,
      asksDirectAnswer: true,
    },
    exactIntent: "product_effect",
    optOut: false,
    activeCare: true,
    interruptActiveCare: true,
    orderConfirmation: false,
    collectingOrder: false,
    affirmativeFollowup: false,
  });

  assert.equal(result.route, "direct_intent");
  assert.equal(result.intent, "product_effect");
  assert.ok(
    result.trace.ruleMatches.some((item) => item.id === "active_care_interrupted_by_direct_question"),
  );
});

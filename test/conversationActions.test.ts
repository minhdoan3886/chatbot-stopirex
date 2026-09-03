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

test("hai proposition FAQ cùng topic vẫn được giữ độc lập theo propositionId", () => {
  const plan = reconcileConversationActions({
    customerMessage: "ship dc q1 sg khum shop? free shp k b?",
    semantic: semantic({
      intent: "buying",
      topic: "shipping",
      asksDirectAnswer: true,
      actions: [
        {
          type: "answer_question",
          topic: "shipping",
          confidence: 0.99,
          evidence: ["ship dc q1 sg khum shop?"],
          source: "llm",
          propositionId: "p-delivery",
          target: "delivery.availability",
        },
        {
          type: "answer_question",
          topic: "shipping",
          confidence: 0.99,
          evidence: ["free shp k b?"],
          source: "llm",
          propositionId: "p-fee",
          target: "delivery.fee",
        },
      ],
    }),
    optOut: false,
    collectingOrder: true,
  });
  assert.equal(plan.accepted.filter((action) => action.type === "answer_question").length, 2);
  assert.deepEqual(
    plan.accepted
      .filter((action) => action.type === "answer_question")
      .map((action) => action.propositionId),
    ["p-delivery", "p-fee"],
  );
});

test("FAQ proposition không tự tạo mutation đơn hàng", () => {
  const plan = reconcileConversationActions({
    customerMessage: "nhan hag dc kjem tra k b?",
    semantic: semantic({
      intent: "order_support",
      topic: "order",
      asksDirectAnswer: true,
      actions: [
        {
          type: "answer_question",
          topic: "order",
          confidence: 0.99,
          evidence: ["nhan hag dc kjem tra k b?"],
          source: "llm",
          propositionId: "p-inspection",
        },
      ],
    }),
    optOut: false,
    collectingOrder: true,
  });
  assert.equal(plan.accepted.some((action) => action.type === "update_order"), false);
});

test("LLM được sửa số lượng đơn dù cùng câu còn hỏi tổng tiền và địa chỉ giao", () => {
  const message =
    "Thôi lấy cho anh 1 lọ thôi. Sđt anh là 0988777666. Em đọc lại xem chốt mấy lọ, tiền bao nhiêu, ship về đâu.";
  const plan = reconcileConversationActions({
    customerMessage: message,
    semantic: semantic({
      intent: "buying",
      topic: "order",
      evidence: ["Thôi lấy cho anh 1 lọ thôi"],
      actions: [
        {
          type: "select_quantity",
          quantity: 1,
          confidence: 0.99,
          evidence: ["Thôi lấy cho anh 1 lọ thôi"],
          source: "llm",
        },
        {
          type: "continue_order_collection",
          confidence: 0.99,
          evidence: ["Thôi lấy cho anh 1 lọ thôi"],
          source: "llm",
        },
      ],
    }),
    optOut: false,
    collectingOrder: true,
  });

  assert.equal(plan.quantity, 1);
  assert.equal(plan.primaryIntent, "buying");
  assert.equal(
    plan.rejected.some(
      ({ action, reason }) => action.type === "select_quantity" && reason === "policy_verification_required",
    ),
    false,
  );
});

test("fallback vẫn hiểu lệnh sửa tự nhiên 'lấy cho anh 1 lọ' trong câu recap", () => {
  const message =
    "Thôi lấy cho anh 1 lọ thôi. Sđt anh là 0988777666. Em đọc lại xem chốt mấy lọ, tiền bao nhiêu, ship về đâu.";
  const plan = reconcileConversationActions({
    customerMessage: message,
    semantic: { slots: {}, status: "fallback" },
    optOut: false,
    collectingOrder: true,
  });

  assert.equal(plan.quantity, 1);
  assert.ok(plan.accepted.some((action) => action.type === "select_quantity"));
  assert.equal(
    plan.rejected.some(
      ({ action, reason }) => action.type === "select_quantity" && reason === "policy_verification_required",
    ),
    false,
  );
});

test("fallback không biến câu hỏi giả định một lọ thành lệnh sửa đơn", () => {
  const plan = reconcileConversationActions({
    customerMessage: "Nếu lấy 1 lọ thì tổng tiền và phí ship bao nhiêu?",
    semantic: { slots: {}, status: "fallback" },
    optOut: false,
    collectingOrder: true,
  });

  assert.equal(plan.quantity, undefined);
  assert.equal(plan.accepted.some((action) => action.type === "select_quantity"), false);
});

test("bổ sung chủ đề chính bị thiếu khi LLM mới tạo answer action cho ý còn lại", () => {
  const plan = reconcileConversationActions({
    customerMessage:
      "Là loại này giống lăn khử mùi nhưng nó giúp giảm ra mồ hôi à bạn\n1 ngày chỉ lăn 1 lần ạ",
    semantic: semantic({
      intent: "usage_guidance",
      topic: "usage",
      asksDirectAnswer: true,
      actions: [
        {
          type: "answer_question",
          topic: "comparison",
          confidence: 0.97,
          evidence: ["giống lăn khử mùi", "giúp giảm ra mồ hôi"],
          source: "llm",
        },
      ],
    }),
    optOut: false,
    collectingOrder: false,
  });

  assert.deepEqual(plan.answerTopics, ["comparison", "usage"]);
  assert.equal(plan.hasMultipleActions, true);
});

test("batch không cho fallback regex tự thêm topic khi LLM đã đủ quyền", () => {
  const plan = reconcileConversationActions({
    customerMessage:
      "Là loại này giống lăn khử mùi nhưng nó giúp giảm ra mồ hôi à bạn\n1 ngày chỉ lăn 1 lần ạ",
    semantic: semantic({
      intent: "product_comparison",
      topic: "comparison",
      asksDirectAnswer: true,
      actions: [
        {
          type: "answer_question",
          topic: "comparison",
          confidence: 0.97,
          evidence: ["giống lăn khử mùi", "giúp giảm ra mồ hôi"],
          source: "llm",
        },
      ],
    }),
    optOut: false,
    collectingOrder: false,
  });

  assert.deepEqual(plan.answerTopics, ["comparison"]);
  assert.equal(plan.hasMultipleActions, false);
  assert.equal(plan.accepted.some((action) => action.source === "state"), false);
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

test("Reconciler hiểu chữ a viết tắt trong lệnh cho a 1 lọ", () => {
  const plan = reconcileConversationActions({
    customerMessage: "thế cho a 1 lọ đi",
    semantic: semantic({ intent: "buying", topic: "order", confidence: 0.99 }),
    optOut: false,
    collectingOrder: false,
  });

  assert.equal(plan.quantity, 1);
  assert.ok(plan.accepted.some((action) => action.type === "select_quantity"));
  assert.ok(plan.accepted.some((action) => action.type === "continue_order_collection"));
});

test("LLM được quyền hiểu tiếng địa phương và lỗi chính tả khi evidence có nguyên văn", () => {
  const plan = reconcileConversationActions({
    customerMessage: "chốt giùm tui mọt chai nghen",
    semantic: semantic({
      intent: "buying",
      confidence: 0.98,
      needsClarification: true,
      actions: [
        {
          type: "select_quantity",
          quantity: 1,
          confidence: 0.98,
          evidence: ["chốt giùm tui mọt chai nghen"],
          source: "llm",
        },
        {
          type: "continue_order_collection",
          confidence: 0.97,
          evidence: ["chốt giùm tui mọt chai nghen"],
          source: "llm",
        },
      ],
    }),
    optOut: false,
    collectingOrder: false,
  });

  assert.equal(plan.quantity, 1);
  assert.equal(plan.primaryIntent, "buying");
  assert.equal(plan.shouldClarify, false);
  assert.deepEqual(
    plan.accepted.map((action) => action.type),
    ["select_quantity", "continue_order_collection"],
  );
});

test("LLM không được tạo đơn khi evidence không nằm trong lời khách", () => {
  const plan = reconcileConversationActions({
    customerMessage: "Tư vấn giúp mình loại nào hợp",
    semantic: semantic({
      intent: "buying",
      confidence: 0.99,
      actions: [
        {
          type: "select_quantity",
          quantity: 2,
          confidence: 0.99,
          evidence: ["chốt combo 2 lọ"],
          source: "llm",
        },
        {
          type: "continue_order_collection",
          confidence: 0.99,
          evidence: ["chốt combo 2 lọ"],
          source: "llm",
        },
      ],
    }),
    optOut: false,
    collectingOrder: false,
  });

  assert.equal(plan.quantity, undefined);
  assert.equal(plan.accepted.some((action) => action.type === "continue_order_collection"), false);
  assert.ok(plan.rejected.some((item) => item.reason === "missing_evidence"));
  assert.ok(plan.rejected.some((item) => item.reason === "policy_verification_required"));
});

test("tiếng địa phương vừa chốt vừa phủ định vẫn phải hỏi lại", () => {
  const message = "chốt giùm tui mọt chai, mà thui hông lấy nữa";
  const plan = reconcileConversationActions({
    customerMessage: message,
    semantic: semantic({
      intent: "decline_purchase",
      confidence: 0.98,
      actions: [
        {
          type: "select_quantity",
          quantity: 1,
          confidence: 0.97,
          evidence: ["chốt giùm tui mọt chai"],
          source: "llm",
        },
        {
          type: "decline_purchase",
          confidence: 0.99,
          evidence: ["thui hông lấy nữa"],
          source: "llm",
        },
      ],
    }),
    optOut: false,
    collectingOrder: false,
  });

  assert.equal(plan.quantity, undefined);
  assert.equal(plan.shouldClarify, true);
  assert.ok(plan.conflicts.some((conflict) => conflict.includes("vừa có tín hiệu mua")));
});

test("safety guard vẫn chặn lệnh mua địa phương khi khách đang kích ứng", () => {
  const message = "da tui đang đỏ rát, chốt giùm tui mọt chai nghen";
  const plan = reconcileConversationActions({
    customerMessage: message,
    semantic: semantic({
      intent: "buying",
      scenario: "actual",
      confidence: 0.98,
      actions: [
        {
          type: "select_quantity",
          quantity: 1,
          confidence: 0.98,
          evidence: ["chốt giùm tui mọt chai nghen"],
          source: "llm",
        },
      ],
    }),
    detectedCareIssue: "irritation",
    careScenario: "actual",
    optOut: false,
    collectingOrder: false,
  });

  assert.equal(plan.quantity, undefined);
  assert.equal(plan.careIssue, "irritation");
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

test("ý từ chối cuối cùng của LLM thắng state mua cũ khi không có action mâu thuẫn", () => {
  const plan = reconcileConversationActions({
    customerMessage: "Cho mình 1 lọ, nhưng thôi không mua nữa",
    semantic: semantic({ intent: "decline_purchase" }),
    exactIntent: "decline_purchase",
    optOut: false,
    collectingOrder: false,
  });

  assert.equal(plan.shouldClarify, false);
  assert.equal(plan.quantity, undefined);
  assert.equal(plan.primaryIntent, "decline_purchase");
  assert.equal(plan.conflicts.some((conflict) => conflict.includes("vừa có tín hiệu mua")), false);
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

test("Reconciler loại action mở CSKH do LLM đề xuất khi khách nói rõ chưa dùng", () => {
  const plan = reconcileConversationActions({
    customerMessage: "Da mình khá nhạy cảm, chưa dùng nhưng sợ bị rát thì dùng thế nào cho an toàn?",
    semantic: semantic({
      intent: "safety",
      topic: "irritation",
      scenario: "actual",
      actions: [
        {
          type: "start_customer_care",
          issue: "irritation",
          confidence: 0.98,
          evidence: ["sợ bị rát"],
          source: "llm",
        },
        {
          type: "answer_question",
          topic: "irritation",
          confidence: 0.98,
          evidence: ["dùng thế nào cho an toàn"],
          source: "llm",
        },
      ],
    }),
    exactIntent: "safety",
    detectedCareIssue: "irritation",
    careScenario: "hypothetical",
    optOut: false,
    collectingOrder: true,
  });

  assert.equal(plan.careIssue, undefined);
  assert.equal(plan.accepted.some((action) => action.type === "start_customer_care"), false);
  assert.equal(plan.accepted.some((action) => action.type === "answer_question"), true);
  assert.equal(plan.accepted.some((action) => action.type === "pause_order"), true);
  assert.ok(plan.rejected.some((item) => item.reason === "non_current_care_scenario"));
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

test("handoff after-sales có căn cứ được hoàn tất thành action khiếu nại", () => {
  const message = "Giao lâu thế? Hủy đi, bôi bị bết dính ở vùng nách, làm ăn lôm côm!";
  const plan = reconcileConversationActions({
    customerMessage: message,
    semantic: semantic({
      skill: "after-sales-care",
      topic: "delivery",
      subject: "order",
      scenario: "actual",
      asksDirectAnswer: true,
      actions: [
        {
          type: "handoff_to_human",
          confidence: 0.96,
          evidence: ["Hủy đi", "bôi bị bết dính ở vùng nách"],
          source: "llm",
          reason: "Khách muốn hủy và phản ánh bôi bị bết dính cần kiểm tra",
        },
      ],
    }),
    optOut: false,
    collectingOrder: false,
  });

  assert.equal(plan.careIssue, "complaint");
  assert.equal(
    plan.accepted.find((action) => action.type === "start_customer_care")?.source,
    "state",
  );
  assert.equal(plan.primaryIntent, "order_support");
});

test("update_order chỉ giữ trường LLM trích đúng nguyên văn và loại SĐT thiếu số", () => {
  const plan = reconcileConversationActions({
    customerMessage: "ntt15 82 Nguyễn Tuân Hà Nội 022299933 Luffi",
    semantic: semantic({
      intent: "order_support",
      actions: [
        {
          type: "update_order",
          fields: {
            legacyAddress: "ntt15 82 Nguyễn Tuân Hà Nội",
            phone: "022299933",
            recipientName: "Luffi",
          },
          confidence: 0.98,
          evidence: ["ntt15 82 Nguyễn Tuân Hà Nội", "022299933", "Luffi"],
          source: "llm",
        },
      ],
    }),
    optOut: false,
    collectingOrder: true,
  });

  const update = plan.accepted.find((action) => action.type === "update_order");
  assert.deepEqual(update?.fields, {
    legacyAddress: "ntt15 82 Nguyễn Tuân Hà Nội",
    recipientName: "Luffi",
  });
});

test("update_order không nhận dữ liệu LLM tự suy diễn ngoài tin khách", () => {
  const plan = reconcileConversationActions({
    customerMessage: "Mình gửi thông tin sau nhé",
    semantic: semantic({
      intent: "order_support",
      actions: [
        {
          type: "update_order",
          fields: {
            recipientName: "Nguyễn Văn A",
            phone: "0912345678",
            legacyAddress: "82 Nguyễn Tuân, Hà Nội",
          },
          confidence: 0.99,
          evidence: ["thông tin sau"],
          source: "llm",
        },
      ],
    }),
    optOut: false,
    collectingOrder: true,
  });

  assert.equal(plan.accepted.some((action) => action.type === "update_order"), false);
  assert.ok(plan.rejected.some((item) => item.reason === "invalid_order_update"));
});

test("LLM chặn action thu đơn cũ khi lượt mới quay sang hỏi tư vấn", () => {
  const message = "Mình vận động nhiều và bị ra mồ hôi hơn 20 năm rồi";
  const plan = reconcileConversationActions({
    customerMessage: message,
    semantic: semantic({
      intent: "consultation",
      topic: "effectiveness",
      asksDirectAnswer: true,
      confidence: 0.99,
      evidence: ["vận động nhiều", "ra mồ hôi hơn 20 năm"],
      actions: [
        {
          type: "answer_question",
          topic: "effectiveness",
          confidence: 0.99,
          evidence: ["ra mồ hôi hơn 20 năm"],
          source: "llm",
        },
        // Mô phỏng action tồn dư từ worker/state cũ đang giữ combo 2.
        {
          type: "continue_order_collection",
          confidence: 0.99,
          evidence: ["vận động nhiều"],
          source: "state",
        },
      ],
    }),
    optOut: false,
    collectingOrder: true,
  });

  assert.equal(plan.primaryIntent, "consultation");
  assert.equal(plan.accepted.some((action) => action.type === "continue_order_collection"), false);
  assert.ok(
    plan.rejected.some(
      ({ action, reason }) =>
        action.type === "continue_order_collection" && reason === "llm_authority_conflict",
    ),
  );
});

test("proposition có evidence được commit dù primary intent là câu hỏi khác", () => {
  const plan = reconcileConversationActions({
    customerMessage: "2 lọ bao nhiêu, ship Hà Nội mấy ngày? Nếu được thì lấy cho chị 2 lọ",
    semantic: {
      slots: {},
      status: "interpreted",
      intent: "price_request",
      confidence: 0.98,
      actions: [
        {
          type: "answer_question",
          topic: "price",
          confidence: 0.99,
          evidence: ["2 lọ bao nhiêu"],
          source: "llm",
        },
        {
          type: "answer_question",
          topic: "delivery",
          confidence: 0.99,
          evidence: ["ship Hà Nội mấy ngày"],
          source: "llm",
        },
        {
          type: "select_quantity",
          quantity: 2,
          confidence: 0.99,
          evidence: ["lấy cho chị 2 lọ"],
          source: "llm",
        },
        {
          type: "continue_order_collection",
          confidence: 0.99,
          evidence: ["lấy cho chị 2 lọ"],
          source: "llm",
        },
      ],
      evidence: ["lấy cho chị 2 lọ"],
    },
    optOut: false,
    collectingOrder: false,
  });

  assert.ok(plan.accepted.some((action) => action.type === "select_quantity"));
  assert.ok(plan.accepted.some((action) => action.type === "continue_order_collection"));
  assert.deepEqual(plan.answerTopics.sort(), ["delivery", "price"]);
});

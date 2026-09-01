import assert from "node:assert/strict";
import test from "node:test";
import {
  allowedConversationCtas,
  assertRequiredResponseFactsPresent,
  assertSelectedCtaAllowed,
  buildWorkflowResponseContract,
  extractRequiredResponseFacts,
} from "../src/domain/responseContract.js";

test("workflow vẫn cấp CTA hội thoại khi đơn cũ đang tạm dở", () => {
  const ids = allowedConversationCtas({
    mode: "sales",
    botPaused: false,
    selectedQuantity: 1,
    orderMissing: ["phone"],
  }).map((item) => item.id);
  assert.ok(ids.includes("offer_usage_guidance"));
  assert.ok(ids.includes("ask_phone"));
  assert.ok(ids.includes("none"));
});

test("CTA phải do workflow cấp và phải nằm trong câu trả lời LLM", () => {
  assert.throws(
    () =>
      assertSelectedCtaAllowed(
        {
          slots: {},
          intent: "order_support",
          selectedCtaId: "ask_primary_symptom",
          ctaText: "Mình khó chịu vì mồ hôi hay mùi ạ?",
          draftReply: "Mình khó chịu vì mồ hôi hay mùi ạ?",
        },
        allowedConversationCtas({
          mode: "sales",
          botPaused: false,
          selectedQuantity: 1,
          orderMissing: ["phone"],
        }),
      ),
    /không phù hợp intent/u,
  );
});

test("phản đối giá được phép chọn CTA hỏi bối cảnh công việc", () => {
  const ctaText = "Tình trạng này rõ nhất khi mình vận động, trời nóng hay căng thẳng ạ?";
  assert.doesNotThrow(() =>
    assertSelectedCtaAllowed(
      {
        slots: {},
        intent: "price_objection",
        selectedCtaId: "ask_work_context",
        ctaText,
        draftReply: `Dạ em hiểu mình đang cân nhắc về giá. ${ctaText}`,
      },
      allowedConversationCtas({
        mode: "sales",
        botPaused: false,
        orderMissing: [],
      }),
    ),
  );
});

test("required facts giữ dữ kiện nhưng cho phép đổi lời dẫn linh hoạt", () => {
  const facts = extractRequiredResponseFacts(
    "Combo 2 lọ: 510.000đ, miễn phí giao. Quà tặng: 1 túi. Dùng 2–3 lần/tuần.",
  );
  assert.doesNotThrow(() =>
    assertRequiredResponseFactsPresent(
      facts,
      "Mình lấy combo 2 lọ giá 510.000đ, được freeship và tặng 1 túi. Tần suất là 2 đến 3 lần mỗi tuần.",
    ),
  );
  assert.throws(
    () => assertRequiredResponseFactsPresent(facts, "Combo 2 lọ giá 510.000đ."),
    /Thiếu required fact/u,
  );
});

test("response contract tách fact bắt buộc khỏi phần lời văn LLM được quyền diễn đạt", () => {
  const contract = buildWorkflowResponseContract({
    state: {
      mode: "sales",
      botPaused: false,
      selectedQuantity: 2,
      orderMissing: ["phone"],
    },
    authoritativeReply: "Combo 2 lọ: 510.000đ, miễn phí giao. Quà tặng: 1 túi.",
  });
  assert.ok(contract.requiredFacts.some((fact) => fact.kind === "money"));
  assert.ok(contract.requiredFacts.some((fact) => fact.kind === "shipping"));
  assert.ok(contract.requiredFacts.some((fact) => fact.kind === "gift"));
  assert.ok(contract.allowedCtas.some((cta) => cta.id === "ask_phone"));
  assert.deepEqual(contract.flexibleSections, ["opening", "explanation", "transition", "cta"]);
});

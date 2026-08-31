import assert from "node:assert/strict";
import test from "node:test";
import {
  allowedConversationCtas,
  assertRequiredResponseFactsPresent,
  assertSelectedCtaAllowed,
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

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
  assert.deepEqual(contract.factPolicy.mustIncludeFacts, contract.requiredFacts);
  assert.deepEqual(contract.ctaPolicy.preferred, ["ask_phone", "none"]);
  assert.ok(contract.ctaPolicy.forbidden.includes("ask_quantity"));
  assert.deepEqual(contract.ctaPolicy.requestedSlots, ["phone"]);
  assert.deepEqual(contract.flexibleSections, ["opening", "explanation", "transition", "cta"]);
});

test("báo giá chung lấy canonical 1–3 lọ, combo Body Wash và không ép 4–5 lọ", () => {
  const canonicalFacts = [
    ["price.stopirex.1_unit", "price", 285000, "1 lọ 285.000đ"],
    ["price.stopirex.2_units", "price", 510000, "Combo 2 lọ 510.000đ"],
    ["price.stopirex.3_units", "price", 750000, "Combo 3 lọ 750.000đ"],
    ["price.stopirex.4_units", "price", 1000000, "Combo 4 lọ 1.000.000đ"],
    ["price.stopirex.5_units", "price", 1250000, "Combo 5 lọ 1.250.000đ"],
    ["price.stopirex.bodywash_bundle", "price", 525000, "Combo Body Wash 525.000đ"],
    ["gift.stopirex.order", "gift", "1 túi", "Đơn từ 2 lọ được tặng 1 túi"],
    ["claim:bodywash", "claim", "not_sold", "Herbal Body Wash hiện chưa bán lẻ."],
  ].map(([key, kind, value, text], index) => ({
    id: `fact-${index}`,
    key: String(key),
    kind: kind as "price" | "gift" | "claim",
    value: value as string | number,
    text: String(text),
    sourceId: "pricing",
    sourceVersion: "v1",
    priority: 1,
    applicable: true as const,
    applicabilityReason: "test",
    confidence: 1,
  }));
  const contract = buildWorkflowResponseContract({
    state: { mode: "sales", botPaused: false, orderMissing: [] },
    customerMessage: "cho mình giá hiện tại",
    authoritativeReply: "workflow prose must not define product facts",
    canonicalFacts,
  });
  const money = contract.requiredFacts.filter((fact) => fact.kind === "money").map((fact) => fact.text);
  assert.deepEqual(money, ["285.000đ", "510.000đ", "750.000đ", "525.000đ"]);
  assert.ok(contract.requiredFacts.some((fact) => fact.kind === "gift"));
  assert.ok(contract.requiredFacts.some((fact) => fact.kind === "claim"));
  assert.ok(!money.includes("1.000.000đ"));
  assert.ok(!money.includes("1.250.000đ"));
});

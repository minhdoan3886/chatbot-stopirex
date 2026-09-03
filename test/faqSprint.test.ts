import assert from "node:assert/strict";
import test from "node:test";
import { DemoChatService, isOrderCaptureMessage } from "../src/services/demoChat.js";

test("hỏi giá và freeship theo 1/2 lọ không bị hiểu là chốt mua", () => {
  const chat = new DemoChatService();
  const result = chat.chat(
    "faq-price-shipping-policy",
    "Lọ lăn này giá rổ thế nào shop ơi? Mua 1 lọ có được freeship không hay phải mua 2?",
    {
      intent: "buying",
      topic: "shipping",
      asksDirectAnswer: true,
      confidence: 0.98,
      actions: [
        {
          type: "answer_question",
          topic: "price",
          source: "llm",
          confidence: 0.98,
          evidence: ["giá rổ thế nào"],
        },
        {
          type: "select_quantity",
          quantity: 1,
          source: "llm",
          confidence: 0.98,
          evidence: ["mua 1 lọ"],
        },
      ],
      slots: {},
    },
  );

  assert.equal(result.state.lastIntent, "price_request");
  assert.equal(result.state.selectedQuantity, undefined);
  assert.equal(result.state.orderFlowStatus, "idle");
  assert.match(result.reply, /1 lọ giá 285\.000đ.*30\.000đ.*2 lọ 510\.000đ.*miễn phí giao/isu);
  assert.ok(result.state.decisionTrace?.knowledgeEntityIds.includes("pricing-approved-options-2026-08"));
});

test("câu hỏi ETA và kiểm hàng nội địa dùng route logistics, không rơi về bảng giá", () => {
  const chat = new DemoChatService();
  const result = chat.chat(
    "faq-domestic-logistics",
    "Mình ở Đà Nẵng thì đặt mấy ngày nhận được? Lúc shipper giao tới có được bóc ra xem hàng không?",
    {
      intent: "price_request",
      topic: "price",
      asksDirectAnswer: true,
      confidence: 0.95,
      actions: [
        {
          type: "answer_question",
          topic: "delivery",
          source: "llm",
          confidence: 0.98,
          evidence: ["mấy ngày nhận được", "bóc ra xem hàng"],
        },
      ],
      slots: {},
    },
  );

  assert.equal(result.state.lastIntent, "order_support");
  assert.match(result.reply, /nội thành.*1–2 ngày.*nội miền.*2–3 ngày.*liên miền.*3–5 ngày/isu);
  assert.match(result.reply, /kiểm tra bao bì.*không mở seal/isu);
  assert.doesNotMatch(result.reply, /285\.000|510\.000/u);
  assert.ok(result.state.decisionTrace?.knowledgeEntityIds.includes("domestic-delivery-inspection-policy"));
});

test("lộ trình hiệu quả trả đủ tuần đầu, 72 giờ, duy trì và không vĩnh viễn", () => {
  const chat = new DemoChatService();
  const result = chat.chat(
    "faq-effectiveness-journey",
    "Mình hay ra mồ hôi ướt sũng áo, dùng cái này bao lâu thì khô ráo hẳn? Dùng 1 lọ là khỏi vĩnh viễn không bao giờ bị lại đúng không?",
    {
      intent: "product_effect",
      topic: "effectiveness",
      asksDirectAnswer: true,
      confidence: 0.99,
      actions: [
        {
          type: "answer_question",
          topic: "effectiveness",
          source: "llm",
          confidence: 0.99,
          evidence: ["bao lâu thì khô ráo", "khỏi vĩnh viễn"],
        },
      ],
      knowledgeIds: ["effectiveness-usage-journey", "product-training-72h-conditional-claim"],
      groundingConfidence: 0.99,
      slots: { primarySymptom: "sweat" },
    },
  );

  assert.match(result.reply, /tuần đầu.*72 giờ.*2–3 lần\/tuần.*2–3 ngày\/lần.*không phải.*vĩnh viễn/isu);
  assert.ok(result.state.decisionTrace?.knowledgeEntityIds.includes("effectiveness-usage-journey"));
});

test("khách từng ngứa đỏ với loại khác không bị suy diễn thành viêm hoặc không hiệu quả", () => {
  const chat = new DemoChatService();
  const result = chat.chat(
    "faq-sensitive-no-inference",
    "Da mình nhạy cảm lắm, bôi mấy loại đặc trị kia toàn bị ngứa gãi đỏ cả nách. Loại này có êm không?",
  );

  assert.match(result.reply, /ngứa và đỏ da/iu);
  assert.doesNotMatch(result.reply, /gây viêm|không duy trì hiệu quả/iu);
});

test("LLM lỗi vẫn trả đúng tuổi 14 từ Knowledge, không handoff bừa", () => {
  const chat = new DemoChatService();
  const result = chat.chat(
    "faq-child-age-llm-timeout",
    "Bé nhà mình 14 tuổi đang tuổi dậy thì mùi mồ hôi hơi nặng, có bôi được lăn này chưa hay nặng đô quá?",
    {
      status: "unavailable",
      slots: {},
    },
  );

  assert.equal(result.state.lastIntent, "safety");
  assert.match(result.reply, /bé 14 tuổi dùng được/iu);
  assert.doesNotMatch(result.reply, /chuyển (?:nhân viên|bộ phận liên quan)|chưa có thông tin/iu);
  assert.ok(result.state.decisionTrace?.knowledgeEntityIds.includes("audience-child-12-plus"));
});

test("phản hồi khách không làm lộ thuật ngữ Knowledge nội bộ", () => {
  const chat = new DemoChatService();
  const result = chat.chat(
    "faq-darkening-clothing",
    "Dùng cái này nách có bị thâm đen xì không? Sợ nhất là mặc áo sơ mi trắng đi làm bị ố vàng nách áo.",
  );

  assert.match(result.reply, /không gây ố vàng/iu);
  assert.match(result.reply, /không phải sản phẩm trị thâm/iu);
  assert.match(result.reply, /ma sát.*cạo nhổ.*kích ứng/isu);
  assert.match(result.reply, /da sạch, khô hoàn toàn/iu);
  assert.equal(result.state.handoffReason, undefined);
  assert.doesNotMatch(result.reply, /Knowledge|intent|pipeline|guardrail/iu);
});

test("chốt đơn có SĐT, địa chỉ và note được NER nội bộ trước LLM", () => {
  const message =
    "Nghe cũng ổn đấy. Cho mình 1 lọ về số 15 Lê Lợi, Hải Châu, Đà Nẵng. SĐT 0912345678 nhé. Nhớ gọi giao giờ hành chính cho mình.";
  assert.equal(isOrderCaptureMessage(message), true);

  const chat = new DemoChatService();
  const result = chat.chat("faq-order-note", message);
  const exported = chat.exportSession("faq-order-note") as {
    order?: { phone?: string; legacyAddress?: string; deliveryNote?: string };
  };

  assert.equal(result.state.lastIntent, "buying");
  assert.equal(result.state.selectedQuantity, 1);
  assert.equal(exported.order?.phone, "0912345678");
  assert.match(exported.order?.legacyAddress ?? "", /Số 15 Lê Lợi.*Quận Hải Châu.*Đà Nẵng/iu);
  assert.equal(exported.order?.deliveryNote, "Gọi và giao trong giờ hành chính");
  assert.match(result.reply, /0912345678.*Số 15 Lê Lợi.*Quận Hải Châu.*giờ hành chính/isu);
});

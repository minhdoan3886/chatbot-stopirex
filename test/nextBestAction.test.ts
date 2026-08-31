import assert from "node:assert/strict";
import test from "node:test";
import { planNextBestAction } from "../src/domain/nextBestAction.js";
import { DemoChatService } from "../src/services/demoChat.js";

const base = {
  replies: ["Dạ một lọ thường dùng khoảng 3–4 tháng ạ."],
  intent: "usage_frequency" as const,
  pipeline: "2.Đang tư vấn" as const,
  slots: {},
  answeredTopics: [],
  askedTopics: [],
  botPaused: false,
  hasCareCase: false,
  handoffPending: false,
  optedOut: false,
};

test("sau khi trả lời kiến thức chỉ hỏi thêm một dữ kiện liên quan", () => {
  const planned = planNextBestAction({
    ...base,
    customerMessage: "Một lọ dùng được bao lâu?",
  });
  assert.equal(planned.type, "ask_relevant_fact");
  assert.equal(planned.key, "discover_primary_symptom");
  assert.match(planned.prompt ?? "", /mồ hôi.*mùi.*cả hai/iu);
});

test("không hỏi lại triệu chứng đã có mà chuyển sang hoàn cảnh sử dụng", () => {
  const planned = planNextBestAction({
    ...base,
    customerMessage: "Nách mình ra nhiều mồ hôi, dùng một lọ được bao lâu?",
    answeredTopics: ["symptom"],
  });
  assert.equal(planned.key, "discover_work_context");
  assert.match(planned.prompt ?? "", /vận động.*điều hòa/iu);
});

test("đang thu đơn hoặc handoff tuyệt đối không khai thác bán hàng", () => {
  const collecting = planNextBestAction({
    ...base,
    customerMessage: "Tên Lan",
    pipeline: "5.Chờ TT KH",
    selectedQuantity: 1,
  });
  assert.equal(collecting.type, "close_without_question");
  assert.equal(collecting.key, "order_in_progress");

  const handoff = planNextBestAction({
    ...base,
    customerMessage: "Cho mình nhập sỉ",
    pipeline: "C3.Chờ CSKH",
    handoffPending: true,
  });
  assert.equal(handoff.key, "care_or_handoff");
});

test("đã trả lời mẹ bầu thì không nối thêm câu khai thác bán hàng", () => {
  const planned = planNextBestAction({
    ...base,
    customerMessage: "mẹ bầu dùng được k e",
    replies: ["Dạ phụ nữ đang mang thai nên tham khảo ý kiến bác sĩ trước khi dùng Stopirex ạ."],
    intent: "safety",
    topic: "pregnancy",
    knowledgeEntityIds: ["audience-pregnancy"],
  });

  assert.equal(planned.type, "close_without_question");
  assert.equal(planned.key, "special_population_safety_answered");
  assert.equal(planned.prompt, undefined);
});

test("tích hợp: trả lời trước rồi chủ động hỏi, nhưng không lặp câu đã hỏi", () => {
  const chat = new DemoChatService();
  const sessionId = "next-best-action-integration";
  const first = chat.chat(sessionId, "Một lọ dùng được bao lâu?");
  assert.match(first.reply, /3–4 tháng/iu);
  assert.match(first.reply, /mồ hôi.*mùi.*cả hai/isu);
  assert.equal(first.state.nextBestAction?.key, "discover_primary_symptom");

  const second = chat.chat(sessionId, "Mình chủ yếu ra mồ hôi nhiều ạ.");
  assert.doesNotMatch(second.reply, /chủ yếu ra nhiều mồ hôi, có mùi hay gặp cả hai/iu);
});

test("E2E 5 lượt kiểm soát NBA từ khám phá tới đơn và chính sách", () => {
  const chat = new DemoChatService();
  const sessionId = "next-best-action-e2e-five-turns";

  const t1 = chat.chat(sessionId, "Chào shop, cái lăn Stopirex này dùng để làm gì vậy?");
  assert.match(t1.reply, /ngăn tiết mồ hôi.*ẩm ướt.*mùi/isu);
  assert.match(t1.reply, /mồ hôi.*mùi.*cả hai/isu);
  assert.equal(t1.state.nextBestAction?.state, "asking_symptom");

  const t2 = chat.chat(
    sessionId,
    "Mình bị cả hai luôn. Mà cho mình hỏi cái này khác gì mấy loại lăn khử mùi trong siêu thị vậy? Cơ chế hoạt động của nó như thế nào mà đắt thế?",
  );
  assert.match(t2.reply, /lăn khử mùi thông thường.*che mùi.*ngăn tiết mồ hôi chuyên sâu.*kiểm soát lượng mồ hôi/isu);
  assert.ok(t2.reply.length > 280);
  assert.doesNotMatch(t2.reply, /mình.*(?:hỏi|muốn|gửi).*[?？]/iu);
  assert.equal(t2.state.nextBestAction?.state, "stopped_due_to_length");

  const t3 = chat.chat(sessionId, "À hiểu rồi. Thế dùng bao lâu thì thấy nách khô ráo?");
  assert.match(t3.reply, /tuần đầu.*1–2 tuần/isu);
  assert.match(t3.reply, /cách dùng ngắn.*bảng giá/isu);
  assert.equal(t3.state.nextBestAction?.state, "price_invite");

  const t4 = chat.chat(
    sessionId,
    "Cho mình bảng giá đi. Hoặc thôi gửi luôn 1 lọ về số 10 Duy Tân, Cầu Giấy nhé. SĐT 0912345678.",
  );
  assert.equal(t4.state.lastIntent, "buying");
  assert.equal(t4.state.pipeline, "5.Chờ TT KH");
  assert.equal(t4.state.orderDraft?.quantity, 1);
  assert.equal(t4.state.orderDraft?.phone, "0912345678");
  assert.match(t4.state.orderDraft?.legacyAddress ?? "", /10 Duy Tân.*Cầu Giấy/isu);
  assert.match(t4.reply, /285\.000đ.*30\.000đ.*315\.000đ/isu);
  assert.match(t4.reply, /Tên người nhận/iu);
  assert.equal(t4.state.nextBestAction?.state, "stopped_due_to_order");

  const orderBeforeConcern = structuredClone(t4.state.orderDraft);
  const t5 = chat.chat(
    sessionId,
    "Khoan đã chưa chốt vội. Đứa bạn mình đợt trước mua bảo dùng bị xót rát nách lắm, nếu mình bôi mà cũng bị thế thì có được trả hàng hoàn tiền không?",
  );
  assert.equal(t5.state.lastIntent, "order_support");
  assert.match(t5.reply, /^Dạ có ạ\..*bảo hành.*hoàn tiền/isu);
  assert.match(t5.reply, /dùng đúng hướng dẫn.*đủ 2 tuần/isu);
  assert.match(t5.reply, /clip nhúng hủy.*không cần gửi lại sản phẩm/isu);
  assert.match(t5.reply, /xót hoặc rát.*ngưng dùng.*nhắn bên em/isu);
  assert.doesNotMatch(t5.reply, /chọn mấy lọ|chốt đơn|gửi thông tin nhận hàng/iu);
  assert.deepEqual(t5.state.orderDraft, orderBeforeConcern);
  assert.equal(t5.state.nextBestAction?.state, "stopped_due_to_handoff_or_complaint");
});

test("E2E FAQ thực chiến: đối tượng đặc biệt, thâm nách, routine, vùng dùng và full slot", () => {
  const chat = new DemoChatService();
  const sessionId = "real-world-faq-e2e";

  const t1 = chat.chat(
    sessionId,
    "Shop ơi, phụ nữ có thai 5 tháng với bé 13 tuổi đang dậy thì bị hôi nách thì có dùng được loại này không?",
  );
  assert.equal(t1.state.lastIntent, "safety");
  assert.match(t1.reply, /phụ nữ đang mang thai.*tham khảo ý kiến bác sĩ/isu);
  assert.match(t1.reply, /bé 13 tuổi.*có thể dùng/isu);
  assert.ok(t1.state.decisionTrace?.knowledgeEntityIds.includes("audience-pregnancy"));
  assert.ok(t1.state.decisionTrace?.knowledgeEntityIds.includes("audience-child-12-plus"));

  const t2 = chat.chat(
    sessionId,
    "Nhiều người bảo dùng ba cái lăn đặc trị này nách bị thâm đen sì, bên mình có cam kết không thâm không?",
  );
  assert.equal(t2.state.lastIntent, "product_effect");
  assert.match(t2.reply, /dùng đúng hướng dẫn.*không gây thâm nách/isu);
  assert.match(t2.reply, /da sạch, khô hoàn toàn/isu);
  assert.equal(t2.state.handoffReason, undefined);
  assert.ok(t2.state.decisionTrace?.knowledgeEntityIds.includes("usage-underarm-darkening-prevention"));

  const t3 = chat.chat(
    sessionId,
    "Thế sáng ngủ dậy mình có cần phải lấy xà phòng rửa sạch lớp lăn bôi từ tối hôm trước đi không? Ban ngày mình xịt thêm nước hoa toàn thân vào nách có bị sao không?",
  );
  assert.equal(t3.state.lastIntent, "usage_guidance");
  assert.match(t3.reply, /rửa.*xà phòng bình thường.*không làm mất tác dụng/isu);
  assert.match(t3.reply, /không cần lăn lại buổi sáng/iu);
  assert.match(t3.reply, /có thể dùng nước hoa/iu);
  assert.ok(t3.state.decisionTrace?.knowledgeEntityIds.includes("usage-morning-wash-with-soap"));
  assert.ok(t3.state.decisionTrace?.knowledgeEntityIds.includes("usage-morning-fragrance-layering"));

  const t4 = chat.chat(
    sessionId,
    "Mình bị ra mồ hôi tay với lòng bàn chân ướt sũng nữa, lấy cái này lăn vào tay chân luôn được không?",
  );
  assert.equal(t4.state.lastIntent, "usage_guidance");
  assert.match(t4.reply, /hướng dẫn dùng cho vùng nách/iu);
  assert.match(t4.reply, /không hướng dẫn lăn lên lòng bàn tay hoặc lòng bàn chân/iu);
  assert.ok(t4.state.decisionTrace?.knowledgeEntityIds.includes("usage-approved-area-underarms-only"));

  const t5 = chat.chat(
    sessionId,
    "Tư vấn kỹ đấy. Thôi lấy thử 1 lọ nhé. Giao về số 10 Nguyễn Trãi, Thanh Xuân, HN. Tên người nhận là Dũng, SĐT 0988777666.",
  );
  assert.equal(t5.state.lastIntent, "buying");
  assert.equal(t5.state.orderDraft?.quantity, 1);
  assert.equal(t5.state.orderDraft?.recipientName, "Dũng");
  assert.equal(t5.state.orderDraft?.phone, "0988777666");
  assert.match(t5.state.orderDraft?.legacyAddress ?? "", /10 Nguyễn Trãi.*Quận Thanh Xuân.*Hà Nội/isu);
  assert.match(t5.reply, /tổng hợp đơn hàng/iu);
  assert.doesNotMatch(
    t5.reply,
    /bổ sung[\s\S]*(?:tên người nhận|SĐT|phường\/xã|quận\/huyện|tỉnh\/thành phố)/iu,
  );
  assert.equal(t5.state.nextBestAction?.state, "stopped_due_to_order");
});

import assert from "node:assert/strict";
import test from "node:test";
import { DemoChatService } from "../src/services/demoChat.js";

test("E2E vùng hỗn mang: quantity math, spoken phone, selective overwrite, policy interrupt và cancel", () => {
  const chat = new DemoChatService();
  const sessionId = "chaos-e2e-order";

  const t1 = chat.chat(
    sessionId,
    "Mình định mua combo 3 lọ cho rẻ, giá 750k đúng không? Nhưng nhà 4 người, hay thôi lấy 4 lọ. À mà khoan, chồng mình lại bảo không dùng đâu, trừ của lão ra đi. Chốt lại cái đơn này tổng tiền bao nhiêu, có freeship không?",
  );
  assert.equal(t1.state.lastIntent, "buying");
  assert.equal(t1.state.orderDraft?.quantity, 3);
  assert.equal(t1.state.orderDraft?.totalVnd, 750_000);
  assert.match(t1.reply, /3 lọ.*750\.000đ.*miễn phí giao/isu);
  assert.equal(t1.state.nextBestAction?.state, "stopped_due_to_order");

  const t2 = chat.chat(
    sessionId,
    "Ok chốt số lượng đó. Giao đến công ty chồng mình ở tòa nhà Lotte Đào Tấn, Cống Vị, Ba Đình nhé. Số điện thoại của lão là không chín một hai, ba bốn năm, sáu bảy tám. Tên là Hoàng.",
  );
  assert.equal(t2.state.orderDraft?.recipientName, "Hoàng");
  assert.equal(t2.state.orderDraft?.phone, "0912345678");
  assert.match(
    t2.state.orderDraft?.legacyAddress ?? "",
    /Lotte Đào Tấn.*Phường Cống Vị.*Quận Ba Đình.*Hà Nội/isu,
  );
  assert.deepEqual(t2.state.orderMissing, []);
  assert.match(t2.reply, /tổng hợp đơn.*Hoàng.*0912345678.*750\.000đ/isu);

  const t3 = chat.chat(
    sessionId,
    "Thôi lão ý hay đi công tác. Giao về nhà mình đi, khu chung cư Times City Minh Khai, Hai Bà Trưng ấy. Vẫn giữ số điện thoại trên nhưng đổi tên người nhận thành My. Phường Vĩnh Tuy nhé.",
  );
  assert.equal(t3.state.orderDraft?.recipientName, "My");
  assert.equal(t3.state.orderDraft?.phone, "0912345678");
  assert.match(
    t3.state.orderDraft?.legacyAddress ?? "",
    /Times City Minh Khai.*Phường Vĩnh Tuy.*Quận Hai Bà Trưng.*Hà Nội/isu,
  );
  assert.doesNotMatch(t3.state.orderDraft?.legacyAddress ?? "", /Lotte|Đào Tấn|Ba Đình/iu);
  assert.deepEqual(t3.state.orderMissing, []);

  const orderBeforePolicyInterrupt = structuredClone(t3.state.orderDraft);
  const t4 = chat.chat(
    sessionId,
    "Từ từ đã chưa chốt vội. Hỏi cái này, nhỡ mình bôi mà nó làm ố vàng nách cái áo lụa 2 triệu của mình thì shop có đền tiền áo không?",
  );
  assert.equal(t4.state.lastIntent, "product_effect");
  assert.match(t4.reply, /không bám.*ố vàng.*lăn mỏng.*chờ khô hẳn/isu);
  assert.match(t4.reply, /không tự cam kết.*bộ phận liên quan kiểm tra/isu);
  assert.match(t4.reply, /hoàn tiền.*dùng đúng đủ 2 tuần.*không phải bồi thường áo/isu);
  assert.deepEqual(t4.state.orderDraft, orderBeforePolicyInterrupt);
  assert.equal(t4.state.orderId, undefined);
  assert.equal(t4.state.nextBestAction?.state, "stopped_due_to_handoff_or_complaint");
  assert.ok(
    t4.state.decisionTrace?.knowledgeEntityIds.includes("policy-clothing-damage-compensation-review"),
  );

  const t5 = chat.chat(
    sessionId,
    "Nghe lằng nhằng quá. Hủy hết mẹ đơn đi. Không mua bán gì nữa. Stopirex có cồn mình sợ dị ứng lắm.",
  );
  assert.equal(t5.state.lastIntent, "decline_purchase");
  assert.equal(t5.state.pipeline, "N.Nuôi dưỡng");
  assert.deepEqual(t5.state.orderDraft, {});
  assert.equal(t5.state.selectedQuantity, undefined);
  assert.equal(t5.state.orderId, undefined);
  assert.match(t5.reply, /đã hủy toàn bộ đơn.*có Alcohol.*dung môi.*ngưỡng an toàn/isu);
  assert.doesNotMatch(t5.reply, /chốt|mua thêm|giữ đơn|combo/iu);
  assert.ok(
    t5.state.decisionTrace?.knowledgeEntityIds.includes("business-approved-alcohol-odor-guidance-2026-08"),
  );
});

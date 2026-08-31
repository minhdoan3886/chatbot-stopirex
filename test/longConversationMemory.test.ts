import assert from "node:assert/strict";
import test from "node:test";
import { DemoChatService, type DemoChatState } from "../src/services/demoChat.js";

type TurnLog = {
  customer: string;
  bot: string;
  state: DemoChatState;
};

const context = { actionExecutionMode: "multi_action" as const };
const memoryAuditTest = process.env.RUN_LONG_MEMORY_AUDIT === "1" ? test : test.skip;

function runConversation(sessionId: string, customerTurns: readonly string[]): TurnLog[] {
  const chat = new DemoChatService();
  const logs = customerTurns.map((customer) => {
    const result = chat.chat(sessionId, customer, {}, context);
    return {
      customer,
      bot: result.reply,
      state: structuredClone(result.state),
    };
  });

  if (process.env.VERBOSE_TRANSCRIPT === "1") {
    console.log(`\n=== ${sessionId} ===`);
    for (const [index, log] of logs.entries()) {
      console.log(`\nLƯỢT ${index + 1}`);
      console.log(`KHÁCH: ${log.customer}`);
      console.log(`BOT: ${log.bot}`);
      console.log(
        `STATE: intent=${String(log.state.lastIntent)}; pipeline=${log.state.pipeline}; quantity=${String(log.state.selectedQuantity ?? "")}; recipient=${String(log.state.orderDraft?.recipientName ?? "")}; phone=${String(log.state.orderDraft?.phone ?? "")}; address=${String(log.state.orderDraft?.legacyAddress ?? "")}`,
      );
    }
  }

  return logs;
}

function hasAll(value: string, expressions: readonly RegExp[]): boolean {
  return expressions.every((expression) => expression.test(value));
}

memoryAuditTest("memory E2E: tư vấn, đổi chủ đề rồi quay lại chốt đúng combo", () => {
  // Số điện thoại trong tài liệu gốc bị che bằng chữ x. Test dùng số giả hợp lệ,
  // không phải dữ liệu khách hàng thật, để kiểm tra slot phone đúng 10 chữ số.
  const logs = runConversation("memory-e2e-recommended-combo", [
    "Chào shop, mình bị ra mồ hôi nách khá nhiều",
    "Nhất là lúc căng thẳng hoặc họp",
    "Nhưng mình không bị mùi nặng lắm",
    "Stopirex dùng kiểu gì vậy?",
    "Da mình hơi nhạy cảm thì sao?",
    "Một lọ dùng được lâu không?",
    "Có những combo nào?",
    "Theo bạn mình nên lấy loại nào?",
    "Ok để mình suy nghĩ",
    "À ship về Hải Phòng mất bao lâu?",
    "Có được kiểm tra hàng không?",
    "Hàng bên bạn là chính hãng chứ?",
    "Quay lại cái combo bạn vừa khuyên mình ấy",
    "Nó có hợp với tình trạng của mình không?",
    "Thế lấy cho mình combo đó",
    "Minh Anh, 0981234567",
    "25 Lạch Tray, Hải Phòng",
    "Đúng rồi",
  ]);

  const referenceReply = logs[12]?.bot ?? "";
  const suitabilityReply = logs[13]?.bot ?? "";
  const finalReply = logs[17]?.bot ?? "";
  const finalState = logs[17]?.state;
  assert.ok(finalState);

  const score = {
    remembersSweat: /mồ hôi/iu.test(suitabilityReply) ? 2 : 0,
    remembersTrigger: /căng thẳng|họp/iu.test(suitabilityReply) ? 1 : 0,
    remembersMildOdor: /mùi[^.!?\n]{0,40}(?:không|chưa)[^.!?\n]{0,20}nặng|mùi nhẹ/iu.test(
      suitabilityReply,
    )
      ? 1
      : 0,
    remembersSensitiveSkin: /nhạy cảm/iu.test(suitabilityReply) ? 1 : 0,
    resolvesRecommendedCombo:
      !/combo nào/iu.test(referenceReply) &&
      /combo 2 lọ|2 lọ/iu.test(referenceReply) &&
      finalState.selectedQuantity === 2
        ? 2
        : 0,
    doesNotReaskOrderSlots:
      !/(?:xin|gửi|bổ sung)[^.!?\n]{0,100}(?:tên|SĐT|số điện thoại|địa chỉ)/iu.test(finalReply) &&
      finalState.orderDraft?.recipientName === "Minh Anh" &&
      finalState.orderDraft?.phone === "0981234567"
        ? 2
        : 0,
    accurateRecap:
      hasAll(finalReply, [/2 lọ/iu, /Minh Anh/iu, /0981234567/u, /25 Lạch Tray/iu, /Hải Phòng/iu])
        ? 1
        : 0,
  };
  const total = Object.values(score).reduce((sum, value) => sum + value, 0);

  assert.ok(
    total >= 9,
    `Bài test 1 đạt ${total}/10, yêu cầu tối thiểu 9/10. Chi tiết: ${JSON.stringify(score)}`,
  );
});

memoryAuditTest("memory E2E: sửa thông tin đơn phải ghi đè giá trị cũ nhưng vẫn nhớ lịch sử", () => {
  const logs = runConversation("memory-e2e-order-correction", [
    "Shop ơi mình muốn mua Stopirex",
    "Mình dùng rồi, lần này mua cho em gái",
    "Em mình 17 tuổi, hay ra mồ hôi khi đi học",
    "Nó không bị mùi nhiều đâu",
    "Lấy 2 lọ nhé",
    "Người nhận là Nguyễn Ngọc Mai",
    "0912345678",
    "15 Nguyễn Trãi, Thanh Xuân, Hà Nội",
    "Khoan, đổi số điện thoại nhé",
    "0987654321 mới đúng",
    "Địa chỉ vẫn như cũ",
    "Mình có thể dùng chung một lọ với em không?",
    "À thôi vẫn để em mình dùng riêng",
    "Ban đầu mình đặt mấy lọ nhỉ?",
    "Người nhận là ai ấy nhỉ?",
    "Số điện thoại?",
    "Địa chỉ lúc nãy giữ nguyên nha",
    "Tổng kết đơn giúp mình",
    "À số lúc đầu của mình là gì nhỉ?",
    "Vậy cứ để số mới nhé",
  ]);

  const finalState = logs[19]?.state;
  assert.ok(finalState);
  assert.equal(finalState.selectedQuantity, 2, "Số lượng hiện hành phải là 2 lọ");
  assert.equal(
    finalState.orderDraft?.recipientName,
    "Nguyễn Ngọc Mai",
    "Phải giữ tên người nhận đã cung cấp",
  );
  assert.equal(finalState.orderDraft?.phone, "0987654321", "Số mới phải ghi đè số cũ");
  assert.match(
    finalState.orderDraft?.legacyAddress ?? "",
    /15 Nguyễn Trãi.*Thanh Xuân.*Hà Nội/isu,
    "Cụm 'địa chỉ vẫn như cũ' không được xóa hoặc thay địa chỉ",
  );

  assert.match(logs[13]?.bot ?? "", /2 lọ/iu, "Phải trả lời đúng số lượng ban đầu");
  assert.match(
    logs[14]?.bot ?? "",
    /Nguyễn Ngọc Mai/iu,
    "Phải đọc lại đúng người nhận hiện hành",
  );
  assert.match(logs[15]?.bot ?? "", /0987654321/u, "Phải đọc lại số điện thoại hiện hành");
  assert.doesNotMatch(
    logs[15]?.bot ?? "",
    /0912345678/u,
    "Không được dùng số cũ khi khách hỏi số điện thoại hiện hành",
  );
  assert.ok(
    hasAll(logs[17]?.bot ?? "", [
      /2 lọ/iu,
      /Nguyễn Ngọc Mai/iu,
      /0987654321/u,
      /15 Nguyễn Trãi/iu,
    ]),
    "Lượt tổng kết phải chứa đầy đủ dữ liệu hiện hành",
  );
  assert.ok(
    hasAll(logs[18]?.bot ?? "", [/0912345678/u, /0987654321/u, /(?:ban đầu|số cũ)/iu, /(?:hiện|số mới)/iu]),
    "Phải phân biệt được số lịch sử và số đang dùng cho đơn",
  );
  assert.equal(
    logs[19]?.state.orderDraft?.phone,
    "0987654321",
    "Nhắc lại số cũ không được làm state quay về giá trị cũ",
  );
});

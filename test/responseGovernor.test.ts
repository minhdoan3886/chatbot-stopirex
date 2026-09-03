import assert from "node:assert/strict";
import test from "node:test";
import { governCustomerResponse, inferAnsweredTopicFromMessage } from "../src/domain/responseGovernor.js";

test("governor không hỏi lại bối cảnh đã được khách trả lời", () => {
  const result = governCustomerResponse({
    replies: [
      "Dạ em hiểu mình thường vận động ngoài trời ạ.",
      "Tình trạng có xuất hiện cả khi ngồi điều hòa không ạ?",
      "Mình khó chịu nhất vì ướt áo, mùi hay cả hai ạ?",
    ],
    answeredTopics: ["work_context"],
  });

  assert.doesNotMatch(result.replies.join("\n"), /ngồi điều hòa/);
  assert.match(result.replies.join("\n"), /ướt áo/);
  assert.equal(result.pendingQuestionTopic, "symptom");
});

test("governor giữ câu chuyển bộ phận liên quan và không quá ba bubble", () => {
  const result = governCustomerResponse({
    replies: [
      "Dạ nội dung này chưa có trong thông tin đã xác nhận.",
      "Anh gửi em ảnh hoặc đường link nhé.",
      "Em chuyển bộ phận liên quan kiểm tra đúng kênh và phản hồi lại mình ạ.",
      "Cảm ơn anh.",
    ],
    preserveFullText: true,
  });

  assert.ok(result.replies.length <= 3);
  assert.match(result.replies.join("\n"), /chuyển bộ phận liên quan kiểm tra/);
});

test("governor không cắt mất giá combo và CTA trong giới hạn 500 ký tự", () => {
  const result = governCustomerResponse({
    replies: [
      "Dạ em chào anh Minh ạ! Em là Linh, bộ phận tư vấn của Stopirex đây ạ.",
      "⚠️ GIÁ SANDBOX — chỉ để kiểm thử localhost, chưa phải dữ liệu production.\nDạ giá hiện tại:\n• 1 lọ: 285.000đ + 30.000đ phí giao.\n• Combo 2 lọ: 510.000đ, miễn phí giao, tiết kiệm 60.000đ.\nAnh muốn chọn 1 lọ trải nghiệm hay combo 2 lọ ạ?",
    ],
    maxBubbles: 2,
  });

  const reply = result.replies.join("\n\n");
  assert.match(reply, /510\.000đ/u);
  assert.match(reply, /muốn chọn 1 lọ/u);
  assert.equal(result.truncated, false);
});

test("câu trả lời ngắn được gắn đúng chủ đề đang chờ", () => {
  assert.deepEqual(inferAnsweredTopicFromMessage("hok", "work_context"), ["work_context"]);
});

test("câu hỏi mới không bị coi là câu trả lời cho chủ đề đang chờ", () => {
  assert.deepEqual(inferAnsweredTopicFromMessage("Giá combo 2 lọ bao nhiêu?", "symptom"), ["quantity"]);
});

test("cách nói cả 2 được nhận diện là câu trả lời cho chủ đề triệu chứng", () => {
  assert.deepEqual(inferAnsweredTopicFromMessage("cả 2", "symptom"), ["symptom"]);
});

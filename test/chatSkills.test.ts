import assert from "node:assert/strict";
import test from "node:test";
import {
  assertSkillResponseShape,
  compactCustomerAdvisorVoiceForPrompt,
  resolveConversationSkill,
} from "../src/domain/chatSkills.js";
import { evaluateConversationQuality } from "../src/domain/conversationQuality.js";

test("giọng tư vấn không tự chèn lời thoái thác", () => {
  const principles = compactCustomerAdvisorVoiceForPrompt();
  assert.match(principles, /nhân viên tư vấn khách hàng/iu);
  assert.match(principles, /không tự thêm lời thoái thác/iu);
  assert.match(principles, /khách hỏi cam kết tuyệt đối/iu);
});

test("hỏi giá thông thường dùng direct-answer và không nhận nhầm skill phản đối giá", () => {
  const result = resolveConversationSkill({
    suggestedSkill: "pricing-objection",
    route: "direct_intent",
    intent: "price_request",
    topic: "price",
    pipeline: "2.Đang tư vấn",
  });

  assert.equal(result.skill.id, "direct-answer");
  assert.equal(result.suggestionAccepted, false);
});

test("pricing-objection bắt buộc mềm, dựa trên giá trị đã duyệt và đúng ưu đãi", () => {
  const skill = resolveConversationSkill({
    route: "direct_intent",
    intent: "price_objection",
    topic: "price",
    pipeline: "3.Đã báo giá",
  }).skill;

  assert.equal(skill.id, "pricing-objection");
  assert.match(skill.objective, /không đôi co/iu);
  assert.match(skill.objective, /không.*tự tạo ưu đãi/iu);
  assert.match(skill.responsePattern, /giá trị sử dụng đã xác minh/iu);
  assert.match(skill.responsePattern, /một lựa chọn không gây áp lực/iu);
});

test("code ghi đè skill LLM nếu đang thu thông tin đơn", () => {
  const result = resolveConversationSkill({
    suggestedSkill: "need-discovery",
    route: "order_collection",
    intent: "order_support",
    topic: "order",
    pipeline: "5.Chờ TT KH",
  });

  assert.equal(result.skill.id, "order-closing");
  assert.equal(result.suggestionAccepted, false);
});

test("kích ứng thật luôn dùng safety-first nhưng giả định thì không", () => {
  const actual = resolveConversationSkill({
    suggestedSkill: "solution-guidance",
    route: "start_care",
    intent: "safety",
    topic: "irritation",
    scenario: "actual",
    careIssue: "irritation",
    pipeline: "2.Đang tư vấn",
  });
  const hypothetical = resolveConversationSkill({
    suggestedSkill: "direct-answer",
    route: "direct_intent",
    intent: "safety",
    topic: "irritation",
    scenario: "hypothetical",
    careIssue: "irritation",
    pipeline: "2.Đang tư vấn",
  });

  assert.equal(actual.skill.id, "safety-first");
  assert.equal(hypothetical.skill.id, "direct-answer");
});

test("khuyến mại chưa xác nhận luôn chuyển skill knowledge-handoff", () => {
  const result = resolveConversationSkill({
    suggestedSkill: "pricing-objection",
    route: "direct_intent",
    intent: "promotion_inquiry",
    topic: "promotion",
    pipeline: "3.Đã báo giá",
  });

  assert.equal(result.skill.id, "knowledge-handoff");
});

test("skill shape guard chặn câu dài hoặc nhiều câu hỏi", () => {
  assert.throws(
    () =>
      assertSkillResponseShape(
        "need-discovery",
        "Mình bị khi nào ạ? Mình đang khó chịu vì mùi hay mồ hôi ạ?",
      ),
    /vượt 1 câu hỏi/,
  );
  assert.throws(
    () => assertSkillResponseShape("need-discovery", "Dạ được ạ. Mình đang khó chịu vì mùi hay mồ hôi ạ?"),
    /câu xác nhận cụt/,
  );
});

test("solution-guidance giới hạn hai đoạn ngắn cho giao diện Messenger", () => {
  const skill = resolveConversationSkill({
    route: "direct_intent",
    intent: "usage_guidance",
    topic: "usage",
    pipeline: "2.Đang tư vấn",
  }).skill;

  assert.equal(skill.id, "solution-guidance");
  assert.equal(skill.maxCharacters, 240);
  assert.equal(skill.maxBubbles, 2);
  assert.match(skill.objective, /một hướng dẫn hoặc lưu ý/iu);
});

test("quality evaluator đạt với báo giá đúng, ngắn và có bước tiếp theo", () => {
  const baseReply =
    "Dạ Stopirex hiện có giá 285.000đ/lọ, phí giao 30.000đ; combo 2 lọ 510.000đ và miễn phí giao ạ. Mình muốn chọn 1 lọ hay combo 2 lọ ạ?";
  const result = evaluateConversationQuality({
    customerMessage: "Giá bao nhiêu?",
    baseReply,
    replies: [baseReply],
    skill: "pricing-objection",
    intent: "price_request",
    asksDirectAnswer: true,
  });

  assert.equal(result.passed, true);
  assert.equal(result.answeredDirectly, true);
  assert.equal(result.priceFactsPreserved, true);
  assert.equal(result.questionCount, 1);
});

test("quality evaluator đánh trượt trả lời vòng vo và lộ thuật ngữ nội bộ", () => {
  const result = evaluateConversationQuality({
    customerMessage: "Giá bao nhiêu?",
    baseReply:
      "Dạ Stopirex hiện có giá 285.000đ/lọ, phí giao 30.000đ; combo 2 lọ 510.000đ và miễn phí giao ạ.",
    replies: ["Dạ em hỏi nhanh để routing intent nhé. Mình bị mùi không ạ? Mình có ra mồ hôi không ạ?"],
    skill: "pricing-objection",
    intent: "price_request",
    asksDirectAnswer: true,
  });

  assert.equal(result.passed, false);
  assert.ok(result.hardFailReasons.includes("direct_question_not_answered_first"));
  assert.ok(result.hardFailReasons.includes("too_many_questions"));
  assert.ok(result.hardFailReasons.includes("internal_language_leaked"));
  assert.ok(result.hardFailReasons.includes("price_fact_missing_or_changed"));
});

test("quality gate đánh trượt câu logistics trả nhầm bảng giá", () => {
  const result = evaluateConversationQuality({
    customerMessage:
      "Mình ở Đà Nẵng thì đặt mấy ngày nhận được? Lúc shipper giao tới có được bóc ra xem hàng không?",
    baseReply: "Dạ em chuyển bộ phận liên quan kiểm tra thời gian giao và chính sách kiểm hàng ạ.",
    replies: ["Dạ 1 lọ 285.000đ, combo 2 lọ 510.000đ và miễn phí giao ạ."],
    skill: "direct-answer",
    intent: "order_support",
    asksDirectAnswer: true,
    expectedQuestionEvidence: ["mấy ngày nhận được", "bóc ra xem hàng"],
  });

  assert.equal(result.passed, false);
  assert.equal(result.questionCoverageComplete, false);
  assert.ok(result.hardFailReasons.includes("question_coverage_incomplete"));
});

test("quality gate hiểu đủ hai ý cơ chế tuyến mồ hôi và tỷ lệ tái phát không áp dụng", () => {
  const reply =
    "Dạ Stopirex là dược mỹ phẩm dùng ngoài da, hỗ trợ ức chế và giảm lượng mồ hôi tiết ra; sản phẩm không can thiệp loại bỏ tuyến mồ hôi như phẫu thuật ạ. Vì cần dùng duy trì để kiểm soát mồ hôi nên khái niệm tỷ lệ tái phát sau 1 năm không áp dụng cho sản phẩm này.";
  const result = evaluateConversationQuality({
    customerMessage:
      "Stopirex có triệt tiêu vĩnh viễn tuyến mồ hôi apocrine không? Tỷ lệ tái phát sau 1 năm là bao nhiêu phần trăm?",
    baseReply: reply,
    replies: [reply],
    skill: "direct-answer",
    intent: "product_effect",
    asksDirectAnswer: true,
  });

  assert.equal(result.questionCoverageComplete, true);
  assert.equal(result.passed, true);
});

test("quality gate không ép CTA vào câu hướng dẫn trực tiếp đã trả lời đủ", () => {
  const reply =
    "Dạ nếu quên một tối thì mình không cần bôi bù vào buổi sáng ạ. Stopirex nên dùng buổi tối trên da sạch, khô hoàn toàn khi tuyến mồ hôi hoạt động ít hơn. Bôi buổi sáng thường kém hiệu quả hơn; mình dùng lại vào tối hôm sau nhé.";
  const result = evaluateConversationQuality({
    customerMessage: "Quên bôi buổi tối thì sáng bôi bù được không?",
    baseReply: reply,
    replies: [reply],
    skill: "solution-guidance",
    intent: "usage_time",
    asksDirectAnswer: true,
  });

  assert.equal(result.nextStepClear, true);
  assert.equal(result.questionCoverageComplete, true);
  assert.equal(result.hardFailReasons.includes("next_step_missing"), false);
});

test("quality gate chấp nhận cách nói mùi dược tính đặc trưng nhẹ", () => {
  const reply =
    "Dạ một lọ thường dùng khoảng 3–4 tháng khi lăn mỏng 2–3 lần/tuần ạ. Sản phẩm có mùi dược tính đặc trưng nhẹ và bay hơi rất nhanh, không làm lẫn mùi nước hoa.";
  const result = evaluateConversationQuality({
    customerMessage: "Một lọ Stopirex dùng được bao lâu và sản phẩm có mùi nồng không?",
    baseReply: reply,
    replies: [reply],
    skill: "solution-guidance",
    intent: "usage_frequency",
    asksDirectAnswer: true,
    expectedQuestionEvidence: ["một lọ dùng được bao lâu", "sản phẩm có mùi nồng không"],
  });

  assert.equal(result.questionCoverageComplete, true);
  assert.equal(result.passed, true);
});

test("quality gate chặn fallback trả lệch câu cồn và mùi", () => {
  const result = evaluateConversationQuality({
    customerMessage:
      "Stopirex 100% không cồn đúng không? Sản phẩm có hoàn toàn không mùi để khỏi lộn mùi nước hoa không?",
    baseReply: "Dạ có ạ.",
    replies: ["Dạ có ạ. Stopirex hỗ trợ kiểm soát mùi cơ thể."],
    skill: "direct-answer",
    intent: "product_effect",
    asksDirectAnswer: true,
  });
  assert.equal(result.questionCoverageComplete, false);
  assert.equal(result.passed, false);
});

test("quality gate bắt buộc trả đủ cồn và hiệu quả duy trì dù khách chỉ dùng một dấu hỏi", () => {
  const customerMessage =
    "Hôm qua shop bảo 100% không chứa cồn, bôi là khỏi vĩnh viễn. Sao hôm nay lại bảo có cồn và phải duy trì?";
  const incomplete = evaluateConversationQuality({
    customerMessage,
    baseReply: "Stopirex hỗ trợ kiểm soát mồ hôi và cần dùng duy trì ạ.",
    replies: ["Stopirex hỗ trợ kiểm soát mồ hôi và cần dùng duy trì ạ."],
    skill: "direct-answer",
    intent: "product_effect",
    asksDirectAnswer: true,
  });
  assert.equal(incomplete.questionCoverageComplete, false);
  assert.ok(incomplete.hardFailReasons.includes("question_coverage_incomplete"));

  const completeReply =
    "Stopirex có chứa cồn (Alcohol) làm dung môi trong ngưỡng an toàn. Sản phẩm hỗ trợ kiểm soát mồ hôi, cần dùng duy trì và không phải thuốc chữa khỏi vĩnh viễn ạ.";
  const complete = evaluateConversationQuality({
    customerMessage,
    baseReply: completeReply,
    replies: [completeReply],
    skill: "direct-answer",
    intent: "product_effect",
    asksDirectAnswer: true,
  });
  assert.equal(complete.questionCoverageComplete, true);
  assert.equal(complete.passed, true);
});

test("quality gate chặn câu trả lời cồn và mùi làm lộ luật nội bộ", () => {
  const result = evaluateConversationQuality({
    customerMessage:
      "Stopirex 100% không cồn đúng không? Sản phẩm có hoàn toàn không mùi để khỏi lộn mùi nước hoa không?",
    baseReply:
      "Stopirex có Alcohol làm dung môi trong ngưỡng an toàn, có mùi đặc trưng nhẹ và bay nhanh, không làm lộn mùi nước hoa.",
    replies: [
      "Stopirex có Alcohol làm dung môi trong ngưỡng an toàn, có mùi đặc trưng nhẹ và bay nhanh, không làm lộn mùi nước hoa. Hồ sơ hiện có không công bố tỷ lệ nên bên em không tự nêu phần trăm.",
    ],
    skill: "direct-answer",
    intent: "product_comparison",
    asksDirectAnswer: true,
  });
  assert.equal(result.internalLanguageLeaked, true);
  assert.equal(result.passed, false);
});

test("quality gate không cho câu so sánh đối thủ làm mất căn cứ dịu nhẹ", () => {
  const customerMessage =
    "Trước dùng Etiaxil đỏ ngứa gãi trầy da, Stopirex nhà bạn có êm thật không hay lại quảng cáo?";
  const incomplete = evaluateConversationQuality({
    customerMessage,
    baseReply: "Dạ Stopirex là dòng cho da nhạy cảm, mình lăn mỏng ạ.",
    replies: ["Dạ Stopirex là dòng cho da nhạy cảm, mình lăn mỏng ạ."],
    skill: "direct-answer",
    intent: "product_comparison",
    asksDirectAnswer: true,
  });
  assert.equal(incomplete.questionCoverageComplete, false);

  const completeReply =
    "Dạ em không nhận xét về Etiaxil ạ. Riêng Stopirex đã được thử nghiệm; công thức có Bisabolol dịu nhẹ, mình lăn một lớp mỏng trên da sạch, khô.";
  const complete = evaluateConversationQuality({
    customerMessage,
    baseReply: completeReply,
    replies: [completeReply],
    skill: "direct-answer",
    intent: "product_comparison",
    asksDirectAnswer: true,
  });
  assert.equal(complete.questionCoverageComplete, true);
  assert.equal(complete.passed, true);
});

test("quality gate bắt đủ nhổ lông, buổi tối và ố áo", () => {
  const customerMessage =
    "Sáng nay mình vừa nhổ lông nách xong, định quệt luôn thì có được không? Mặc áo sơ mi có sợ ố vàng không?";
  const incomplete = evaluateConversationQuality({
    customerMessage,
    baseReply: "Dạ sản phẩm không gây ố vàng áo ạ.",
    replies: ["Dạ sản phẩm không gây ố vàng áo ạ."],
    skill: "solution-guidance",
    intent: "usage_guidance",
    asksDirectAnswer: true,
  });
  assert.equal(incomplete.questionCoverageComplete, false);

  const completeReply =
    "Dạ sau nhổ lông mình chờ 24–48 giờ và chỉ dùng khi da đã ổn. Stopirex dùng buổi tối trên da sạch, khô; sản phẩm không bết và không gây ố vàng áo.";
  const complete = evaluateConversationQuality({
    customerMessage,
    baseReply: completeReply,
    replies: [completeReply],
    skill: "solution-guidance",
    intent: "usage_guidance",
    asksDirectAnswer: true,
  });
  assert.equal(complete.questionCoverageComplete, true);
});

test("quality gate bắt câu sỉ trả đúng từng nghiệp vụ khách hỏi", () => {
  const customerMessage =
    "Mình nhập 20 lọ cho tiệm thì chiết khấu bao nhiêu? Shop xuất hóa đơn VAT công ty không?";
  const incomplete = evaluateConversationQuality({
    customerMessage,
    baseReply: "Dạ em chuyển bộ phận liên quan tư vấn tủ kệ và banner ạ.",
    replies: ["Dạ em chuyển bộ phận liên quan tư vấn tủ kệ và banner ạ."],
    skill: "knowledge-handoff",
    intent: "order_support",
    asksDirectAnswer: true,
  });
  assert.equal(incomplete.questionCoverageComplete, false);
  assert.equal(incomplete.passed, false);

  const completeReply =
    "Dạ phần chiết khấu và xuất hóa đơn VAT cần xác nhận; em chuyển bộ phận liên quan hỗ trợ trực tiếp cho mình.";
  const complete = evaluateConversationQuality({
    customerMessage,
    baseReply: completeReply,
    replies: [completeReply],
    skill: "knowledge-handoff",
    intent: "order_support",
    asksDirectAnswer: true,
  });
  assert.equal(complete.questionCoverageComplete, true);
  assert.equal(complete.passed, true);
});

test("quality gate công nhận hoàn tiền nhúng hủy không cần gửi sản phẩm", () => {
  const reply =
    "Dạ nếu mình đã dùng đúng hướng dẫn đủ 2 tuần mà vẫn chưa hiệu quả, bên em hỗ trợ hoàn tiền ạ. Mình gửi thông tin ngân hàng và clip nhúng hủy sản phẩm. Trường hợp này mình không cần giữ vỏ hộp hay gửi sản phẩm về ạ.";
  const result = evaluateConversationQuality({
    customerMessage:
      "Sau 2 tuần dùng mà nách vẫn ướt thì có hoàn tiền thật không? Hộp giấy vứt rồi thì nhân viên tới lấy hàng hay sao?",
    baseReply: reply,
    replies: [reply],
    skill: "direct-answer",
    intent: "order_support",
    asksDirectAnswer: true,
  });
  assert.equal(result.questionCoverageComplete, true);
  assert.equal(result.passed, true);
});

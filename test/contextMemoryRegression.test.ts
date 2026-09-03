import assert from "node:assert/strict";
import test from "node:test";
import { DemoChatService, type DemoChatResponse } from "../src/services/demoChat.js";

function run(chat: DemoChatService, sessionId: string, turns: readonly string[]): DemoChatResponse[] {
  return turns.map((turn) => chat.chat(sessionId, turn, {}, { actionExecutionMode: "multi_action" }));
}

test("kịch bản miền Nam giữ correction và không gán phản ứng của bạn cho khách", () => {
  const turns = [
    "ê shop, tui bị mh nách nh dữ lắm á, mùi thì k bao nhiêu mà áo cứ ướt quài",
    "da tui cũng hơi dễ xót, nhất là bữa nào mới wax xong",
    "tui gym tối 2 4 6 nữa, vậy xài cái này lúc nào ổn",
    "mà khoan, lịch đổi r nha, giờ tui gym sáng 3 5 7",
    "nhỏ e tui cũng tính xài, nó mới là da nhạy cảm nha, tui da bt thôi, chỉ wax xong mới hay xót",
    "giả sử tối wax xong tui quẹt luôn mà bị rát thì sao",
    "th bạn tui thì xài xong bị ngứa mấy ngày á, nghe cũng rén =))",
    "vậy case tui với th bạn tui khác nhau chỗ nào",
    "à hqua tui wax mà k xót gì hết nha",
    "chốt lại coi: vấn đề chính tui là gì, da sao, lịch gym hiện tại khi nào, tui từng bị ngứa do stopirex chưa?",
  ] as const;
  const responses = run(new DemoChatService(), "context-south", turns);

  assert.match(responses[0]!.reply, /mồ hôi nách nhiều.*ướt áo.*mùi không đáng kể/isu);
  assert.match(responses[1]!.reply, /không nhất thiết.*da nhạy cảm.*dễ xót sau wax/isu);
  assert.match(responses[2]!.reply, /tối thứ 2, 4, 6/iu);
  assert.match(responses[3]!.reply, /sáng thứ 3, 5, 7.*lịch cũ không còn/isu);
  assert.equal(responses[4]!.state.conversationMemory?.consultationFacts.sensitiveSkin, false);
  assert.match(responses[4]!.reply, /da mình bình thường.*người có da nhạy cảm là em/isu);
  assert.notEqual(responses[5]!.state.mode, "care");
  assert.notEqual(responses[6]!.state.mode, "care");
  assert.match(responses[6]!.reply, /người từng.*bị ngứa.*bạn của mình.*không phải mình/isu);
  assert.match(responses[7]!.reply, /Trường hợp của bạn:.*Bạn của bạn/isu);
  assert.match(responses[8]!.reply, /hôm qua.*không bị xót.*không xóa/isu);
  assert.match(responses[9]!.reply, /mồ hôi nách nhiều.*mùi không đáng kể/isu);
  assert.match(responses[9]!.reply, /da bạn bình thường.*dễ xót sau wax/isu);
  assert.match(responses[9]!.reply, /sáng thứ 3, 5, 7/iu);
  assert.match(responses[9]!.reply, /chưa từng nói mình bị ngứa.*Stopirex/isu);
  assert.match(responses[9]!.reply, /người từng bị ngứa là bạn của bạn/iu);
});

test("kịch bản vùng miền phân biệt lăn khác, review và sửa thời điểm cạo", () => {
  const turns = [
    "nách mình kiểu ra mồ hôi như tắm ấy, mùa lạnh đôi khi vẫn bị",
    "cơ mà mùi thì bình thường thôi, chủ yếu khó chịu vụ ướt áo",
    "bữa ni tui mới cạo á, chừ quẹt cái ni được chưa hè",
    "trước tui có nói da tui nhạy cảm chưa ta",
    "oke vậy nhớ là da tui bt nha, chỉ có lần xài lăn khác ngay sau cạo thì bị rát thôi",
    "tui copy review này cho coi nè: “xài Stopirex 3 hôm là tui bị ngứa với đỏ da”",
    "vậy tui từng bị đỏ da vì stopirex đúng không",
    "rứa vấn đề chính của tui là mùi hay mh?",
    "mà cái vụ mới cạo là hôm qua nha, nãy tui nói hôm nay nhầm á",
    "ê recap case tui thử coi, ngắn thôi: da gì, bị gì chính, cạo lúc nào, từng dị ứng stopirex chưa, với cái review đỏ da là của ai?",
  ] as const;
  const responses = run(new DemoChatService(), "context-regional", turns);

  assert.match(responses[0]!.reply, /mồ hôi nách nhiều/iu);
  assert.match(responses[1]!.reply, /ướt áo.*mùi không đáng kể/isu);
  assert.match(responses[2]!.reply, /mới cạo.*chưa dùng ngay/isu);
  assert.match(responses[3]!.reply, /chưa nói da mình nhạy cảm/iu);
  assert.notEqual(responses[4]!.state.mode, "care");
  assert.match(responses[4]!.reply, /da mình bình thường.*lăn khác.*không phải do Stopirex/isu);
  assert.notEqual(responses[5]!.state.mode, "care");
  assert.match(responses[5]!.reply, /review của người khác.*không phải trải nghiệm của mình/isu);
  assert.match(responses[6]!.reply, /^Chưa\./u);
  assert.match(responses[6]!.reply, /lăn khác.*review của người khác/isu);
  assert.match(responses[7]!.reply, /mồ hôi nách nhiều.*mùi không đáng kể/isu);
  assert.match(responses[8]!.reply, /cạo\/wax hôm qua.*không phải hôm nay/isu);
  assert.match(responses[9]!.reply, /Da bạn bình thường/iu);
  assert.match(responses[9]!.reply, /mồ hôi nách nhiều.*mùi không đáng kể/isu);
  assert.match(responses[9]!.reply, /cạo\/wax hôm qua/iu);
  assert.match(responses[9]!.reply, /chưa từng nói mình bị.*dị ứng do Stopirex/isu);
  assert.match(responses[9]!.reply, /review của người khác/iu);
});

test("sự cố Stopirex hiện tại của chính khách vẫn mở care", () => {
  const response = new DemoChatService().chat(
    "real-current-care",
    "Mình đã dùng Stopirex rồi và hiện đang bị ngứa rát",
    {},
    { actionExecutionMode: "multi_action" },
  );

  assert.equal(response.state.mode, "care");
  assert.equal(response.state.careIssue, "irritation");
});

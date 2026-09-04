import assert from "node:assert/strict";
import test from "node:test";
import { DemoChatService, type DemoChatResponse } from "../src/services/demoChat.js";
import { regionalContextTurns, southContextTurns } from "./fixtures/contextScenarios.js";

function run(chat: DemoChatService, sessionId: string, turns: readonly string[]): DemoChatResponse[] {
  return turns.map((turn) => chat.chat(sessionId, turn, {}, { actionExecutionMode: "multi_action" }));
}

test("kịch bản miền Nam giữ correction và không gán phản ứng của bạn cho khách", () => {
  const responses = run(new DemoChatService(), "context-south", southContextTurns);

  assert.match(responses[0]!.reply, /mồ hôi nách nhiều.*ướt áo.*mùi không đáng kể/isu);
  assert.match(responses[1]!.reply, /dễ xót.*mới wax.*chưa hẳn.*da nhạy cảm/isu);
  assert.match(responses[2]!.reply, /gym tối thứ 2, 4, 6.*lăn Stopirex buổi tối/isu);
  assert.match(responses[3]!.reply, /giờ mình gym sáng thứ 3, 5, 7/iu);
  assert.equal(currentFactValue(responses[3]!, "exercise_schedule"), "morning|3,5,7");
  assert.equal(supersededFactValues(responses[3]!, "exercise_schedule").includes("evening|2,4,6"), true);
  assert.equal(responses[4]!.state.conversationMemory?.consultationFacts.sensitiveSkin, false);
  assert.match(responses[4]!.reply, /da mình bình thường.*da nhạy cảm là em của mình/isu);
  assert.notEqual(responses[5]!.state.mode, "care");
  assert.match(responses[5]!.reply, /nếu.*bị rát.*tạm ngưng.*da hết khó chịu/isu);
  assert.notEqual(responses[6]!.state.mode, "care");
  assert.match(responses[6]!.reply, /người bị ngứa là bạn của mình.*mình chưa gặp/isu);
  assert.match(responses[7]!.reply, /Mình thì.*bạn của mình/isu);
  assert.match(responses[8]!.reply, /hôm qua.*không bị xót.*những lần khác/isu);
  assert.equal(currentFactValue(responses[8]!, "hair_removal_reaction"), "none");
  assert.match(responses[9]!.reply, /mồ hôi nách nhiều.*mùi không đáng kể/isu);
  assert.match(responses[9]!.reply, /da mình bình thường.*dễ xót sau wax/isu);
  assert.match(responses[9]!.reply, /sáng thứ 3, 5, 7/iu);
  assert.match(responses[9]!.reply, /mình chưa bị ngứa.*Stopirex/isu);
  assert.match(responses[9]!.reply, /người từng bị ngứa là bạn của mình/iu);
});

test("kịch bản vùng miền phân biệt lăn khác, review và sửa thời điểm cạo", () => {
  const responses = run(new DemoChatService(), "context-regional", regionalContextTurns);

  assert.match(responses[0]!.reply, /mồ hôi nách.*khá nhiều/iu);
  assert.match(responses[1]!.reply, /ướt áo.*mùi không đáng kể/isu);
  assert.match(responses[2]!.reply, /mới cạo.*chưa lăn ngay/isu);
  assert.match(responses[3]!.reply, /chưa nha.*chỉ mới nói vừa cạo/isu);
  assert.notEqual(responses[4]!.state.mode, "care");
  assert.match(responses[4]!.reply, /da mình bình thường.*lăn khác.*không liên quan Stopirex/isu);
  assert.notEqual(responses[5]!.state.mode, "care");
  assert.match(responses[5]!.reply, /review của người khác.*mình chưa gặp/isu);
  assert.match(responses[6]!.reply, /^Chưa nha/iu);
  assert.match(responses[6]!.reply, /lăn khác.*review của người khác/isu);
  assert.match(responses[7]!.reply, /mồ hôi nách nhiều.*mùi không đáng kể/isu);
  assert.match(responses[8]!.reply, /mình cạo\/wax hôm qua/isu);
  assert.equal(currentFactValue(responses[8]!, "hair_removal_time"), "yesterday");
  assert.equal(supersededFactValues(responses[8]!, "hair_removal_time").includes("today"), true);
  assert.match(responses[9]!.reply, /Da mình bình thường/iu);
  assert.match(responses[9]!.reply, /mồ hôi nách nhiều.*mùi không đáng kể/isu);
  assert.match(responses[9]!.reply, /cạo\/wax gần nhất là hôm qua/iu);
  assert.match(responses[9]!.reply, /mình chưa bị.*dị ứng do Stopirex/isu);
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

function currentFactValue(response: DemoChatResponse, predicate: string): unknown {
  return response.state.conversationMemory?.factLedger?.facts.find(
    (fact) => fact.subjectId === "self" && fact.predicate === predicate && fact.status === "current",
  )?.value;
}

function supersededFactValues(response: DemoChatResponse, predicate: string): unknown[] {
  return (
    response.state.conversationMemory?.factLedger?.facts
      .filter(
        (fact) => fact.subjectId === "self" && fact.predicate === predicate && fact.status === "superseded",
      )
      .map((fact) => fact.value) ?? []
  );
}

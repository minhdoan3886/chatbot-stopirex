import assert from "node:assert/strict";
import test from "node:test";
import {
  assessStopirexResponseStyle,
  assertStopirexResponseStyle,
} from "../src/domain/responseStylePolicy.js";
import { DemoChatService, type DemoChatResponse } from "../src/services/demoChat.js";
import { regionalContextTurns, southContextTurns } from "./fixtures/contextScenarios.js";

function run(sessionId: string, turns: readonly string[]): DemoChatResponse[] {
  const chat = new DemoChatService();
  return turns.map((turn) => chat.chat(sessionId, turn, {}, { actionExecutionMode: "multi_action" }));
}

test("Response Style Policy ẩn memory operations ở cả hai kịch bản", () => {
  const conversations = [
    { turns: southContextTurns, responses: run("natural-south", southContextTurns) },
    { turns: regionalContextTurns, responses: run("natural-regional", regionalContextTurns) },
  ];

  for (const conversation of conversations) {
    conversation.responses.forEach((response, index) => {
      const assessment = assessStopirexResponseStyle(conversation.turns[index]!, response.reply);
      assert.equal(assessment.memoryMetaLanguageCount, 0, response.reply);
      assert.equal(assessment.semicolonCount, 0, response.reply);
      assert.equal(assessment.unnecessaryRecap, false, response.reply);
      if (!assessment.explicitDetailedRequest) {
        assert.ok(assessment.sentenceCount <= 3, response.reply);
        assert.ok(response.reply.length <= 320, response.reply);
      }
      assert.doesNotMatch(
        response.reply,
        /(?:không phải mình|lịch cũ|thông tin cũ|ghi nhầm|tách riêng|superseded|Fact Ledger|state)/iu,
      );
    });
  }
});

test("chat có đủ phản ứng hội thoại nhưng không cố tình viết sai", () => {
  const responses = [
    ...run("reaction-south", southContextTurns),
    ...run("reaction-regional", regionalContextTurns),
  ];
  const conversationalTurns = responses.filter(
    (response) => assessStopirexResponseStyle("", response.reply).conversationalOpening,
  );

  assert.ok(
    conversationalTurns.length >= 10,
    `chỉ có ${conversationalTurns.length}/20 lượt có phản ứng tự nhiên`,
  );
  assert.doesNotMatch(responses.map((response) => response.reply).join("\n"), /\b(?:khum|z|rùi|hem)\b/iu);
});

test("chỉ recap đầy đủ khi khách yêu cầu", () => {
  const south = run("recap-south", southContextTurns);
  const regional = run("recap-regional", regionalContextTurns);

  assert.match(south[9]!.reply, /^Chốt lại nha:/u);
  assert.match(regional[9]!.reply, /^Chốt lại nha:/u);
  assert.ok(assessStopirexResponseStyle(southContextTurns[9], south[9]!.reply).explicitDetailedRequest);
  assert.ok(assessStopirexResponseStyle(regionalContextTurns[9], regional[9]!.reply).explicitDetailedRequest);

  for (const [turns, responses] of [
    [southContextTurns.slice(0, 9), south.slice(0, 9)],
    [regionalContextTurns.slice(0, 9), regional.slice(0, 9)],
  ] as const) {
    responses.forEach((response, index) => {
      const assessment = assessStopirexResponseStyle(turns[index]!, response.reply);
      assert.equal(assessment.unnecessaryRecap, false, response.reply);
    });
  }
});

test("policy nhận diện đúng câu làm lộ memory engine", () => {
  const assessment = assessStopirexResponseStyle(
    "mà khoan, lịch đổi rồi nha",
    "Em cập nhật lịch mới là sáng 3 5 7, lịch cũ không còn hiệu lực. Điều này không xóa thông tin trước đó.",
  );

  assert.equal(assessment.memoryMetaLanguageCount, 3);
  assert.equal(assessment.conversationalOpening, false);
  assert.throws(
    () =>
      assertStopirexResponseStyle({
        customerMessage: "mà khoan, lịch đổi rồi nha",
        response:
          "Em cập nhật lịch mới là sáng 3 5 7, lịch cũ không còn hiệu lực. Điều này không xóa thông tin trước đó.",
        strictFactResponse: true,
      }),
    { name: "ResponseStylePolicyError" },
  );
});

test("policy vẫn cho phép xác nhận nghiệp vụ không phải meta-memory", () => {
  assert.doesNotThrow(() =>
    assertStopirexResponseStyle({
      customerMessage: "SĐT của mình là 0912345678",
      response: "Dạ em đã ghi nhận thông tin mình gửi ạ.",
    }),
  );
});

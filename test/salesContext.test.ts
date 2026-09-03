import assert from "node:assert/strict";
import test from "node:test";
import { DemoChatService } from "../src/services/demoChat.js";

test("bộ nhớ phản đối giá giữ đối thủ và evidence có cấu trúc", () => {
  const chat = new DemoChatService();
  const raw = "Hơi mắc nhể. Trc m mua cái Etiaxil trên Shopee hơn 100k";
  const response = chat.chat("sales-objection-memory", raw, {
    slots: {},
    intent: "price_objection",
    topic: "comparison",
    confidence: 0.99,
    needsClarification: false,
    evidence: ["Hơi mắc nhể", "Etiaxil"],
    newAngle: "mechanism",
    rejectedArguments: ["duration_or_cost"],
    actions: [
      {
        type: "answer_question",
        topic: "comparison",
        confidence: 0.99,
        evidence: ["Etiaxil"],
        source: "llm",
      },
    ],
  });

  assert.deepEqual(response.state.conversationMemory?.salesContext?.objections, [
    {
      type: "price",
      comparedWith: "Etiaxil",
      status: "open",
      evidence: raw,
      sourceTurn: 1,
    },
  ]);
  assert.ok(response.state.conversationMemory?.usedArguments.includes("mechanism"));
  assert.ok(response.state.conversationMemory?.rejectedArguments.includes("duration_or_cost"));
});

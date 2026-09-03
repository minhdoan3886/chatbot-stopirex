import assert from "node:assert/strict";
import test from "node:test";
import { dialogueModeFor, initialDialogueState, reduceDialogueState } from "../src/domain/dialogueState.js";

test("DialogueState ghi pending ask và dùng action mới để tiêu thụ expected input", () => {
  const asked = reduceDialogueState(initialDialogueState(), {
    type: "assistant_turn_committed",
    ctaId: "ask_phone",
    requestedSlots: ["phone"],
    answeredFactIds: [],
    unresolvedTopics: [],
    turn: 2,
    goal: "collect_missing_order_fields",
  });
  assert.equal(asked.pendingAsk?.requestedSlots[0], "phone");
  assert.equal(asked.expectedInputs[0]?.kind, "phone");

  const answered = reduceDialogueState(asked, {
    type: "user_acts_observed",
    mode: "ordering",
    acts: [
      {
        type: "update_order",
        fields: { phone: "0988777666" },
        confidence: 1,
        evidence: ["0988777666"],
        source: "llm",
      },
    ],
  });
  assert.deepEqual(answered.expectedInputs, []);
  assert.equal(answered.lastUserActs[0]?.type, "update_order");
});

test("Dialogue mode lấy theo action thực tế thay vì primary intent", () => {
  assert.equal(
    dialogueModeFor({
      selectedQuantity: 2,
      botPaused: false,
      actions: [
        {
          type: "answer_question",
          topic: "delivery",
          confidence: 1,
          evidence: ["ship mấy ngày"],
          source: "llm",
        },
      ],
    }),
    "ordering",
  );
});

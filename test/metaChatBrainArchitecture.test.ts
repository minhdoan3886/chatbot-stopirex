import assert from "node:assert/strict";
import test from "node:test";
import { DemoChatService } from "../src/services/demoChat.js";
import { CodexLlmBridge } from "../src/services/codexLlm.js";
import { StructuredLogger } from "../src/services/logger.js";
import { MetaChatBrain } from "../src/services/metaChatBrain.js";

test("mỗi turn phát audit về state, action và nguồn câu trả lời cuối", async () => {
  const records: Array<Record<string, unknown>> = [];
  const logger = new StructuredLogger((line) => {
    records.push(JSON.parse(line) as Record<string, unknown>);
  });
  const brain = new MetaChatBrain(
    new DemoChatService(),
    new CodexLlmBridge({ enabled: false }),
    logger,
  );

  const result = await brain.reply({
    sessionId: "architecture-audit",
    text: "Cho mình xem giá",
    traceId: "trace-architecture-audit",
  });

  assert.equal(result.state.responseDecision?.source, "llm_disabled");
  assert.equal(result.state.responseDecision?.outcome, "allow");
  assert.ok((result.state.stateVersion ?? 0) >= 1);
  const audit = records.find((record) => record.event === "conversation_turn_audit");
  assert.equal(audit?.finalResponseSource, "llm_disabled");
  assert.equal(audit?.responseOutcome, "allow");
  assert.equal(audit?.stateVersionAfter, result.state.stateVersion);
});


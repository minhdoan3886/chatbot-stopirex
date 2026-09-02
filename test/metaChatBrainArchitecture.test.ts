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

test("audit transaction luôn có mutation receipt khi order fields thay đổi", async () => {
  const records: Array<Record<string, unknown>> = [];
  const logger = new StructuredLogger((line) => records.push(JSON.parse(line) as Record<string, unknown>));
  const brain = new MetaChatBrain(new DemoChatService(), new CodexLlmBridge({ enabled: false }), logger);

  await brain.reply({ sessionId: "audit-mutation", text: "cho mình 1 lọ" });
  const audit = records.find(
    (record) =>
      record.event === "conversation_turn_audit" &&
      Array.isArray(record.orderChangedFields) &&
      record.orderChangedFields.length > 0,
  );
  assert.ok(audit);
  assert.ok(Array.isArray(audit.acceptedOrderMutations));
  assert.ok((audit.acceptedOrderMutations as unknown[]).length > 0);
  const mutation = (audit.acceptedOrderMutations as Array<Record<string, unknown>>)[0];
  assert.equal(mutation?.source, "reconciled_order_reducer");
  assert.match(String(mutation?.evidenceRef), /^sha256:/u);
  assert.ok("from" in (mutation ?? {}));
  assert.ok("toMasked" in (mutation ?? {}));
});

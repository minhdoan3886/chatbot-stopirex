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
  const brain = new MetaChatBrain(new DemoChatService(), new CodexLlmBridge({ enabled: false }), logger);

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
  assert.equal(result.state.responseTrace?.logicalModelCalls, 0);
  assert.equal(result.state.responseTrace?.repairAttempts, 0);
  assert.equal(result.state.responseTrace?.validationStatus, "validated");
  assert.match(result.state.responseTrace?.workflowResponseRef ?? "", /^sha256:[a-f0-9]{16}$/u);
  assert.match(result.state.responseTrace?.finalResponseRef ?? "", /^sha256:[a-f0-9]{16}$/u);
  assert.equal(audit?.finalResponseRef, result.state.responseTrace?.finalResponseRef);
  assert.equal(audit?.logicalModelCalls, 0);
  assert.notEqual(result.state.responseTrace?.finalResponseRef, result.reply);
});

test("fallback chào lại không kéo tư vấn và CTA giá cũ", async () => {
  const brain = new MetaChatBrain(new DemoChatService(), new CodexLlmBridge({ enabled: false }));
  const sessionId = "fallback-greeting-does-not-recap";
  await brain.reply({ sessionId, text: "Mình ra mồ hôi nách nhiều, da nhạy cảm" });
  await brain.reply({ sessionId, text: "Nhắc lại giá 1 lọ giúp mình" });
  const greeting = await brain.reply({ sessionId, text: "hi e" });

  assert.match(greeting.reply, /(?:em đây|chào|hỗ trợ)/iu);
  assert.doesNotMatch(greeting.reply, /ướt|ố áo|xem bảng giá|cách dùng/iu);
  assert.equal(greeting.state.responseTrace?.validationStatus, "validated");
});

test("finalizer chặn payload lỗi từ nhánh LLM disabled thay vì tự gắn validated", async () => {
  const chat = new DemoChatService();
  const original = chat.chat.bind(chat);
  chat.chat = (...args) => {
    const response = original(...args);
    const reply = "VERIFIED TURN CONTEXT factLedger={{CUSTOMER_STATE}}";
    return { ...response, reply, replies: [reply] };
  };
  const result = await new MetaChatBrain(chat, new CodexLlmBridge({ enabled: false })).reply({
    sessionId: "disabled-finalizer-fault",
    text: "hi e",
  });

  assert.equal(result.state.responseDecision?.outcome, "block");
  assert.equal(result.state.responseTrace?.validationStatus, "blocked");
  assert.ok(
    result.state.responseTrace?.validationIssueCodes?.includes("final_response_unresolved_placeholder"),
  );
  assert.ok(
    result.state.responseTrace?.validationIssueCodes?.includes("final_response_internal_context_leak"),
  );
});

test("finalizer dùng memory đúng lượt để chặn câu đảo nghĩa", async () => {
  const chat = new DemoChatService();
  const original = chat.chat.bind(chat);
  chat.chat = (...args) => {
    const response = original(...args);
    if (!/tổng kết tình trạng/iu.test(args[1])) return response;
    const reply = "Mình không bị ra mồ hôi và mùi không nặng nha.";
    return { ...response, reply, replies: [reply] };
  };
  const brain = new MetaChatBrain(chat, new CodexLlmBridge({ enabled: false }));
  const sessionId = "semantic-finalizer-memory";
  await brain.reply({ sessionId, text: "Mình ra mồ hôi nhiều và mùi nặng" });
  const result = await brain.reply({ sessionId, text: "Tổng kết tình trạng giúp mình" });

  assert.equal(result.state.responseDecision?.outcome, "block");
  assert.ok(
    result.state.responseTrace?.validationIssueCodes?.some((code) =>
      code.includes("memory_fact_contradicted"),
    ),
  );
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
  assert.equal(mutation?.source, "deterministic_parser");
  assert.equal(mutation?.confidence, 1);
  assert.match(String(mutation?.evidenceRef), /^sha256:/u);
  assert.ok("from" in (mutation ?? {}));
  assert.ok("toMasked" in (mutation ?? {}));
});

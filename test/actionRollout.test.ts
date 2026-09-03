import assert from "node:assert/strict";
import test from "node:test";
import { compareActionRollout, selectActionExecutionMode } from "../src/domain/actionRollout.js";
import type { SemanticUnderstanding } from "../src/domain/consultation.js";
import { DemoChatService } from "../src/services/demoChat.js";
import { evaluateActionRolloutGate } from "../src/services/operationsDashboard.js";

test("shadow luôn giữ legacy, canary phân bổ ổn định theo phiên", () => {
  assert.equal(
    selectActionExecutionMode({ mode: "shadow", canaryPercent: 100, sessionId: "same" }),
    "legacy",
  );
  const first = selectActionExecutionMode({
    mode: "canary",
    canaryPercent: 25,
    sessionId: "customer-123",
  });
  const second = selectActionExecutionMode({
    mode: "canary",
    canaryPercent: 25,
    sessionId: "customer-123",
  });
  assert.equal(first, second);
  assert.equal(
    selectActionExecutionMode({ mode: "enabled", canaryPercent: 0, sessionId: "same" }),
    "multi_action",
  );
});

test("comparison xác nhận hai biến thể cùng giữ hành động mua và candidate trả đủ đa ý", () => {
  const legacyChat = new DemoChatService();
  const candidateChat = new DemoChatService();
  const semantic = {
    slots: {},
    intent: "buying" as const,
    topic: "effectiveness" as const,
    asksDirectAnswer: true,
    confidence: 0.99,
    evidence: ["nếu đúng như lời nói", "cho mình 1 lọ"],
    actions: [
      {
        type: "answer_question" as const,
        topic: "effectiveness" as const,
        confidence: 0.98,
        evidence: ["nếu đúng như lời nói"],
        source: "llm" as const,
      },
      {
        type: "select_quantity" as const,
        quantity: 1,
        confidence: 0.99,
        evidence: ["cho mình 1 lọ"],
        source: "llm" as const,
      },
      {
        type: "continue_order_collection" as const,
        confidence: 0.98,
        evidence: ["cho mình 1 lọ"],
        source: "llm" as const,
      },
    ],
  } satisfies SemanticUnderstanding;
  const text = "Nếu đúng như lời nói thì cho mình 1 lọ";
  const legacy = legacyChat.chat("compare", text, semantic, {
    actionExecutionMode: "legacy",
  });
  const candidate = candidateChat.chat("compare", text, semantic, {
    actionExecutionMode: "multi_action",
  });
  const result = compareActionRollout({
    mode: "shadow",
    liveVariant: "legacy",
    legacy,
    candidate,
  });

  assert.equal(result.intentMismatch, false);
  assert.equal(result.pipelineMismatch, false);
  assert.equal(result.replyMismatch, true);
  assert.equal(result.candidateHasMultipleActions, true);
});

test("quality gate chỉ pass khi đủ mẫu và các tỷ lệ dưới ngưỡng", () => {
  const base = {
    sampleSize24h: 100,
    multiActionLive24h: 10,
    intentMismatchRate: 0.02,
    pipelineMismatchRate: 0.01,
    handoffMismatchRate: 0.005,
    clarificationMismatchRate: 0.02,
    replyMismatchRate: 0.2,
    rejectedActionRate: 0.1,
    conflictRate: 0.01,
    multiActionMessageRate: 0.15,
  };
  assert.equal(evaluateActionRolloutGate(base).gateStatus, "pass");
  assert.equal(evaluateActionRolloutGate({ ...base, handoffMismatchRate: 0.02 }).gateStatus, "blocked");
  assert.equal(evaluateActionRolloutGate({ ...base, sampleSize24h: 99 }).gateStatus, "collecting");
});

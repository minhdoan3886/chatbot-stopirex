import assert from "node:assert/strict";
import test from "node:test";
import {
  compareActionRollout,
  selectActionExecutionMode,
} from "../src/domain/actionRollout.js";
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

test("comparison phát hiện legacy bỏ mất hành động mua trong câu đa ý", () => {
  const legacyChat = new DemoChatService();
  const candidateChat = new DemoChatService();
  const semantic = {
    slots: {},
    intent: "product_effect" as const,
    topic: "effectiveness" as const,
    asksDirectAnswer: true,
    confidence: 0.99,
  };
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

  assert.equal(result.intentMismatch, true);
  assert.equal(result.pipelineMismatch, true);
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
  assert.equal(
    evaluateActionRolloutGate({ ...base, handoffMismatchRate: 0.02 }).gateStatus,
    "blocked",
  );
  assert.equal(
    evaluateActionRolloutGate({ ...base, sampleSize24h: 99 }).gateStatus,
    "collecting",
  );
});


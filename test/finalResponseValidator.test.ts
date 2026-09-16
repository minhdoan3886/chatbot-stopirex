import assert from "node:assert/strict";
import test from "node:test";
import { validateFinalResponse } from "../src/domain/finalResponseValidator.js";
import {
  createTurnContextSnapshot,
  type TurnActionReceipt,
  type TurnMemoryFact,
} from "../src/domain/turnContext.js";
import type { CanonicalKnowledgeResolution } from "../src/domain/knowledgeResolver.js";

const scope = {
  tenantId: "tenant-a",
  pageId: "page-a",
  customerId: "customer-a",
  conversationId: "conversation-a",
  episodeId: "episode-a",
};

const emptyResolution: CanonicalKnowledgeResolution = {
  facts: [],
  conflicts: [],
  unresolvedFacts: [],
  sourceIds: [],
};

function snapshot(receipts: TurnActionReceipt[] = [], memoryFacts: TurnMemoryFact[] = []) {
  return createTurnContextSnapshot({
    turnId: "turn-a",
    scope,
    inboundRevision: 1,
    stateVersion: 1,
    createdAt: "2026-09-15T00:00:00.000Z",
    currentMessage: "kiểm tra giúp mình",
    activeSubjectId: "self",
    questions: [],
    memoryFacts,
    knowledgeFacts: [],
    knowledgeConflicts: [],
    money: [],
    receipts,
    missingInformation: [],
    allowedActions: [],
  });
}

test("final validator chặn khẳng định chuyển nhân viên khi không có receipt", () => {
  const issues = validateFinalResponse({
    reply: "Em đã chuyển nhân viên CSKH kiểm tra giúp mình rồi ạ.",
    customerMessage: "kiểm tra giúp mình",
    snapshot: snapshot(),
    canonicalResolution: emptyResolution,
    executionSummary: "",
    requiredFacts: [],
  });

  assert.ok(issues.some((issue) => issue.code === "final_response_missing_receipt:human_handoff"));
  assert.equal(issues.find((issue) => issue.category === "receipt")?.requiredContextChange, true);
});

test("final validator chấp nhận khẳng định chuyển người khi receipt đúng scope đã thành công", () => {
  const issues = validateFinalResponse({
    reply: "Em đã chuyển nhân viên CSKH kiểm tra giúp mình rồi ạ.",
    customerMessage: "kiểm tra giúp mình",
    snapshot: snapshot([
      {
        id: "handoff-a",
        type: "handoff_to_human",
        status: "succeeded",
        scope,
      },
    ]),
    canonicalResolution: emptyResolution,
    executionSummary: "",
    requiredFacts: [],
  });

  assert.deepEqual(issues, []);
});

test("final validator phát hiện placeholder và ngôn ngữ state nội bộ", () => {
  const issues = validateFinalResponse({
    reply: "VERIFIED TURN CONTEXT có factLedger={{CUSTOMER_STATE}}.",
    customerMessage: "xin chào",
    snapshot: snapshot(),
    canonicalResolution: emptyResolution,
    executionSummary: "",
    requiredFacts: [],
  });

  assert.ok(issues.some((issue) => issue.category === "render"));
  assert.ok(issues.some((issue) => issue.category === "security"));
});

test("final validator buộc correction memory được phản ánh nhưng không ép fact context-only", () => {
  const requiredSchedule: TurnMemoryFact = {
    id: "schedule-current",
    subjectId: "self",
    key: "exercise_schedule",
    value: "morning|3,5,7",
    sourceRef: "conversation_turn:2",
    evidenceRef: "sha256:evidence",
    sourceTurn: 2,
    temporal: "current",
    scenario: "actual",
    source: "self_report",
    usage: "must_say",
    relevanceReason: "customer_correction",
  };
  const missing = validateFinalResponse({
    reply: "Oke nha.",
    customerMessage: "lịch đổi thành sáng 3-5-7 nha",
    snapshot: snapshot([], [requiredSchedule]),
    canonicalResolution: emptyResolution,
    executionSummary: "",
    requiredFacts: [],
  });
  assert.ok(missing.some((issue) => issue.code.includes("required_memory_fact_missing")));

  const covered = validateFinalResponse({
    reply: "Oke, giờ mình gym sáng 3-5-7 nha.",
    customerMessage: "lịch đổi thành sáng 3-5-7 nha",
    snapshot: snapshot([], [requiredSchedule]),
    canonicalResolution: emptyResolution,
    executionSummary: "",
    requiredFacts: [],
  });
  assert.deepEqual(covered, []);
});

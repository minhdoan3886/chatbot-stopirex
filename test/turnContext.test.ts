import assert from "node:assert/strict";
import test from "node:test";
import {
  initialConversationFactLedger,
  reduceConversationFactLedger,
} from "../src/domain/conversationFacts.js";
import { projectMemoryForTurn } from "../src/domain/memoryProjection.js";
import { createTurnContextSnapshot } from "../src/domain/turnContext.js";

const scope = {
  tenantId: "tenant-a",
  pageId: "page-a",
  customerId: "customer-a",
  conversationId: "conversation-a",
  episodeId: "episode-a",
};

test("turn context đóng băng dữ kiện và chặn receipt khác scope", () => {
  const snapshot = createTurnContextSnapshot({
    turnId: "turn-a",
    scope,
    inboundRevision: 1,
    stateVersion: 2,
    createdAt: "2026-09-15T00:00:00.000Z",
    currentMessage: "giá bao nhiêu",
    activeSubjectId: "self",
    questions: ["price"],
    memoryFacts: [],
    knowledgeFacts: [],
    knowledgeConflicts: [],
    money: [],
    receipts: [],
    missingInformation: [],
    allowedActions: [],
  });

  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot.scope), true);
  assert.throws(
    () =>
      createTurnContextSnapshot({
        ...snapshot,
        receipts: [
          { id: "receipt-x", type: "order", status: "succeeded", scope: { ...scope, pageId: "page-b" } },
        ],
      }),
    /receipt_scope_mismatch/u,
  );
});

test("memory projection dùng correction hiện hành và chỉ mở lịch sử khi khách hỏi", () => {
  const first = reduceConversationFactLedger({
    ledger: initialConversationFactLedger(),
    raw: "Tui gym tối 2 4 6",
    turn: 1,
    occurredAt: new Date("2026-09-14T01:00:00.000Z"),
  });
  const corrected = reduceConversationFactLedger({
    ledger: first.ledger,
    raw: "Lịch đổi rồi nha, giờ tui gym sáng 3 5 7",
    turn: 2,
    occurredAt: new Date("2026-09-15T01:00:00.000Z"),
  });

  const current = projectMemoryForTurn({ ledger: corrected.ledger, customerMessage: "hôm nay dùng sao?" });
  assert.deepEqual(
    current.facts.filter((fact) => fact.key === "exercise_schedule").map((fact) => fact.value),
    ["morning|3,5,7"],
  );
  assert.ok(current.excluded.some((item) => item.reason === "superseded_not_requested"));

  const historical = projectMemoryForTurn({
    ledger: corrected.ledger,
    customerMessage: "lịch cũ của mình là gì?",
  });
  assert.deepEqual(
    historical.facts.filter((fact) => fact.key === "exercise_schedule").map((fact) => fact.value),
    ["evening|2,4,6", "morning|3,5,7"],
  );
});

test("memory projection không gán da của em gái cho khách", () => {
  const result = reduceConversationFactLedger({
    ledger: initialConversationFactLedger(),
    raw: "Nó mới là da nhạy cảm nha, tui da bt thôi",
    turn: 1,
  });
  const self = projectMemoryForTurn({ ledger: result.ledger, customerMessage: "da mình dùng sao?" });
  const sibling = self.facts.find((fact) => fact.subjectId === "sibling-1");
  assert.equal(sibling?.usage, "context_only");
  assert.equal(self.facts.find((fact) => fact.subjectId === "self")?.usage, "may_say");

  const forSibling = projectMemoryForTurn({
    ledger: result.ledger,
    customerMessage: "em gái mình dùng sao?",
  });
  assert.equal(forSibling.facts.find((fact) => fact.subjectId === "sibling-1")?.usage, "may_say");
});

test("fact ledger từ chối value lịch không được evidence hỗ trợ", () => {
  const result = reduceConversationFactLedger({
    ledger: initialConversationFactLedger(),
    raw: "Mình gym sáng 3-5-7",
    turn: 1,
    semanticFacts: [
      {
        field: "exercise_schedule",
        value: "morning|2,4,6",
        target: "self",
        evidence: ["Mình gym sáng 3-5-7"],
        confidence: 0.99,
      },
    ],
  });

  assert.ok(!result.ledger.facts.some((fact) => fact.value === "morning|2,4,6"));
  assert.ok(result.ledger.facts.some((fact) => fact.value === "morning|3,5,7"));
});

test("fact ledger không hiểu rất nhiều thành rát da", () => {
  const raw = "Mình đổ mồ hôi rất nhiều và da nhạy cảm";
  const result = reduceConversationFactLedger({
    ledger: initialConversationFactLedger(),
    raw,
    turn: 1,
    semanticFacts: [
      {
        field: "product_reaction",
        value: "irritation",
        target: "self",
        evidence: [raw],
        confidence: 0.99,
      },
    ],
  });

  assert.ok(!result.ledger.facts.some((fact) => fact.predicate === "product_reaction"));
});

test("legacy fact tương đối thiếu eventAt không được dùng như sự kiện hiện tại", () => {
  const projection = projectMemoryForTurn({
    ledger: {
      subjects: [{ id: "self", type: "self", label: "bạn" }],
      facts: [
        {
          id: "legacy-yesterday",
          subjectId: "self",
          predicate: "hair_removal_time",
          value: "yesterday",
          temporal: "yesterday",
          scenario: "past",
          source: "self_report",
          polarity: "positive",
          confidence: 1,
          evidence: "hôm qua mình cạo",
          sourceTurn: 1,
          status: "current",
        },
      ],
    },
    customerMessage: "giờ dùng được chưa?",
    at: new Date("2026-09-15T00:00:00.000Z"),
  });

  assert.deepEqual(projection.facts, []);
  assert.deepEqual(projection.excluded, [
    { factId: "legacy-yesterday", reason: "legacy_relative_time_unknown" },
  ]);
});

test("nhắc lại giá không biến toàn bộ hồ sơ cá nhân thành must_say", () => {
  const ledger = {
    subjects: [{ id: "self", type: "self" as const, label: "bạn" }],
    facts: [
      {
        id: "skin-sensitive",
        subjectId: "self",
        predicate: "skin_type" as const,
        value: "sensitive",
        product: "unknown" as const,
        temporal: "current" as const,
        scenario: "actual" as const,
        source: "self_report" as const,
        polarity: "positive" as const,
        confidence: 1,
        evidence: "da mình nhạy cảm",
        sourceTurn: 1,
        recordedAt: "2026-09-01T00:00:00.000Z",
        status: "current" as const,
      },
    ],
  };
  const projection = projectMemoryForTurn({
    ledger,
    customerMessage: "Nhắc lại giá 1 lọ giúp mình",
    at: new Date("2026-09-16T00:00:00.000Z"),
  });

  assert.ok(projection.facts.every((fact) => fact.usage === "context_only"));
});

test("projection giữ product polarity status và hạ relative fact đã cũ về context_only", () => {
  const ledger = {
    subjects: [{ id: "self", type: "self" as const, label: "bạn" }],
    facts: [
      {
        id: "old-shave",
        subjectId: "self",
        predicate: "hair_removal_time" as const,
        value: "today",
        product: "unknown" as const,
        temporal: "today" as const,
        scenario: "actual" as const,
        source: "self_report" as const,
        polarity: "positive" as const,
        confidence: 1,
        evidence: "hôm nay mình cạo",
        sourceTurn: 1,
        recordedAt: "2026-09-01T00:00:00.000Z",
        eventAt: "2026-09-01T00:00:00.000Z",
        status: "current" as const,
      },
      {
        id: "other-rollon-irritation",
        subjectId: "self",
        predicate: "product_reaction" as const,
        value: "irritation",
        product: "other_rollon" as const,
        temporal: "current" as const,
        scenario: "actual" as const,
        source: "self_report" as const,
        polarity: "positive" as const,
        confidence: 1,
        evidence: "lăn loại khác bị rát",
        sourceTurn: 1,
        recordedAt: "2026-09-01T00:00:00.000Z",
        status: "current" as const,
      },
    ],
  };
  const projection = projectMemoryForTurn({
    ledger,
    customerMessage: "giờ dùng sao?",
    at: new Date("2026-09-16T00:00:00.000Z"),
  });
  const oldShave = projection.facts.find((fact) => fact.id === "old-shave");
  const reaction = projection.facts.find((fact) => fact.id === "other-rollon-irritation");

  assert.equal(oldShave?.usage, "context_only");
  assert.equal(oldShave?.temporal, "past");
  assert.equal(reaction?.product, "other_rollon");
  assert.equal(reaction?.polarity, "positive");
  assert.equal(reaction?.status, "current");
});

test("đại từ tiếp nối dùng active subject đã resolve thay vì tự gán self", () => {
  const projection = projectMemoryForTurn({
    ledger: {
      subjects: [
        { id: "self", type: "self", label: "bạn" },
        { id: "sibling-1", type: "sibling", label: "em gái" },
      ],
      facts: [
        {
          id: "sibling-sensitive",
          subjectId: "sibling-1",
          predicate: "skin_type",
          value: "sensitive",
          product: "unknown",
          temporal: "current",
          scenario: "actual",
          source: "third_party_report",
          polarity: "positive",
          confidence: 1,
          evidence: "em gái mình da nhạy cảm",
          sourceTurn: 1,
          status: "current",
        },
      ],
    },
    customerMessage: "Em ấy dùng sao?",
    activeSubjectId: "sibling-1",
  });

  assert.equal(projection.activeSubjectId, "sibling-1");
  assert.equal(projection.facts[0]?.usage, "may_say");
});

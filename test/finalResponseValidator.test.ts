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

function snapshot(
  receipts: TurnActionReceipt[] = [],
  memoryFacts: TurnMemoryFact[] = [],
  activeSubjectId = "self",
) {
  return createTurnContextSnapshot({
    turnId: "turn-a",
    scope,
    inboundRevision: 1,
    stateVersion: 1,
    createdAt: "2026-09-15T00:00:00.000Z",
    currentMessage: "kiểm tra giúp mình",
    activeSubjectId,
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
        stage: "completed",
        operationId: "turn-a",
        resourceRef: "handoff:conversation-a",
        resultVersion: "2",
        sourceVersion: "2",
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

test("final validator phát hiện phủ định trái memory da nhạy cảm", () => {
  const sensitive: TurnMemoryFact = {
    id: "skin-sensitive",
    subjectId: "self",
    key: "skin_type",
    value: "sensitive",
    product: "unknown",
    polarity: "positive",
    status: "current",
    sourceRef: "conversation_turn:1",
    evidenceRef: "sha256:sensitive",
    sourceTurn: 1,
    temporal: "current",
    scenario: "actual",
    source: "self_report",
    usage: "must_say",
    relevanceReason: "customer_requested_condition_recap",
  };
  const issues = validateFinalResponse({
    reply: "Da mình không nhạy cảm nha.",
    customerMessage: "Da mình thuộc loại nào?",
    snapshot: snapshot([], [sensitive]),
    canonicalResolution: emptyResolution,
    executionSummary: "",
    requiredFacts: [],
  });

  assert.ok(issues.some((issue) => issue.code.includes("memory_fact_contradicted")));
});

test("final validator không dùng fact nói về em gái để chứng minh fact của khách", () => {
  const sensitive: TurnMemoryFact = {
    id: "skin-sensitive",
    subjectId: "self",
    key: "skin_type",
    value: "sensitive",
    product: "unknown",
    polarity: "positive",
    status: "current",
    sourceRef: "conversation_turn:1",
    evidenceRef: "sha256:sensitive",
    sourceTurn: 1,
    temporal: "current",
    scenario: "actual",
    source: "self_report",
    usage: "must_say",
    relevanceReason: "customer_requested_condition_recap",
  };
  const issues = validateFinalResponse({
    reply: "Em gái mình da nhạy cảm nha.",
    customerMessage: "Da mình thuộc loại nào?",
    snapshot: snapshot([], [sensitive]),
    canonicalResolution: emptyResolution,
    executionSummary: "",
    requiredFacts: [],
  });

  assert.ok(issues.some((issue) => issue.code.includes("required_memory_fact_missing")));
  assert.ok(!issues.some((issue) => issue.code.includes("memory_fact_wrong_subject")));
});

test("final validator chấp nhận paraphrase đúng và phủ định kép của da nhạy cảm", () => {
  const sensitive: TurnMemoryFact = {
    id: "skin-sensitive",
    subjectId: "self",
    key: "skin_type",
    value: "sensitive",
    product: "unknown",
    polarity: "positive",
    status: "current",
    sourceRef: "conversation_turn:1",
    evidenceRef: "sha256:sensitive",
    sourceTurn: 1,
    temporal: "current",
    scenario: "actual",
    source: "self_report",
    usage: "must_say",
    relevanceReason: "customer_requested_condition_recap",
  };
  for (const reply of ["Da mình dễ kích ứng nha.", "Da mình không phải là không nhạy cảm nha."]) {
    const issues = validateFinalResponse({
      reply,
      customerMessage: "Da mình thuộc loại nào?",
      snapshot: snapshot([], [sensitive]),
      canonicalResolution: emptyResolution,
      executionSummary: "",
      requiredFacts: [],
    });
    assert.deepEqual(issues, [], reply);
  }
});

test("receipt lưu tên không xác minh lời nói đã lưu địa chỉ", () => {
  const issues = validateFinalResponse({
    reply: "Em đã lưu địa chỉ của mình rồi ạ.",
    customerMessage: "địa chỉ mình vừa gửi nha",
    snapshot: snapshot([
      {
        id: "name-commit",
        type: "set_recipient_name",
        field: "recipientName",
        valueRef: "state:2:recipientName",
        stage: "committed",
        status: "succeeded",
        sourceVersion: "2",
        scope,
      },
    ]),
    canonicalResolution: emptyResolution,
    executionSummary: "",
    requiredFacts: [],
  });
  assert.ok(issues.some((issue) => issue.code === "final_response_missing_receipt:address_saved"));
});

test("receipt đúng field, value ref và version xác minh lời đã lưu địa chỉ", () => {
  const issues = validateFinalResponse({
    reply: "Em đã lưu địa chỉ của mình rồi ạ.",
    customerMessage: "địa chỉ mình vừa gửi nha",
    snapshot: snapshot([
      {
        id: "address-commit",
        type: "set_address",
        field: "legacyAddress",
        valueRef: "state:3:legacyAddress",
        stage: "committed",
        status: "succeeded",
        operationId: "turn-a",
        resourceRef: "order:conversation-a",
        resultVersion: "3",
        sourceVersion: "3",
        scope,
      },
    ]),
    canonicalResolution: emptyResolution,
    executionSummary: "",
    requiredFacts: [],
  });
  assert.deepEqual(issues, []);
});

test("R01 receipt cũ chỉ chứng minh lịch sử, không chứng minh cập nhật ở lượt hiện tại", () => {
  const oldReceipt: TurnActionReceipt = {
    id: "address-old",
    type: "set_address",
    field: "legacyAddress",
    valueRef: "state:2:legacyAddress",
    stage: "committed",
    status: "succeeded",
    operationId: "turn-old",
    resourceRef: "order:conversation-a",
    resultVersion: "2",
    sourceVersion: "2",
    scope,
  };
  const current = validateFinalResponse({
    reply: "Em đã cập nhật lại địa chỉ của mình rồi ạ.",
    customerMessage: "Đổi sang địa chỉ mới giúp mình",
    snapshot: snapshot([oldReceipt]),
    canonicalResolution: emptyResolution,
    executionSummary: "",
    requiredFacts: [],
  });
  assert.ok(current.some((issue) => issue.code === "final_response_missing_receipt:address_saved"));

  const history = validateFinalResponse({
    reply: "Lần trước em đã lưu địa chỉ cũ của mình rồi ạ.",
    customerMessage: "Lịch sử địa chỉ trước đây thế nào?",
    snapshot: snapshot([oldReceipt]),
    canonicalResolution: emptyResolution,
    executionSummary: "",
    requiredFacts: [],
  });
  assert.deepEqual(history, []);
});

test("validator kiểm mọi mệnh đề phủ định về mồ hôi, mùi và da", () => {
  const cases: Array<{ fact: TurnMemoryFact; reply: string }> = [
    {
      fact: memoryFact("sweat", "sweat_concern", true),
      reply: "Mình không bị ra mồ hôi nha.",
    },
    {
      fact: memoryFact("odor", "odor_severity", "strong"),
      reply: "Mùi của mình không nặng nha.",
    },
    {
      fact: memoryFact("skin", "skin_type", "sensitive"),
      reply: "Da mình nhạy cảm nha. Da mình không nhạy cảm nha.",
    },
  ];
  for (const item of cases) {
    const issues = validateFinalResponse({
      reply: item.reply,
      customerMessage: "Tổng kết tình trạng giúp mình",
      snapshot: snapshot([], [item.fact]),
      canonicalResolution: emptyResolution,
      executionSummary: "",
      requiredFacts: [],
    });
    assert.ok(
      issues.some((issue) => issue.code.includes("memory_fact_contradicted")),
      item.reply,
    );
  }
});

test("validator kế thừa active sibling và không biến câu điều kiện thành fact self", () => {
  const sibling = memoryFact("sibling-skin", "skin_type", "sensitive", {
    subjectId: "sibling-1",
  });
  assert.deepEqual(
    validateFinalResponse({
      reply: "Da nhạy cảm nên dùng một lớp mỏng thôi nha.",
      customerMessage: "Em ấy dùng sao?",
      snapshot: snapshot([], [sibling], "sibling-1"),
      canonicalResolution: emptyResolution,
      executionSummary: "",
      requiredFacts: [],
    }),
    [],
  );

  const normal = memoryFact("self-normal", "skin_type", "normal", { usage: "context_only" });
  assert.deepEqual(
    validateFinalResponse({
      reply: "Nếu da nhạy cảm thì mình dùng một lớp mỏng thôi nha.",
      customerMessage: "Dùng sao?",
      snapshot: snapshot([], [normal]),
      canonicalResolution: emptyResolution,
      executionSummary: "",
      requiredFacts: [],
    }),
    [],
  );
});

test("context-only vẫn chặn phát biểu trái và queued receipt không chứng minh handoff completed", () => {
  const issues = validateFinalResponse({
    reply: "Da mình không nhạy cảm nha. Em đã chuyển nhân viên CSKH rồi ạ.",
    customerMessage: "kiểm tra giúp mình",
    snapshot: snapshot(
      [
        {
          id: "queued-handoff",
          type: "handoff_to_human",
          status: "succeeded",
          stage: "queued",
          sourceVersion: "0",
          scope,
        },
      ],
      [memoryFact("skin-context", "skin_type", "sensitive", { usage: "context_only" })],
    ),
    canonicalResolution: emptyResolution,
    executionSummary: "",
    requiredFacts: [],
  });
  assert.ok(issues.some((issue) => issue.code.includes("memory_fact_contradicted")));
  assert.ok(issues.some((issue) => issue.code === "final_response_missing_receipt:human_handoff"));
});

test("validator không đổi phản ứng của sản phẩm khác thành Stopirex hoặc fact lịch sử thành hôm nay", () => {
  const otherProduct = memoryFact("other-reaction", "product_reaction", "itching", {
    product: "other_rollon",
    usage: "context_only",
  });
  const wrongProduct = validateFinalResponse({
    reply: "Mình bị ngứa khi dùng Stopirex nha.",
    customerMessage: "Nhắc lại phản ứng giúp mình",
    snapshot: snapshot([], [otherProduct]),
    canonicalResolution: emptyResolution,
    executionSummary: "",
    requiredFacts: [],
  });
  assert.ok(wrongProduct.some((issue) => issue.code.includes("memory_fact_wrong_product")));

  const historical = memoryFact("old-shave", "hair_removal_time", "today", {
    temporal: "past",
    usage: "context_only",
  });
  const wrongTime = validateFinalResponse({
    reply: "Mình cạo hôm nay nha.",
    customerMessage: "Nhắc lại lịch sử cạo giúp mình",
    snapshot: snapshot([], [historical]),
    canonicalResolution: emptyResolution,
    executionSummary: "",
    requiredFacts: [],
  });
  assert.ok(wrongTime.some((issue) => issue.code.includes("memory_fact_contradicted")));
});

test("validator hiểu các giá trị memory được diễn đạt tự nhiên bằng tiếng Việt", () => {
  const cases: Array<{ fact: TurnMemoryFact; reply: string }> = [
    {
      fact: memoryFact("sensitive-after-shave", "skin_sensitivity_context", "after_hair_removal"),
      reply: "Da mình dễ xót sau khi cạo nha.",
    },
    {
      fact: memoryFact("shaved-today", "hair_removal_time", "today", { temporal: "today" }),
      reply: "Mình mới cạo hôm nay nha.",
    },
    {
      fact: memoryFact("no-shave-reaction", "hair_removal_reaction", "none"),
      reply: "Sau khi cạo mình không bị xót nha.",
    },
    {
      fact: memoryFact("stopirex-itch", "product_reaction", "itching", { product: "stopirex" }),
      reply: "Mình bị ngứa khi dùng Stopirex nha.",
    },
  ];
  for (const item of cases) {
    const issues = validateFinalResponse({
      reply: item.reply,
      customerMessage: "Tổng kết tình trạng giúp mình",
      snapshot: snapshot([], [item.fact]),
      canonicalResolution: emptyResolution,
      executionSummary: "",
      requiredFacts: [],
    });
    assert.deepEqual(issues, [], item.reply);
  }
});

test("M06 recap giữ đồng thời thói quen dễ xót và lần gần nhất không xót", () => {
  const issues = validateFinalResponse({
    reply: "Da mình bình thường, đôi khi dễ xót sau wax nhưng lần gần nhất không bị xót nha.",
    customerMessage: "Chốt lại tình trạng da giúp mình",
    snapshot: snapshot(
      [],
      [
        memoryFact("habitual-wax-sensitivity", "skin_sensitivity_context", "after_hair_removal", {
          temporal: "habitual",
        }),
        memoryFact("latest-wax-no-reaction", "hair_removal_reaction", "none", {
          temporal: "yesterday",
        }),
      ],
    ),
    canonicalResolution: emptyResolution,
    executionSummary: "",
    requiredFacts: [],
  });
  assert.deepEqual(issues, []);
});

test("receipt guard nhận diện cách nói hoàn tất tự nhiên và không mượn lịch sử cho cập nhật mới", () => {
  const oldReceipt: TurnActionReceipt = {
    id: "address-old-natural",
    type: "set_address",
    field: "legacyAddress",
    valueRef: "state:2:legacyAddress",
    stage: "committed",
    status: "succeeded",
    operationId: "turn-old",
    resourceRef: "order:conversation-a",
    resultVersion: "2",
    sourceVersion: "2",
    scope,
  };
  for (const reply of [
    "Em lưu địa chỉ mới xong rồi nha.",
    "Địa chỉ lần trước vẫn còn. Em đã lưu địa chỉ mới rồi ạ.",
  ]) {
    const issues = validateFinalResponse({
      reply,
      customerMessage: "Đổi sang địa chỉ mới giúp mình",
      snapshot: snapshot([oldReceipt]),
      canonicalResolution: emptyResolution,
      executionSummary: "",
      requiredFacts: [],
    });
    assert.ok(
      issues.some((issue) => issue.code === "final_response_missing_receipt:address_saved"),
      reply,
    );
  }

  const orderIssues = validateFinalResponse({
    reply: "Đơn của mình lên thành công rồi nha.",
    customerMessage: "Chốt giúp mình",
    snapshot: snapshot(),
    canonicalResolution: emptyResolution,
    executionSummary: "",
    requiredFacts: [],
  });
  assert.ok(orderIssues.some((issue) => issue.code === "final_response_missing_receipt:order_created"));
});

test("memory guard tách chủ thể theo từng mệnh đề trong cùng một câu", () => {
  const selfNormal = memoryFact("self-normal-two-subjects", "skin_type", "normal", {
    usage: "context_only",
  });
  const issues = validateFinalResponse({
    reply: "Da mình nhạy cảm, em gái mình cũng vậy.",
    customerMessage: "Tóm tắt tình trạng da giúp mình",
    snapshot: snapshot([], [selfNormal]),
    canonicalResolution: emptyResolution,
    executionSummary: "",
    requiredFacts: [],
  });
  assert.ok(issues.some((issue) => issue.code.includes("memory_fact_contradicted")));
});

function memoryFact(
  id: string,
  key: string,
  value: string | number | boolean,
  overrides: Partial<TurnMemoryFact> = {},
): TurnMemoryFact {
  return {
    id,
    subjectId: "self",
    key,
    value,
    product: "unknown",
    polarity: "positive",
    status: "current",
    sourceRef: "conversation_turn:1",
    evidenceRef: `sha256:${id}`,
    sourceTurn: 1,
    temporal: "current",
    scenario: "actual",
    source: "self_report",
    usage: "must_say",
    relevanceReason: "regression",
    ...overrides,
  };
}

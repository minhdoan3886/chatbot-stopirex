import assert from "node:assert/strict";
import test from "node:test";
import {
  buildInterpretPromptForDiagnostics,
  CodexLlmBridge,
  isContentFreeCustomerMessage,
  isHelpfulContentFreeReply,
  mergeDraftWithExecutedState,
  parseCodexJsonl,
  parseSemanticSlots,
  parseSemanticUnderstanding,
  repairMissingKnowledgeCitations,
  type LlmUsageTelemetry,
} from "../src/services/codexLlm.js";
import type { DemoChatState } from "../src/services/demoChat.js";

const state: DemoChatState = {
  mode: "sales",
  customerType: "new",
  consultationStage: "S1.context",
  journeyStage: "S1.context",
  breakpoint: "Đang khai thác nhu cầu",
  botPaused: false,
  recentTurns: [],
  slots: {},
  pipeline: "2.Đang tư vấn",
  freeShippingApproved: false,
  orderMissing: ["recipientName", "phone", "legacyAddress"],
  optedOut: false,
  openingVariantId: "A.choice",
  openingSelectionMode: "manual",
  answeredTopics: [],
  askedTopics: [],
  responseGovernorTruncated: false,
};

test("nhận diện tin chỉ có dấu câu nhưng vẫn giữ emoji là tín hiệu có nghĩa", () => {
  assert.equal(isContentFreeCustomerMessage("."), true);
  assert.equal(isContentFreeCustomerMessage("  ...?!  "), true);
  assert.equal(isContentFreeCustomerMessage("👍"), false);
  assert.equal(isContentFreeCustomerMessage("giá?"), false);
});

test("hậu kiểm buộc tin dấu chấm có đúng một câu hỏi hỗ trợ thân thiện", () => {
  assert.equal(
    isHelpfulContentFreeReply(
      ".",
      "Dạ em chào mình ạ. Mình đang cần hỗ trợ về sản phẩm, cách dùng, giá hay đơn hàng ạ?",
    ),
    true,
  );
  assert.equal(
    isHelpfulContentFreeReply(".", "Mình chưa thấy nội dung cần hỗ trợ từ tin nhắn này."),
    false,
  );
  assert.equal(
    isHelpfulContentFreeReply(
      ".",
      "Dạ em chưa hiểu chắc ý trong ngữ cảnh hiện tại ạ. Mình diễn đạt rõ thêm chính câu này giúp em nhé?",
    ),
    false,
  );
  assert.equal(
    isHelpfulContentFreeReply(".", "Dạ mình nói rõ hơn để em hỗ trợ đúng nhu cầu ạ?"),
    false,
  );
  assert.equal(
    isHelpfulContentFreeReply(".", "Dạ mình cần hỗ trợ gì ạ? Hay mình muốn xem giá ạ?"),
    false,
  );
});

test("citation repair chỉ gắn nguồn retrieval khi LLM đã có draft và answer action", () => {
  const repaired = repairMissingKnowledgeCitations(
    {
      status: "interpreted",
      latencyMs: 10,
      model: "test-model",
      provider: "openai",
      slots: {},
      draftReply: "Dạ Stopirex không dùng hương thơm để che mùi ạ.",
      actions: [
        {
          type: "answer_question",
          topic: "other",
          confidence: 0.99,
          evidence: ["không dùng hương thơm để che mùi"],
          source: "llm",
        },
      ],
    },
    ["usage-morning-fragrance-layering", "product-comparison-traditional-rollon"],
  );

  assert.deepEqual(repaired.knowledgeIds, [
    "usage-morning-fragrance-layering",
    "product-comparison-traditional-rollon",
  ]);
  assert.equal(repaired.groundingConfidence, 0.82);
});

test("OpenAI soạn follow-up theo ngữ cảnh nhưng vẫn giữ dữ kiện thương mại đã duyệt", async () => {
  const bridge = new CodexLlmBridge({
    enabled: true,
    provider: "openai",
    apiKey: "test-key",
    model: "test-model",
    runner: async () =>
      "Dạ em hiểu mình vẫn đang cân nhắc ạ. Phương án 1 lọ hiện được miễn phí giao. Mình muốn em làm rõ cơ chế khác biệt hay cách dùng thực tế trước ạ?",
  });
  const result = await bridge.composeFollowup({
    stage: "3h",
    baseReply:
      "Dạ em hiểu mình vẫn đang cân nhắc vì mức giá ạ. Bên em đang hỗ trợ miễn phí giao cả phương án 1 lọ. Điều mình muốn làm rõ thêm là cơ chế khác biệt, cách dùng hay hiệu quả thực tế ạ?",
    context: {
      customerMessage: "Giá hơi cao em nhỉ",
      lastIntent: "price_objection",
    },
  });

  assert.equal(result.status, "generated");
  assert.match(result.text, /miễn phí giao/iu);
  assert.equal((result.text.match(/[?？]/gu) ?? []).length, 1);
  assert.doesNotMatch(result.text, /chọn mấy lọ/iu);
});

test("follow-up LLM vi phạm hướng chốt số lượng bị hạ về fallback đã duyệt", async () => {
  const baseReply =
    "Dạ em gửi mình thêm thông tin: hiện phương án 1 lọ cũng được hỗ trợ miễn phí giao ạ. Để tư vấn sát hơn, mình khó chịu chủ yếu vì mồ hôi làm ướt áo, mùi cơ thể hay cả hai ạ?";
  const bridge = new CodexLlmBridge({
    enabled: true,
    provider: "openai",
    apiKey: "test-key",
    model: "test-model",
    runner: async () => "Dạ phương án 1 lọ được miễn phí giao. Anh/chị muốn chọn mấy lọ ạ?",
  });
  const result = await bridge.composeFollowup({
    stage: "3h",
    baseReply,
    context: { customerMessage: "Cho em xin giá" },
  });

  assert.equal(result.status, "fallback");
  assert.equal(result.text, baseReply);
});

test("Response Planner không để workflow nối CTA thu đơn vào câu LLM", () => {
  const merged = mergeDraftWithExecutedState({
    draftReply:
      "Dạ sáng hôm sau mình tắm lại bằng xà phòng không làm mất tác dụng khi đã dùng đúng vào tối hôm trước. Hóa đơn VAT em cần nhân viên kiểm tra ạ.",
    baseReplies: [
      "Dạ mình dùng vào buổi tối ạ.",
      "Dạ em ghi nhận mình lấy 1 lọ. Mình gửi tên người nhận, SĐT và địa chỉ trước sáp nhập giúp em ạ.",
    ],
    actions: [
      {
        type: "answer_question",
        topic: "usage",
        confidence: 0.98,
        evidence: ["tắm lại bằng xà phòng"],
        source: "llm",
      },
      {
        type: "select_quantity",
        quantity: 1,
        confidence: 0.99,
        evidence: ["lấy 1 lọ"],
        source: "llm",
      },
      {
        type: "continue_order_collection",
        confidence: 0.95,
        evidence: ["lấy 1 lọ"],
        source: "llm",
      },
    ],
  });

  assert.match(merged, /xà phòng/iu);
  assert.match(merged, /VAT/iu);
  assert.doesNotMatch(merged, /ghi nhận mình lấy 1 lọ/iu);
  assert.doesNotMatch(merged, /tên người nhận, SĐT và địa chỉ trước sáp nhập/iu);
});

test("Response Planner giữ xác nhận số lượng sau handoff nhưng chưa thu địa chỉ", () => {
  const merged = mergeDraftWithExecutedState({
    draftReply:
      "Dạ sáng hôm sau tắm bằng xà phòng không làm mất tác dụng ạ. Về VAT, em chuyển bộ phận liên quan kiểm tra giúp mình.",
    baseReplies: ["Câu trả lời", "Em đã ghi nhận mình muốn lấy 1 lọ ạ."],
    actions: [
      {
        type: "answer_question",
        topic: "usage",
        confidence: 0.99,
        evidence: ["tắm xà phòng"],
        source: "llm",
      },
      {
        type: "select_quantity",
        quantity: 1,
        confidence: 0.99,
        evidence: ["lấy 1 lọ"],
        source: "llm",
      },
      {
        type: "continue_order_collection",
        confidence: 0.9,
        evidence: ["lấy 1 lọ"],
        source: "llm",
      },
    ],
    hasUnsupportedQuestions: true,
  });

  assert.match(merged, /tắm bằng xà phòng.*VAT.*ghi nhận.*1 lọ/isu);
  assert.doesNotMatch(merged, /tên người nhận|SĐT|địa chỉ/iu);
});

test("parser giữ toàn bộ actions của một tin nhắn thay vì ép còn một intent", () => {
  const parsed = parseSemanticUnderstanding(
    JSON.stringify({
      summary: "Khách hỏi hiệu quả và chốt một lọ",
      intent: "buying",
      actions: [
        {
          type: "answer_question",
          topic: "effectiveness",
          confidence: 0.97,
          evidence: ["nếu đúng như lời nói"],
        },
        {
          type: "select_quantity",
          quantity: 1,
          confidence: 0.99,
          evidence: ["cho mình 1 lọ"],
        },
        {
          type: "continue_order_collection",
          confidence: 0.95,
          evidence: ["cho mình 1 lọ"],
        },
      ],
      uncertainties: [],
    }),
  );

  assert.equal(parsed.summary, "Khách hỏi hiệu quả và chốt một lọ");
  assert.deepEqual(
    parsed.actions?.map((action) => action.type),
    ["answer_question", "select_quantity", "continue_order_collection"],
  );
});

test("parser ưu tiên structured bubbles và giữ CTA hỏi bối cảnh", () => {
  const parsed = parseSemanticUnderstanding(
    JSON.stringify({
      summary: "Trả lời rồi hỏi một dữ kiện tiếp theo",
      intent: "consultation",
      selectedCtaId: "ask_work_context",
      ctaText: "Tình trạng rõ nhất khi mình vận động hay lúc căng thẳng ạ?",
      draftReply: "Bản text phẳng không được ưu tiên.",
      draftBubbles: [
        "Dạ Stopirex hỗ trợ kiểm soát mồ hôi và mùi cơ thể ạ.",
        "Tình trạng rõ nhất khi mình vận động hay lúc căng thẳng ạ?",
      ],
      actions: [],
      slots: {},
      confidence: 0.98,
      needsClarification: false,
      evidence: ["mồ hôi"],
    }),
  );

  assert.equal(parsed.selectedCtaId, "ask_work_context");
  assert.deepEqual(parsed.draftBubbles, [
    "Dạ Stopirex hỗ trợ kiểm soát mồ hôi và mùi cơ thể ạ.",
    "Tình trạng rõ nhất khi mình vận động hay lúc căng thẳng ạ?",
  ]);
  assert.equal(parsed.draftReply, parsed.draftBubbles?.join("\n\n"));
});

test("parser không làm mất số lượng khi model trả quantity dưới dạng chuỗi", () => {
  const parsed = parseSemanticUnderstanding(
    JSON.stringify({
      intent: "buying",
      actions: [
        {
          type: "select_quantity",
          quantity: "1",
          confidence: 0.99,
          evidence: ["chốt giùm tui mọt chai nghen"],
        },
        {
          type: "continue_order_collection",
          confidence: 0.98,
          evidence: ["chốt giùm tui mọt chai nghen"],
        },
      ],
    }),
  );

  assert.deepEqual(
    parsed.actions?.map((action) =>
      action.type === "select_quantity" ? `${action.type}:${action.quantity}` : action.type,
    ),
    ["select_quantity:1", "continue_order_collection"],
  );
});

test("parser giữ nguồn knowledge, phần chưa hỗ trợ và độ tin cậy grounding", () => {
  const parsed = parseSemanticUnderstanding(
    JSON.stringify({
      intent: "negotiation",
      slots: {},
      knowledgeIds: ["combo-two", "combo-two"],
      unsupportedQuestions: ["Quà tặng cho 3 lọ"],
      groundingConfidence: 0.91,
    }),
  );

  assert.deepEqual(parsed.knowledgeIds, ["combo-two"]);
  assert.deepEqual(parsed.unsupportedQuestions, ["Quà tặng cho 3 lọ"]);
  assert.equal(parsed.groundingConfidence, 0.91);
});

test("parser giữ truy vấn Knowledge do LLM chuẩn hóa và loại PII", () => {
  const parsed = parseSemanticUnderstanding(
    JSON.stringify({
      knowledgeQueries: ["an toàn cho da nhạy cảm 0983425566", "kiểm tra hàng chính hãng"],
    }),
  );

  assert.deepEqual(parsed.knowledgeQueries, ["an toàn cho da nhạy cảm", "kiểm tra hàng chính hãng"]);
});

test("cấu hình auto ưu tiên OpenAI API khi có key", () => {
  const bridge = CodexLlmBridge.fromEnvironment({
    LLM_PROVIDER: "auto",
    LLM_ENABLED: "true",
    OPENAI_API_KEY: "sk-test-not-a-real-key",
    OPENAI_MODEL: "gpt-5-mini",
  });

  assert.equal(bridge.enabled, true);
  assert.equal(bridge.provider, "openai");
  assert.equal(bridge.model, "gpt-5-mini");
});

test("cấu hình auto giữ Codex CLI khi chưa có OpenAI API key", () => {
  const bridge = CodexLlmBridge.fromEnvironment({
    LLM_PROVIDER: "auto",
    LLM_ENABLED: "true",
    CODEX_LLM_MODEL: "gpt-cli-test",
  });

  assert.equal(bridge.enabled, true);
  assert.equal(bridge.provider, "codex");
  assert.equal(bridge.model, "gpt-cli-test");
});

test("cấu hình hybrid cho phép tách timeout OpenAI và Codex dự phòng", () => {
  const bridge = CodexLlmBridge.fromEnvironment({
    LLM_PROVIDER: "hybrid",
    LLM_ENABLED: "true",
    OPENAI_API_KEY: "sk-test-not-a-real-key",
    OPENAI_MODEL: "gpt-5-mini",
    CODEX_LLM_MODEL: "gpt-codex-test",
    LLM_HYBRID_PROVIDER_TIMEOUT_MS: "15000",
    LLM_HYBRID_FALLBACK_TIMEOUT_MS: "30000",
    CODEX_LLM_REASONING_EFFORT: "low",
  });

  assert.equal(bridge.enabled, true);
  assert.equal(bridge.provider, "hybrid");
  assert.equal(bridge.model, "gpt-5-mini → gpt-codex-test");
});

test("OpenAI-compatible runner gửi Responses request tới OPENAI_BASE_URL", async () => {
  let requestPath = "";
  let authorization = "";
  let requestBody: Record<string, unknown> = {};
  const bridge = new CodexLlmBridge({
    enabled: true,
    provider: "openai",
    apiKey: "ak-test-not-a-real-key",
    baseURL: "https://agentrouter.example/v1/",
    model: "router-test",
    timeoutMs: 30_000,
    maxOutputTokens: 1_200,
    async fetch(input, init) {
      const request = input instanceof Request ? input : new Request(input, init);
      requestPath = new URL(request.url).pathname;
      authorization = request.headers.get("authorization") ?? "";
      requestBody = JSON.parse(await request.text()) as Record<string, unknown>;
      return Response.json({
        id: "resp_agentrouter_test",
        object: "response",
        created_at: Math.floor(Date.now() / 1_000),
        status: "completed",
        model: "router-test",
        output_text: JSON.stringify({ intent: "other", slots: {} }),
        output: [
          {
            id: "msg_agentrouter_test",
            type: "message",
            status: "completed",
            role: "assistant",
            content: [
              {
                type: "output_text",
                text: JSON.stringify({ intent: "other", slots: {} }),
                annotations: [],
              },
            ],
          },
        ],
        usage: {
          input_tokens: 10,
          input_tokens_details: { cached_tokens: 0 },
          output_tokens: 5,
          output_tokens_details: { reasoning_tokens: 0 },
          total_tokens: 15,
        },
      });
    },
  });

  const result = await bridge.interpret({
    customerMessage: "Xin chào",
    state,
  });

  assert.equal(result.status, "interpreted");
  assert.equal(result.intent, "other");
  assert.equal(requestPath, "/v1/responses");
  assert.equal(authorization, "Bearer ak-test-not-a-real-key");
  assert.equal((requestBody.text as { verbosity?: string }).verbosity, "low");
  const format = (requestBody.text as { format?: Record<string, unknown> }).format;
  assert.equal(format?.type, "json_schema");
  assert.equal(format?.strict, true);
  assert.equal(
    (
      (
        format?.schema as {
          properties?: { actions?: { items?: { properties?: { type?: { enum?: string[] } } } } };
        }
      ).properties?.actions?.items?.properties?.type?.enum ?? []
    ).includes("update_order"),
    true,
  );
  const schema = format?.schema as {
    required?: string[];
    properties?: Record<string, unknown>;
  };
  for (const field of ["answeredQuestions", "newAngle", "rejectedArguments", "nextStep"]) {
    assert.equal(schema.required?.includes(field), true);
    assert.equal(Boolean(schema.properties?.[field]), true);
  }
});

test("prompt compact là profile production mặc định", () => {
  const production = CodexLlmBridge.fromEnvironment({
    LLM_PROVIDER: "codex",
    LLM_ENABLED: "true",
    CODEX_LLM_MODEL: "gpt-codex-test",
  });
  const shadow = CodexLlmBridge.fromEnvironment({
    LLM_PROVIDER: "codex",
    LLM_ENABLED: "true",
    CODEX_LLM_MODEL: "gpt-codex-test",
    LLM_PROMPT_PROFILE: "compact",
  });
  const deprecatedLegacy = CodexLlmBridge.fromEnvironment({
    LLM_PROVIDER: "codex",
    LLM_ENABLED: "true",
    CODEX_LLM_MODEL: "gpt-codex-test",
    LLM_PROMPT_PROFILE: "legacy",
  });

  assert.equal(production.promptProfile, "compact");
  assert.equal(shadow.promptProfile, "compact");
  assert.equal(deprecatedLegacy.promptProfile, "compact");
});

test("prompt compact giảm kích thước nhưng giữ nguyên hợp đồng hành động và state", () => {
  const input = {
    customerMessage: "Giá mình biết rồi, nhưng đã tiêm botox mà bị lại thì Stopirex có ăn thua không?",
    state: {
      ...state,
      selectedQuantity: 1 as const,
      pendingAction: "choose_quantity" as const,
      recentTurns: [
        { role: "user" as const, text: "Mình lấy 1 lọ" },
        { role: "assistant" as const, text: "Mình gửi thông tin nhận hàng giúp em nhé." },
      ],
    },
    knowledge: [{ id: "effect", title: "Hiệu quả", content: "Dữ liệu đã duyệt" }],
  };
  const legacy = buildInterpretPromptForDiagnostics(input, "legacy");
  const compact = buildInterpretPromptForDiagnostics(input, "compact");

  assert.ok(compact.length < legacy.length * 0.7, `${compact.length}/${legacy.length}`);
  for (const required of [
    "intent, topic, actions và draftReply",
    "confidence và evidence nguyên văn",
    "selectedCtaId",
    "Structured Outputs",
    '"selectedQuantity":1',
    '"pendingAction":"choose_quantity"',
    "Dữ liệu đã duyệt",
    "Mình lấy 1 lọ",
    "tiêm botox",
  ]) {
    assert.match(compact, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "u"));
  }
  assert.match(compact, /không mở đầu 'Dạ có'/u);
  assert.match(compact, /answer_question \+ pause_order/u);
  assert.match(compact, /cấm xin số lượng\/Tên\/SĐT\/Địa chỉ/u);
  assert.match(compact, /là câu trả lời, không phải câu hỏi/u);
  assert.match(compact, /MESSAGE nhiều dòng là các tin liên tiếp/u);
  assert.match(compact, /Bất biến số lượng/u);
  assert.match(compact, /chai\/lọ/u);
  assert.match(compact, /CONVERSATION_MEMORY/u);
  assert.match(compact, /answeredQuestions\/newAngle\/rejectedArguments\/nextStep/u);
  assert.match(compact, /workflow cung cấp ALLOWED_CTAS/u);
  assert.doesNotMatch(compact, /SỰ THẬT CỐT LÕI/u);
});

test("prompt compact gửi bộ nhớ ngữ nghĩa và trạng thái đơn có cấu trúc", () => {
  const prompt = buildInterpretPromptForDiagnostics(
    {
      customerMessage: "Nivea cũng dùng lâu thế thì khác gì?",
      state: {
        ...state,
        selectedQuantity: 1,
        orderFlowStatus: "paused",
        orderMissing: ["phone"],
        orderTransactionTrace: {
          acceptedActions: [],
          changedFields: ["quantity"],
          conflicts: [],
        },
        conversationMemory: {
          currentGoal: "resolve_price_objection",
          activeSubject: "customer",
          beneficiaries: [],
          usedArguments: ["duration_or_cost"],
          rejectedArguments: ["duration_or_cost"],
          answeredQuestions: ["price_comparison"],
          openQuestions: ["difference_in_mechanism"],
          nextStep: "ask_discovery",
          phoneHistory: [],
          consultationFacts: { triggers: [] },
        },
      },
      knowledge: [],
    },
    "compact",
  );

  assert.match(prompt, /"currentGoal":"resolve_price_objection"/u);
  assert.match(prompt, /"activeSubject":"customer"/u);
  assert.match(prompt, /"rejectedArguments":\["duration_or_cost"\]/u);
  assert.match(prompt, /"openQuestions":\["difference_in_mechanism"\]/u);
  assert.match(prompt, /"selectedQuantity":1/u);
  assert.match(prompt, /"missingFields":\["phone"\]/u);
  assert.match(prompt, /"lastChangedFields":\["quantity"\]/u);
});

test("prompt compact buộc LLM phát hành action số lượng cho tiếng địa phương và lỗi gõ", () => {
  const prompt = buildInterpretPromptForDiagnostics(
    {
      customerMessage: "chốt giùm tui mọt chai nghen",
      state,
      knowledge: [],
    },
    "compact",
  );

  assert.match(prompt, /select_quantity với số chuẩn và continue_order_collection/u);
  assert.match(prompt, /chốt giùm tui mọt chai nghen/u);
  assert.match(prompt, /evidence giữ nguyên cả cụm khách viết/u);
});

test("prompt compact không cho model tự nuốt một vế mua hoặc từ chối đang mâu thuẫn", () => {
  const prompt = buildInterpretPromptForDiagnostics(
    {
      customerMessage: "chốt giùm tui mọt chai, mà thui hông lấy nữa",
      state,
      knowledge: [],
    },
    "compact",
  );

  assert.match(prompt, /Bất biến mâu thuẫn mua/u);
  assert.match(prompt, /select_quantity, continue_order_collection và decline_purchase/u);
  assert.match(prompt, /needsClarification=true/u);
  assert.match(prompt, /không tự chọn vế cuối/u);
});

test("prompt compact ưu tiên lời mời hướng dẫn gần nhất hơn state đơn cũ", () => {
  const prompt = buildInterpretPromptForDiagnostics(
    {
      customerMessage: "gửi cho chị",
      state: {
        ...state,
        selectedQuantity: 1,
        pendingAction: "send_usage_guidance",
        pipeline: "5.Chờ TT KH",
        recentTurns: [
          { role: "user", text: "Con trai chị 15 tuổi dùng được không?" },
          {
            role: "assistant",
            text: "Nếu mình cần, em gửi thêm cách dùng phù hợp để bé sử dụng đúng ngay từ đầu nhé ạ.",
          },
        ],
      },
      knowledge: [],
    },
    "compact",
  );

  assert.match(prompt, /pendingAction gần nhất thắng selectedQuantity và state đơn cũ/u);
  assert.match(prompt, /usage_guidance \+ replyTo offer_usage_guidance/u);
  assert.match(prompt, /affirmation=true \+ needsClarification=false/u);
  assert.match(prompt, /cấm order_support\/continue_order_collection/u);
});

test("prompt compact giữ bé là đối tượng nhưng không kéo câu hỏi mới về child_age", () => {
  const prompt = buildInterpretPromptForDiagnostics(
    {
      customerMessage: "liệu có an toàn cho da ko e\nhàng giả h nhiều lắm",
      state: {
        ...state,
        customerProfile: { age: 15 },
        answeredTopics: ["child_age"],
        recentTurns: [
          { role: "user", text: "Chị mua cho con trai 15 tuổi, bé dùng được không?" },
          { role: "assistant", text: "Dạ bé 15 tuổi dùng được rồi ạ." },
        ],
      },
      knowledge: [],
    },
    "compact",
  );

  assert.match(prompt, /topic\/intent\/actions phải theo câu hỏi MỚI/u);
  assert.match(prompt, /answer_question\(irritation\) \+ answer_question\(comparison\)/u);
  assert.match(prompt, /Cấm topic child_age/u);
  assert.match(prompt, /cấm lặp 'bé N tuổi dùng được'/u);
});

test("ép OpenAI nhưng thiếu key thì bridge không tự báo sẵn sàng", () => {
  const bridge = CodexLlmBridge.fromEnvironment({
    LLM_PROVIDER: "openai",
    LLM_ENABLED: "true",
  });

  assert.equal(bridge.enabled, false);
  assert.equal(bridge.provider, "openai");
  assert.equal(bridge.model, "gpt-5.4-nano");
});

test("health snapshot ghi nhận timeout gần nhất của provider", async () => {
  const telemetry: LlmUsageTelemetry[] = [];
  const bridge = new CodexLlmBridge({
    enabled: true,
    provider: "openai",
    apiKey: "sk-test-not-a-real-key",
    model: "gpt-5-mini",
    runner: async () => {
      throw new Error("request timed out");
    },
    telemetry: (event) => {
      telemetry.push(event);
    },
  });

  const result = await bridge.interpret({ customerMessage: "tư vấn", state });
  const health = bridge.healthSnapshot();

  assert.equal(result.status, "fallback");
  assert.equal(result.reason, "llm_timeout");
  assert.equal(result.provider, "openai");
  assert.equal(health.lastError, "llm_timeout");
  assert.equal(health.providers.openai?.lastError, "llm_timeout");
  assert.ok(health.providers.openai?.lastFailureAt);
  assert.ok(health.lastRequestAt);
  assert.ok(health.lastFailureAt);
  assert.equal(telemetry.length, 1);
  assert.equal(telemetry[0]?.status, "failure");
  assert.equal(telemetry[0]?.purpose, "interpret");
  assert.equal(telemetry[0]?.errorCode, "llm_timeout");
  assert.equal(telemetry[0]?.totalTokens, 0);
});

test("telemetry phân biệt hết quota với giới hạn tốc độ", async () => {
  const telemetry: LlmUsageTelemetry[] = [];
  const bridge = new CodexLlmBridge({
    enabled: true,
    provider: "openai",
    apiKey: "sk-test-not-a-real-key",
    model: "gpt-5-mini",
    runner: async () => {
      throw Object.assign(new Error("You have no credits remaining"), {
        status: 429,
        code: "credit_balance_exhausted",
        type: "insufficient_quota",
      });
    },
    telemetry: (event) => {
      telemetry.push(event);
    },
  });

  const result = await bridge.interpret({ customerMessage: "tư vấn", state });
  assert.equal(result.reason, "llm_quota_exhausted");
  assert.equal(telemetry[0]?.errorCode, "llm_quota_exhausted");
});

test("hybrid chuyển sang Codex và tạm bỏ qua OpenAI sau khi hết credit", async () => {
  const telemetry: LlmUsageTelemetry[] = [];
  let openAiCalls = 0;
  let codexCalls = 0;
  const bridge = new CodexLlmBridge({
    enabled: true,
    provider: "hybrid",
    model: "gpt-5-mini",
    fallbackModel: "gpt-codex-test",
    cooldownMs: 300_000,
    runner: async () => {
      openAiCalls += 1;
      throw Object.assign(new Error("You have no credits remaining"), {
        status: 429,
        code: "credit_balance_exhausted",
        type: "insufficient_quota",
      });
    },
    fallbackRunner: async () => {
      codexCalls += 1;
      return "Dạ em kiểm tra tình trạng để tư vấn phù hợp cho mình ạ.";
    },
    telemetry: (event) => {
      telemetry.push(event);
    },
  });

  const first = await bridge.enhance({
    customerMessage: "Tư vấn giúp mình",
    baseReply: "Dạ em kiểm tra tình trạng để tư vấn phù hợp cho mình ạ.",
    state,
  });
  const second = await bridge.enhance({
    customerMessage: "Tư vấn thêm giúp mình",
    baseReply: "Dạ em kiểm tra tình trạng để tư vấn phù hợp cho mình ạ.",
    state,
  });

  assert.equal(first.status, "enhanced");
  assert.equal(second.status, "enhanced");
  assert.equal(first.provider, "hybrid");
  assert.equal(openAiCalls, 1);
  assert.equal(codexCalls, 2);
  const health = bridge.healthSnapshot();
  assert.equal(health.providers.openai?.lastError, "llm_quota_exhausted");
  assert.ok(health.providers.openai?.lastFailureAt);
  assert.ok(health.providers.codex?.lastSuccessAt);
  assert.equal(health.providers.codex?.lastError, undefined);
  assert.deepEqual(
    telemetry.map((event) => [event.provider, event.status, event.errorCode]),
    [
      ["openai", "failure", "llm_quota_exhausted"],
      ["codex", "success", undefined],
      ["codex", "success", undefined],
    ],
  );
  assert.ok(telemetry.every((event) => event.purpose === "enhance"));
});

test("hybrid khởi động Codex dự phòng theo hedge và lấy kết quả hợp lệ đầu tiên", async () => {
  let openAiCalls = 0;
  let codexCalls = 0;
  const bridge = new CodexLlmBridge({
    enabled: true,
    provider: "hybrid",
    model: "gpt-5-mini",
    fallbackModel: "gpt-codex-test",
    hedgeDelayMs: 10,
    runner: async () => {
      openAiCalls += 1;
      return await new Promise<string>(() => undefined);
    },
    fallbackRunner: async () => {
      codexCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return "Dạ em kiểm tra tình trạng để tư vấn phù hợp cho mình ạ.";
    },
  });

  const result = await bridge.enhance({
    customerMessage: "Tư vấn giúp mình",
    baseReply: "Dạ em kiểm tra tình trạng để tư vấn phù hợp cho mình ạ.",
    state,
  });

  assert.equal(result.status, "enhanced");
  assert.equal(result.reply, "Dạ em kiểm tra tình trạng để tư vấn phù hợp cho mình ạ.");
  assert.equal(openAiCalls, 1);
  assert.equal(codexCalls, 1);
});

test("OpenAI provider gọi Responses API trực tiếp với store false", async () => {
  const originalFetch = globalThis.fetch;
  let requestUrl = "";
  let requestBody: Record<string, unknown> = {};
  globalThis.fetch = async (input, init) => {
    requestUrl = String(input);
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(
      JSON.stringify({
        id: "resp_test",
        object: "response",
        created_at: 1,
        status: "completed",
        error: null,
        incomplete_details: null,
        instructions: null,
        max_output_tokens: 1_200,
        model: "gpt-5-mini",
        output: [
          {
            id: "msg_test",
            type: "message",
            status: "completed",
            role: "assistant",
            content: [
              {
                type: "output_text",
                text: "Dạ em kiểm tra tình trạng cho mình ạ.",
                annotations: [],
              },
            ],
          },
        ],
        parallel_tool_calls: true,
        previous_response_id: null,
        reasoning: { effort: null, summary: null },
        store: false,
        text: { format: { type: "text" } },
        tool_choice: "auto",
        tools: [],
        truncation: "disabled",
        usage: {
          input_tokens: 10,
          input_tokens_details: { cached_tokens: 2 },
          output_tokens: 10,
          output_tokens_details: { reasoning_tokens: 3 },
          total_tokens: 20,
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };

  try {
    const telemetry: LlmUsageTelemetry[] = [];
    const bridge = new CodexLlmBridge({
      enabled: true,
      provider: "openai",
      apiKey: "sk-test-not-a-real-key",
      model: "gpt-5-mini",
      maxOutputTokens: 1_200,
      telemetry: (event) => {
        telemetry.push(event);
      },
    });
    const result = await bridge.enhance({
      customerMessage: "Tư vấn giúp mình",
      baseReply: "Dạ em kiểm tra tình trạng cho mình ạ.",
      state,
    });

    assert.equal(result.status, "enhanced");
    assert.equal(result.provider, "openai");
    assert.match(requestUrl, /\/v1\/responses$/u);
    assert.equal(requestBody.model, "gpt-5-mini");
    assert.equal(requestBody.store, false);
    assert.equal(requestBody.max_output_tokens, 1_200);
    assert.equal(telemetry.length, 1);
    assert.equal(telemetry[0]?.responseId, "resp_test");
    assert.equal(telemetry[0]?.inputTokens, 10);
    assert.equal(telemetry[0]?.cachedInputTokens, 2);
    assert.equal(telemetry[0]?.outputTokens, 10);
    assert.equal(telemetry[0]?.reasoningOutputTokens, 3);
    assert.equal(telemetry[0]?.inputRateUsdPerMillion, 0.25);
    assert.equal(telemetry[0]?.cachedInputRateUsdPerMillion, 0.025);
    assert.equal(telemetry[0]?.outputRateUsdPerMillion, 2);
    assert.ok(Math.abs((telemetry[0]?.totalCostUsd ?? 0) - 0.00002205) < 1e-12);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Codex bridge dùng câu trả lời đã qua claim guard", async () => {
  const bridge = new CodexLlmBridge({
    enabled: true,
    model: "test-model",
    runner: async () => "Dạ em kiểm tra tình trạng để tư vấn phù hợp cho mình ạ.",
  });
  const result = await bridge.enhance({
    customerMessage: "Tư vấn giúp mình",
    baseReply: "Dạ em kiểm tra tình trạng cho mình ạ.",
    state,
  });
  assert.equal(result.status, "enhanced");
  assert.equal(result.model, "test-model");
});

test("single-pass draft không được nói đã chọn combo khi state chưa thực thi", () => {
  const bridge = new CodexLlmBridge({ enabled: true, model: "test-model" });
  const result = bridge.adoptInterpretedDraft({
    customerMessage: "2",
    draftReply: "Dạ em ghi nhận combo 2 lọ ạ. Anh/chị gửi tên và SĐT để em lên đơn nhé?",
    baseReply: "Dạ em chưa xác định được lựa chọn. Mình chọn 1 lọ hay combo 2 lọ ạ?",
    state,
    skillId: "order-closing",
  });

  assert.equal(result.status, "fallback");
  assert.equal(result.reason, "action_grounding_guard");
  assert.equal(result.reply.includes("ghi nhận combo"), false);
});

test("single-pass không coi giả định chọn 1 lọ để hỏi hoàn tiền là đã chốt đơn", () => {
  const bridge = new CodexLlmBridge({ enabled: true, model: "test-model" });
  const draftReply =
    "Dạ nếu mình chọn 1 lọ và dùng đúng hướng dẫn đủ 2 tuần mà chưa hiệu quả, bên em hỗ trợ hoàn tiền ạ.";
  const result = bridge.adoptInterpretedDraft({
    customerMessage: "nếu mức 1 c mà k đỡ có dc hoàn xèng k",
    draftReply,
    baseReply: draftReply,
    state,
  });

  assert.equal(result.status, "enhanced");
  assert.equal(result.reason, "single_pass_draft");
  assert.equal(result.reply, draftReply);
});

test("single-pass không được xin dữ liệu đơn khi action plan đang pause_order", () => {
  const bridge = new CodexLlmBridge({ enabled: true, runner: async () => "" });
  const answerAction = {
    type: "answer_question" as const,
    topic: "effectiveness" as const,
    confidence: 0.97,
    evidence: ["ngồi không cũng ướt"],
    source: "llm" as const,
  };
  const continueAction = {
    type: "continue_order_collection" as const,
    confidence: 0.9,
    evidence: ["đơn đang dở"],
    source: "llm" as const,
  };
  const pauseAction = {
    type: "pause_order" as const,
    reason: "answer_current_question_first",
    confidence: 1,
    evidence: ["ngồi không cũng ướt"],
    source: "state" as const,
  };
  const pausedState: DemoChatState = {
    ...state,
    selectedQuantity: 1,
    orderFlowStatus: "paused",
    decisionTrace: {
      semantic: {
        intent: "product_effect",
        topic: "sweat",
        confidence: 0.97,
        needsClarification: false,
        evidence: ["ngồi không cũng ướt"],
      },
      ruleMatches: [],
      conflicts: [],
      selectedRoute: "direct_intent",
      selectedIntent: "product_effect",
      reason: "Ưu tiên trả lời câu hiện tại.",
      knowledgeEntityIds: ["product-comparison-traditional-rollon"],
      actionPlan: {
        accepted: [answerAction, continueAction, pauseAction],
        rejected: [],
        conflicts: [],
        primaryIntent: "product_effect",
        answerTopics: ["effectiveness"],
        shouldClarify: false,
        hasMultipleActions: true,
      },
    },
  };
  const baseReply = "Dạ có ạ. Stopirex hỗ trợ kiểm soát mồ hôi khi mình ra nhiều mồ hôi cả lúc ngồi yên.";
  const result = bridge.adoptInterpretedDraft({
    customerMessage: "lăn cái này có tốt k, a ra nhiều mồ hôi, ngồi ko cũng ướt",
    draftReply:
      "Dạ có ạ. Stopirex hỗ trợ kiểm soát mồ hôi khi mình ra nhiều mồ hôi cả lúc ngồi yên. Mình gửi em tên người nhận, SĐT và địa chỉ nhé?",
    baseReply,
    actions: [answerAction, continueAction],
    state: pausedState,
  });

  assert.equal(result.status, "fallback");
  assert.equal(result.reason, "action_grounding_guard");
  assert.equal(result.reply, baseReply);
  assert.doesNotMatch(result.reply, /tên người nhận|SĐT|địa chỉ/iu);
});

test("action grounding cho phép hướng dẫn liên hệ có điều kiện, không hiểu nhầm là đã handoff", () => {
  const bridge = new CodexLlmBridge({ enabled: true, runner: async () => "" });
  const draftReply =
    "Dạ em xin thông tin chính xác đến mình ạ: Stopirex có Alcohol dùng làm dung môi trong ngưỡng an toàn của công thức, và mẫu thử ghi mức kích ứng da là ‘không đáng kể’. Khi nhận hàng, mình đối chiếu bao bì, tem và đúng tên sản phẩm; nếu không khớp thì từ chối nhận và báo em chuyển bộ phận liên quan kiểm tra ạ.";
  const result = bridge.adoptInterpretedDraft({
    customerMessage: "liệu có an toàn cho da ko e\nhàng giả h nhiều lắm",
    draftReply,
    baseReply:
      "Dạ với bé 15 tuổi, Stopirex có thể dùng theo đúng hướng dẫn ạ. Mẫu thử có mức kích ứng da không đáng kể.",
    actions: [
      {
        type: "answer_question",
        topic: "irritation",
        confidence: 0.97,
        evidence: ["an toàn cho da"],
        source: "llm",
      },
      {
        type: "answer_question",
        topic: "comparison",
        confidence: 0.92,
        evidence: ["hàng giả nhiều lắm"],
        source: "llm",
      },
    ],
    state: {
      ...state,
      customerProfile: { age: 15 },
      answeredTopics: ["child_age"],
      recentTurns: [
        { role: "user", text: "Chị mua cho con trai 15 tuổi" },
        { role: "assistant", text: "Dạ bé 15 tuổi dùng được rồi ạ." },
      ],
    },
    knowledge: [
      {
        id: "product-composition-tolerance-approved",
        title: "Thành phần và độ dịu nhẹ đã được duyệt",
        content:
          "Stopirex có Alcohol dùng làm dung môi trong ngưỡng an toàn của công thức. Mẫu thử có mức kích ứng da không đáng kể.",
      },
      {
        id: "authenticity-before-purchase",
        title: "Xác nhận sản phẩm chính hãng trước khi mua",
        content:
          "Sản phẩm Stopirex bên em cung cấp là hàng chính hãng. Khi nhận hàng, khách đối chiếu bao bì, tem và đúng tên sản phẩm; nếu không khớp, khách có quyền từ chối nhận và liên hệ bên em kiểm tra.",
      },
    ],
    knowledgeIds: ["product-composition-tolerance-approved", "authenticity-before-purchase"],
    unsupportedQuestions: [],
    groundingConfidence: 0.98,
    knowledgeGroundingRequired: true,
  });

  assert.equal(result.status, "enhanced");
  assert.equal(result.reason, "single_pass_draft");
  assert.match(result.reply, /báo em chuyển bộ phận liên quan kiểm tra/iu);
});

test("action grounding không để câu điều kiện khác che tuyên bố đã handoff sai state", () => {
  const bridge = new CodexLlmBridge({ enabled: true, runner: async () => "" });
  const baseReply = "Dạ em tư vấn cho mình ạ.";
  const result = bridge.adoptInterpretedDraft({
    customerMessage: "Tư vấn giúp mình",
    draftReply:
      "Dạ em đã chuyển bộ phận CSKH kiểm tra rồi ạ. Nếu hàng không khớp, mình báo em để em chuyển bộ phận liên quan kiểm tra nhé.",
    baseReply,
    state,
  });

  assert.equal(result.status, "fallback");
  assert.equal(result.reason, "action_grounding_guard");
  assert.equal(result.reply, baseReply);
});

test("workflow không thay thế quyết định hội thoại trong draft của LLM", () => {
  const bridge = new CodexLlmBridge({ enabled: true, runner: async () => "" });
  const baseReply = "Dạ em hiểu ạ. Tình trạng của mình có kèm mùi khó chịu không ạ?";
  const result = bridge.adoptInterpretedDraft({
    customerMessage: "Mình bị mồ hôi nhiều",
    draftReply: "Dạ Stopirex hỗ trợ kiểm soát mồ hôi ạ. Mình chọn 1 lọ hay combo 2 lọ ạ?",
    baseReply,
    state,
  });

  assert.equal(result.status, "enhanced");
  assert.equal(result.reason, "single_pass_draft");
  assert.equal(result.reply, "Dạ Stopirex hỗ trợ kiểm soát mồ hôi ạ. Mình chọn 1 lọ hay combo 2 lọ ạ?");
});

test("single-pass giữ nguyên hai bubble Structured Output do LLM đã chia", () => {
  const bridge = new CodexLlmBridge({ enabled: true, runner: async () => "" });
  const draftBubbles = [
    "Dạ Stopirex hỗ trợ kiểm soát mồ hôi khi dùng đúng hướng dẫn ạ.",
    "Mình muốn em hướng dẫn cách dùng buổi tối không ạ?",
  ];
  const result = bridge.adoptInterpretedDraft({
    customerMessage: "Sản phẩm dùng thế nào?",
    draftReply: draftBubbles.join("\n\n"),
    draftBubbles,
    baseReply: draftBubbles.join("\n\n"),
    state,
  });

  assert.equal(result.status, "enhanced");
  assert.deepEqual(result.replies, draftBubbles);
});

test("single-pass chỉ nhận câu trả lời có knowledge id thật đã được truy xuất", () => {
  const bridge = new CodexLlmBridge({ enabled: true, runner: async () => "" });
  const common = {
    customerMessage: "Combo 2 lọ có ưu đãi gì?",
    draftReply: "Dạ combo 2 lọ giá 510.000đ và miễn phí giao ạ.",
    baseReply: "Dạ combo 2 lọ giá 510.000đ và miễn phí giao ạ.",
    state,
    skillId: "pricing-objection" as const,
    knowledge: [
      {
        id: "combo-two",
        title: "Ưu đãi combo 2 lọ",
        content: "Combo 2 lọ giá 510.000đ và miễn phí giao.",
      },
    ],
    groundingConfidence: 0.95,
    knowledgeGroundingRequired: true,
  };
  const grounded = bridge.adoptInterpretedDraft({ ...common, knowledgeIds: ["combo-two"] });
  const fabricated = bridge.adoptInterpretedDraft({ ...common, knowledgeIds: ["not-retrieved"] });

  assert.equal(grounded.status, "enhanced");
  assert.equal(fabricated.status, "fallback");
  assert.equal(fabricated.reason, "knowledge_grounding_guard:unknown_knowledge_id");
});

test("single-pass có Knowledge không bị workflow tự nối thêm CTA", () => {
  const bridge = new CodexLlmBridge({ enabled: true, runner: async () => "" });
  const baseReply =
    "Dạ 1 lọ 285.000đ + 30.000đ phí giao ạ. Để em tư vấn sát hơn, mình khó chịu vì mồ hôi, mùi hay cả hai tình trạng ạ?";
  const result = bridge.adoptInterpretedDraft({
    customerMessage: "alo e giá",
    draftReply: "Dạ 1 lọ 285.000đ + 30.000đ phí giao ạ.",
    baseReply,
    state,
    knowledge: [
      {
        id: "pricing-approved-options-2026-08",
        title: "Bảng giá",
        content: "1 lọ giá 285.000đ và phí giao 30.000đ.",
      },
    ],
    knowledgeIds: ["pricing-approved-options-2026-08"],
    groundingConfidence: 0.99,
    knowledgeGroundingRequired: true,
  });

  assert.equal(result.status, "enhanced");
  assert.equal(result.reason, "single_pass_draft");
  assert.equal(result.reply, "Dạ 1 lọ 285.000đ + 30.000đ phí giao ạ.");
  assert.doesNotMatch(result.reply, /mình khó chịu vì mồ hôi, mùi hay cả hai/iu);
});

test("bảng giá chung không được LLM nén mất phương án, combo phụ hoặc câu hỏi nối tiếp", () => {
  const bridge = new CodexLlmBridge({ enabled: true, runner: async () => "" });
  const baseReply = [
    "Dạ giá hiện tại:",
    "• 1 lọ: 285.000đ + 30.000đ phí giao.",
    "• Combo 2 lọ: 510.000đ, miễn phí giao, tiết kiệm 60.000đ.",
    "• Combo 3 lọ: 750.000đ, miễn phí giao.",
    "• Quà tặng: đơn từ 2 lọ trở lên được tặng 1 túi đa năng vải dệt Stopirex (1 túi/đơn).",
    "",
    "Combo chăm sóc mùi cơ thể:",
    "• 1 lăn Stopirex + 1 chai Herbal Body Wash 500ml: 525.000đ, miễn phí giao.",
    "• Herbal Body Wash hiện chưa bán lẻ.",
    "Để em tư vấn sát hơn, hiện mình khó chịu chủ yếu vì mồ hôi làm ướt hoặc ố áo, mùi cơ thể hay cả hai tình trạng ạ?",
  ].join("\n");
  const result = bridge.adoptInterpretedDraft({
    customerMessage: "cho em giá",
    draftReply:
      "Dạ 1 lọ Stopirex giá 285.000đ, phí giao 30.000đ ạ. Nếu mình lấy từ 2 lọ trở lên thì có giá combo: 2 lọ 510.000đ, 3 lọ 750.000đ.",
    baseReply,
    state: { ...state, pendingQuestionTopic: "symptom" },
    skillId: "direct-answer",
    knowledge: [
      {
        id: "pricing-approved-options-2026-08",
        title: "Giá và phương án mua đã duyệt",
        content: baseReply,
      },
    ],
    knowledgeIds: ["pricing-approved-options-2026-08"],
    groundingConfidence: 0.99,
    knowledgeGroundingRequired: true,
  });

  assert.equal(result.status, "fallback");
  assert.equal(result.reason, "fact_guard");
  assert.equal(result.reply, baseReply);
});

test("bảng giá chung đầy đủ, chia hai khối và có câu hỏi nối tiếp được chấp nhận", () => {
  const bridge = new CodexLlmBridge({ enabled: true, runner: async () => "" });
  const reply = [
    "Dạ giá hiện tại:",
    "• 1 lọ: 285.000đ + 30.000đ phí giao.",
    "• Combo 2 lọ: 510.000đ, miễn phí giao, tiết kiệm 60.000đ.",
    "• Combo 3 lọ: 750.000đ, miễn phí giao.",
    "• Quà tặng: đơn từ 2 lọ trở lên được tặng 1 túi đa năng vải dệt Stopirex (1 túi/đơn).",
    "",
    "Combo chăm sóc mùi cơ thể:",
    "• 1 lăn Stopirex + 1 chai Herbal Body Wash 500ml: 525.000đ, miễn phí giao.",
    "• Herbal Body Wash hiện chưa bán lẻ.",
    "Anh/chị muốn chọn phương án mấy lọ ạ?",
  ].join("\n");
  const result = bridge.adoptInterpretedDraft({
    customerMessage: "giá",
    draftReply: reply,
    baseReply: reply,
    state: { ...state, pendingQuestionTopic: "quantity" },
    skillId: "direct-answer",
    knowledge: [{ id: "pricing-approved-options-2026-08", title: "Bảng giá", content: reply }],
    knowledgeIds: ["pricing-approved-options-2026-08"],
    groundingConfidence: 0.99,
    knowledgeGroundingRequired: true,
  });

  assert.equal(result.status, "enhanced");
  assert.equal(result.reply, reply);
});

test("LLM-first giữ câu grounded đúng dù base regex đang trả sai chủ đề", () => {
  const bridge = new CodexLlmBridge({ enabled: true, runner: async () => "" });
  const result = bridge.adoptInterpretedDraft({
    customerMessage: "Một lọ lăn bé tí tẹo thế này thì bôi được mấy tháng là cạn đầy vậy shop?",
    draftReply: "Dạ một lọ Stopirex thường dùng khoảng 3–4 tháng khi mình lăn mỏng 2–3 lần/tuần ạ.",
    baseReply:
      "Dạ mình dùng buổi tối khi da sạch, khô. Không dùng khi da trầy; nếu khó chịu thì tạm ngưng ạ.",
    state,
    knowledge: [
      {
        id: "usage-bottle-duration",
        title: "Thời gian sử dụng của một lọ",
        content:
          "Một lọ Stopirex thường dùng được khoảng 3–4 tháng khi lăn một lớp mỏng khoảng 2–3 lần/tuần theo hướng dẫn.",
      },
    ],
    knowledgeIds: ["usage-bottle-duration"],
    groundingConfidence: 0.98,
    knowledgeGroundingRequired: true,
  });

  assert.equal(result.status, "enhanced");
  assert.equal(result.reason, "single_pass_draft");
  assert.match(result.reply, /3–4 tháng/iu);
  assert.doesNotMatch(result.reply, /tạm ngưng|da trầy/iu);
});

test("single-pass draft bị loại nếu chốt số lượng nhưng bỏ mất câu trả lời hiệu quả", () => {
  const bridge = new CodexLlmBridge({ enabled: true, runner: async () => "" });
  const composed = bridge.adoptInterpretedDraft({
    customerMessage: "Nếu đúng như lời nói thì cho mình 1 lọ",
    draftReply: "Mình lấy 1 lọ nhé. Mình gửi thông tin nhận hàng để chốt đơn ạ.",
    baseReply:
      "Dạ Stopirex hỗ trợ kiểm soát mồ hôi tốt khi dùng đúng hướng dẫn ạ. Em ghi nhận mình lấy 1 lọ; mình gửi tên người nhận, SĐT và địa chỉ giúp em nhé.",
    state: { ...state, selectedQuantity: 1 },
    skillId: "order-closing",
  });

  assert.equal(composed.status, "fallback");
  assert.equal(composed.reason, "critical_direction_guard");
  assert.match(composed.reply, /kiểm soát mồ hôi/iu);
});

test("single-pass draft không được biến câu hỏi giá hiện tại thành lịch sử tăng giá", () => {
  const bridge = new CodexLlmBridge({ enabled: true, runner: async () => "" });
  const composed = bridge.adoptInterpretedDraft({
    customerMessage: "nay giá có đổi ko e",
    draftReply:
      "Dạ có ạ, hiện giá 1 lọ Stopirex là 285.000đ, phí giao 30.000đ. Lý do điều chỉnh là do chi phí nhập khẩu từ Pháp tăng ạ.",
    baseReply:
      "Dạ giá hiện tại chưa có thay đổi mới ạ: 1 lọ Stopirex 285.000đ + 30.000đ phí giao.",
    state,
  });

  assert.equal(composed.status, "fallback");
  assert.equal(composed.reason, "price_change_guard");
  assert.match(composed.reply, /chưa có thay đổi mới/iu);
  assert.doesNotMatch(composed.reply, /nhập khẩu|Pháp/iu);
});

test("single-pass draft không được khẳng định có mã vận đơn khi state không có mã", () => {
  const bridge = new CodexLlmBridge({ enabled: true, runner: async () => "" });
  const composed = bridge.adoptInterpretedDraft({
    customerMessage: "ib",
    draftReply:
      "Dạ đơn của mình đã có mã vận đơn nên em chưa thể tự sửa thông tin ạ.",
    baseReply: "Dạ em chào mình ạ. Mình cần em hỗ trợ về sản phẩm hay đơn hàng ạ?",
    state,
  });

  assert.equal(composed.status, "fallback");
  assert.equal(composed.reason, "action_grounding_guard");
  assert.doesNotMatch(composed.reply, /đã có mã vận đơn/iu);
});

test("Codex composer nhận lịch sử, quyết định và kiến thức được duyệt", async () => {
  let prompt = "";
  const bridge = new CodexLlmBridge({
    enabled: true,
    runner: async (value) => {
      prompt = value;
      return "Dạ mức giá được điều chỉnh do chi phí nhập khẩu từ Pháp tăng ạ.";
    },
  });
  await bridge.enhance({
    customerMessage: "Sao tăng giá vậy?",
    baseReply: "Dạ giá được điều chỉnh do chi phí nhập khẩu từ Pháp tăng ạ.",
    state: {
      ...state,
      recentTurns: [{ role: "user", text: "Trước em mua 245k" }],
      lastIntent: "price_change",
    },
    knowledge: [
      {
        id: "price-adjustment-france-import",
        title: "Lý do điều chỉnh giá",
        content: "Chi phí nhập khẩu sản phẩm từ Pháp tăng.",
      },
    ],
  });
  assert.match(prompt, /Trước em mua 245k/);
  assert.match(prompt, /price-adjustment-france-import/);
  assert.match(prompt, /không lộ từ nội bộ/);
  assert.match(prompt, /chỉ nên dùng 'Dạ' tối đa một lần/);
  assert.match(prompt, /ghi nhận đúng ý khách/);
  assert.match(prompt, /Kỷ luật Pipeline 6 bước/);
});

test("Routing Agent nhận RAG context ngay trong bước hiểu ý", async () => {
  let prompt = "";
  const bridge = new CodexLlmBridge({
    enabled: true,
    runner: async (value) => {
      prompt = value;
      return '{"intent":"product_comparison","topic":"comparison","confidence":0.99,"asksDirectAnswer":true}';
    },
  });

  const result = await bridge.interpret({
    customerMessage: "Khác lăn thường ở đâu?",
    state,
    knowledge: [
      {
        id: "product-comparison-traditional-rollon",
        title: "So sánh lăn thường",
        content: "Stopirex là dòng ngăn tiết mồ hôi chuyên sâu.",
      },
    ],
  });

  assert.equal(result.intent, "product_comparison");
  assert.match(prompt, /Routing Agent trung tâm/);
  assert.match(prompt, /product-comparison-traditional-rollon/);
  assert.match(prompt, /nguồn sự thật duy nhất/);
});

test("một lượt Routing Agent trả cả semantic và draft hội thoại", async () => {
  let calls = 0;
  const bridge = new CodexLlmBridge({
    enabled: true,
    runner: async () => {
      calls += 1;
      return JSON.stringify({
        skill: "solution-guidance",
        intent: "product_comparison",
        topic: "comparison",
        asksDirectAnswer: true,
        confidence: 0.98,
        draftReply: "Dạ điểm khác chính là cơ chế và tần suất dùng ạ. Em gửi cách dùng hay giá trước ạ?",
      });
    },
  });

  const interpreted = await bridge.interpret({
    customerMessage: "Khác lăn thường ở đâu?",
    state,
  });
  const composed = bridge.adoptInterpretedDraft({
    customerMessage: "Khác lăn thường ở đâu?",
    draftReply: interpreted.draftReply!,
    baseReply: "Dạ điểm khác chính là cơ chế và tần suất dùng ạ. Em gửi cách dùng hay giá trước ạ?",
    state,
    skillId: "solution-guidance",
  });

  assert.equal(calls, 1);
  assert.equal(interpreted.intent, "product_comparison");
  assert.equal(interpreted.skill, "solution-guidance");
  assert.equal(composed.status, "enhanced");
  assert.equal(composed.reason, "single_pass_draft");
});

test("Routing Agent nhận catalog skill nhưng vẫn chỉ gọi model một lần", async () => {
  let calls = 0;
  let prompt = "";
  const bridge = new CodexLlmBridge({
    enabled: true,
    runner: async (value) => {
      calls += 1;
      prompt = value;
      return JSON.stringify({
        skill: "pricing-objection",
        intent: "price_request",
        topic: "price",
        asksDirectAnswer: true,
        confidence: 0.99,
        draftReply:
          "Dạ 1 lọ là 285.000đ và phí giao 30.000đ; combo 2 lọ 510.000đ, miễn phí giao ạ. Mình chọn 1 lọ hay combo ạ?",
      });
    },
  });

  const result = await bridge.interpret({
    customerMessage: "Giá bao nhiêu?",
    state,
  });

  assert.equal(calls, 1);
  assert.equal(result.skill, "pricing-objection");
  assert.match(prompt, /Chọn đúng một skill chính/);
  assert.match(prompt, /không mô phỏng nhiều agent hoặc nhiều bước gọi model/);
  assert.match(prompt, /trả lời đúng cực tính ngay câu đầu/);
  assert.match(prompt, /xác định đúng sản phẩm gây sự cố/iu);
  assert.match(prompt, /trả lời đúng cực tính ngay câu đầu/iu);
  assert.match(prompt, /không tự dùng 'tùy cơ địa'/iu);
});

test("single-pass draft bị loại nếu làm mất chỉ dẫn chuyển người", () => {
  const bridge = new CodexLlmBridge({
    enabled: true,
    runner: async () => "{}",
  });
  const baseReply =
    "Dạ nội dung này cần kiểm tra thêm. Anh gửi em đường link nhé. Em chuyển bộ phận liên quan kiểm tra và phản hồi lại mình ạ.";
  const result = bridge.adoptInterpretedDraft({
    customerMessage: "Có giảm 75k không?",
    draftReply: "Dạ anh gửi em đường link nhé ạ.",
    baseReply,
    state,
  });

  assert.equal(result.status, "fallback");
  assert.equal(result.reason, "critical_direction_guard");
  assert.equal(result.reply, baseReply);
});

test("single-pass draft bị loại nếu làm mất giới hạn hiệu quả thực tế", () => {
  const bridge = new CodexLlmBridge({
    enabled: true,
    runner: async () => "{}",
  });
  const baseReply =
    "Dạ Stopirex hỗ trợ kiểm soát mồ hôi. Hiệu quả còn tùy cơ địa và cách dùng nên bên em không cam kết hết tuyệt đối ạ. Mình muốn xem cách dùng không ạ?";
  const result = bridge.adoptInterpretedDraft({
    customerMessage: "Có cam kết hết 100% không?",
    draftReply: "Dạ Stopirex hỗ trợ kiểm soát mồ hôi ạ. Mình muốn xem cách dùng không ạ?",
    baseReply,
    state,
  });

  assert.equal(result.status, "fallback");
  assert.equal(result.reason, "critical_direction_guard");
  assert.equal(result.reply, baseReply);
});

test("single-pass chặn hàm ý chỉ đơn trực tiếp mới là hàng chính hãng", () => {
  const bridge = new CodexLlmBridge({
    enabled: true,
    runner: async () => "{}",
  });
  const baseReply =
    "Dạ sản phẩm Stopirex bên em cung cấp là hàng chính hãng. Khi nhận, mình có thể đối chiếu bao bì, tem, đúng tên sản phẩm và thông tin người gửi ạ.";
  const result = bridge.adoptInterpretedDraft({
    customerMessage: "Có gì đảm bảo sản phẩm chính hãng không?",
    draftReply: "Dạ đơn đặt trực tiếp được gửi đúng hàng chính hãng; khi nhận mình kiểm tra bao bì và tem ạ.",
    baseReply,
    state,
  });

  assert.equal(result.status, "fallback");
  assert.equal(result.reason, "critical_direction_guard");
  assert.equal(result.reply, baseReply);
});

test("single-pass không được đổi 2–3 lần/tuần thành đơn vị khác", () => {
  const bridge = new CodexLlmBridge({
    enabled: true,
    runner: async () => "{}",
  });
  const baseReply =
    "Dạ mình dùng Stopirex 2–3 lần/tuần ạ. Stopirex không dùng hương thơm để che mùi nên không làm lẫn hương Romano.";
  const result = bridge.adoptInterpretedDraft({
    customerMessage: "Thế 1 tuần bôi mấy lần? Sáng ra mình quệt thêm Romano có bị lộn mùi không?",
    draftReply:
      "Dạ mình dùng giãn cách 2–3 ngày/lần. Stopirex không dùng hương thơm để che mùi nên không làm lẫn hương Romano.",
    baseReply,
    state,
    knowledge: [
      {
        id: "usage-general",
        title: "Tần suất sử dụng",
        content: "Stopirex dùng khoảng 2–3 lần/tuần theo hướng dẫn.",
      },
      {
        id: "usage-morning-fragrance-layering",
        title: "Dùng cùng lăn khử mùi có hương",
        content: "Stopirex không dùng hương thơm để che mùi nên không làm lẫn hương của lăn khử mùi khác.",
      },
    ],
    knowledgeIds: ["usage-general", "usage-morning-fragrance-layering"],
    groundingConfidence: 0.98,
    knowledgeGroundingRequired: true,
  });

  assert.equal(result.status, "fallback");
  assert.equal(result.reason, "critical_direction_guard");
  assert.equal(result.reply, baseReply);
});

test("single-pass chặn lời thoái thác khi khách không hỏi cam kết tuyệt đối", () => {
  const bridge = new CodexLlmBridge({
    enabled: true,
    runner: async () => "{}",
  });
  const baseReply = "Dạ Stopirex hỗ trợ kiểm soát mồ hôi khi mình dùng đúng hướng dẫn ạ.";
  const result = bridge.adoptInterpretedDraft({
    customerMessage: "Loại này có hiệu quả không?",
    draftReply: "Dạ Stopirex hỗ trợ kiểm soát mồ hôi, nhưng hiệu quả tùy cơ địa và bên em không cam kết ạ.",
    baseReply,
    state,
  });

  assert.equal(result.status, "fallback");
  assert.equal(result.reason, "advisor_voice_guard");
  assert.equal(result.reply, baseReply);
});

test("production cho phép LLM giữ draft khi chỉ vi phạm guard giọng văn mềm", () => {
  const bridge = new CodexLlmBridge({ enabled: true, runner: async () => "{}" });
  const result = bridge.adoptInterpretedDraft({
    customerMessage: "Loại này có hiệu quả không?",
    draftReply: "Dạ Stopirex hỗ trợ kiểm soát mồ hôi, nhưng hiệu quả tùy cơ địa và bên em không cam kết ạ.",
    baseReply: "Dạ Stopirex hỗ trợ kiểm soát mồ hôi khi mình dùng đúng hướng dẫn ạ.",
    state,
    softStylePolicy: "warn",
  });

  assert.equal(result.status, "enhanced");
  assert.equal(result.reason, "single_pass_draft_soft_warning:advisor_voice_guard");
});

test("single-pass chặn câu xưng hô lặp khó hiểu", () => {
  const bridge = new CodexLlmBridge({ enabled: true, runner: async () => "" });
  const composed = bridge.adoptInterpretedDraft({
    customerMessage: "Da mỏng dùng có bị rát không?",
    draftReply: "Phần này mình cần mình xác minh thêm.",
    baseReply: "Dạ da mỏng vẫn có thể dùng Stopirex khi dùng đúng hướng dẫn ạ.",
    state,
    skillId: "safety-first",
  });

  assert.equal(composed.status, "fallback");
  assert.equal(composed.reason, "advisor_voice_guard");
});

test("single-pass không nối lại câu hỏi đối tượng khi lịch sử đã xác nhận bé 15 tuổi", () => {
  const bridge = new CodexLlmBridge({ enabled: true, runner: async () => "" });
  const composed = bridge.adoptInterpretedDraft({
    customerMessage: "liệu có an toàn cho da ko e\nhàng giả h nhiều lắm",
    draftReply:
      "Dạ mẫu thử Stopirex có mức kích ứng da không đáng kể. Khi nhận hàng, mình kiểm tra tem và thông tin người gửi giúp em nhé ạ.",
    baseReply: "Dạ mình đang hỏi cho bé, phụ nữ mang thai/cho con bú hay người có da nhạy cảm ạ?",
    state: {
      ...state,
      customerProfile: { age: 15 },
      answeredTopics: ["child_age"],
      recentTurns: [
        { role: "user", text: "Chị mua cho con trai 15 tuổi" },
        { role: "assistant", text: "Dạ bé 15 tuổi dùng được rồi ạ." },
      ],
    },
  });

  assert.equal(composed.status, "enhanced");
  assert.doesNotMatch(composed.reply, /mình đang hỏi cho bé|phụ nữ mang thai|cho con bú/iu);
});

test("Tone guard chặn cách bác bỏ cộc lốc hoặc tranh cãi", () => {
  const bridge = new CodexLlmBridge({ enabled: true, runner: async () => "" });
  const composed = bridge.adoptInterpretedDraft({
    customerMessage: "Stopirex có nọc rắn đúng không?",
    draftReply: "Thông tin đó là sai. Bạn đừng bịa đặt về sản phẩm.",
    baseReply: "Dạ bên em chưa có thông tin sản phẩm như mình nói ạ.",
    state,
  });

  assert.equal(composed.status, "fallback");
  assert.equal(composed.reason, "advisor_voice_guard");
});

test("prompt giữ 6 trao đổi hoàn chỉnh và che PII trước khi gửi LLM", () => {
  const recentTurns = Array.from({ length: 16 }, (_, index) => ({
    role: index % 2 === 0 ? ("user" as const) : ("assistant" as const),
    text: index === 14 ? "SĐT của mình 0987654321" : `lượt-${index}`,
  }));
  const prompt = buildInterpretPromptForDiagnostics(
    {
      customerMessage: "Thế loại màu xanh thì sao?",
      state: { ...state, recentTurns },
      knowledge: [],
    },
    "compact",
  );

  assert.doesNotMatch(prompt, /lượt-[0-3]"/);
  assert.match(prompt, /lượt-4/);
  assert.match(prompt, /\[SĐT ĐÃ ẨN\]/u);
  assert.doesNotMatch(prompt, /0987654321/);
});

test("prompt compact ghi nhớ luận điểm đã dùng và vừa bị khách phản bác", () => {
  const prompt = buildInterpretPromptForDiagnostics(
    {
      customerMessage: "Lăn siêu thị cũng dùng 3-4 tháng mà có mấy chục nghìn thôi",
      state: {
        ...state,
        recentTurns: [
          {
            role: "assistant",
            text: "Một lọ Stopirex dùng khoảng 3-4 tháng nên tính theo thời gian sẽ dễ cân nhắc hơn ạ.",
          },
          { role: "user", text: "Lăn siêu thị cũng dùng 3-4 tháng mà có mấy chục nghìn thôi" },
        ],
      },
      knowledge: [],
    },
    "compact",
  );

  assert.match(prompt, /"usedArguments":\["duration_or_cost"\]/u);
  assert.match(prompt, /"rejectedArguments":\["duration_or_cost"\]/u);
  assert.match(prompt, /Không lặp luận điểm đã dùng hoặc vừa bị khách phản bác/u);
});

test("handoff mềm về khuyến mãi không làm LLM bị bỏ qua ở lượt tư vấn sau", async () => {
  const bridge = new CodexLlmBridge({
    enabled: true,
    runner: async () =>
      '{"intent":"product_effect","confidence":0.98,"asksDirectAnswer":true,"draftReply":"Dạ Stopirex hỗ trợ kiểm soát cả mồ hôi và mùi ạ. Mình muốn xem cách dùng không ạ?"}',
  });
  const result = await bridge.interpret({
    customerMessage: "Vừa mồ hôi vừa có mùi có hiệu quả không?",
    state: {
      ...state,
      consultationStage: "H.handoff",
      pipeline: "C3.Chờ CSKH",
      signal: "CT.Giá/Ship",
      handoffReason: "promotion_not_verified",
    },
  });

  assert.equal(result.status, "interpreted");
  assert.equal(result.intent, "product_effect");
});

test("commerce guard chặn LLM tự thêm giảm giá hoặc freeship", async () => {
  const baseReply = "Dạ giá hiện tại là 285.000đ/lọ. Mình muốn chọn 1 lọ trải nghiệm không ạ?";
  const bridge = new CodexLlmBridge({
    enabled: true,
    runner: async () =>
      "Dạ giá hiện tại là 285.000đ/lọ, em giảm thêm 50% và freeship nhé. Mình chốt 1 lọ không ạ?",
  });

  const result = await bridge.enhance({
    customerMessage: "Bớt thêm được không?",
    baseReply,
    state,
  });

  assert.equal(result.status, "fallback");
  assert.equal(result.reason, "commerce_guard");
  assert.equal(result.reply, baseReply);
});

test("direction guard không cho bản viết lại làm mất câu dẫn chốt bước", async () => {
  const baseReply = "Stopirex hỗ trợ kiểm soát mồ hôi khi dùng đúng cách. Mình muốn xem bảng giá không ạ?";
  const bridge = new CodexLlmBridge({
    enabled: true,
    runner: async () => "Stopirex hỗ trợ kiểm soát mồ hôi khi dùng đúng cách.",
  });

  const result = await bridge.enhance({
    customerMessage: "Có hiệu quả không?",
    baseReply,
    state,
  });

  assert.equal(result.status, "fallback");
  assert.equal(result.reason, "direction_guard");
  assert.equal(result.reply, baseReply);
});

test("Codex viết lại khung mở đầu theo tone voice nhưng giữ đủ lựa chọn", async () => {
  let prompt = "";
  const bridge = new CodexLlmBridge({
    enabled: true,
    runner: async (value) => {
      prompt = value;
      return [
        "Dạ, để em hỗ trợ đúng điều mình cần nhất nhé.",
        "1. Mình muốn kiểm tra tình trạng trước",
        "2. Mình muốn xem bảng giá trước",
        "Anh chọn 1 hoặc 2 giúp em nhé?",
      ].join("\n");
    },
  });
  const result = await bridge.enhanceOpening({
    baseReply:
      "Dạ anh muốn em hỗ trợ theo cách nào trước ạ?\n\n1. Mình muốn kiểm tra tình trạng trước\n2. Mình muốn xem bảng giá trước\n\nAnh chọn 1 hoặc 2 ạ.",
    variantId: "A.choice",
    styleSeed: "session-01",
  });

  assert.equal(result.status, "enhanced");
  assert.match(result.reply, /1\. Mình muốn kiểm tra/);
  assert.match(result.reply, /2\. Mình muốn xem bảng giá/);
  assert.match(prompt, /không phải câu phải sao chép nguyên văn/);
  assert.match(prompt, /không bắt đầu tin này bằng 'Dạ'/);
  assert.match(prompt, /Phải viết lại wording của mọi khối/);
  assert.match(prompt, /Phong cách riêng của phiên/);
  assert.match(prompt, /session-01/);
});

test("Codex viết lại mở đầu bị fallback nếu làm mất lựa chọn nghiệp vụ", async () => {
  const bridge = new CodexLlmBridge({
    enabled: true,
    runner: async () => "Dạ mình muốn tư vấn theo hướng nào trước?",
  });
  const baseReply = "Dạ mình chọn giúp em:\n1. Tư vấn tình trạng\n2. Xem bảng giá";
  const result = await bridge.enhanceOpening({
    baseReply,
    variantId: "A.choice",
  });

  assert.equal(result.status, "fallback");
  assert.equal(result.reason, "structure_guard");
  assert.equal(result.reply, baseReply);
});

test("Codex viết lại mở đầu bị fallback nếu làm mất câu hỏi dẫn khách", async () => {
  const bridge = new CodexLlmBridge({
    enabled: true,
    runner: async () =>
      "Em có thể hỗ trợ tình trạng mồ hôi/mùi, cách dùng hoặc bảng giá.\n\nMình nhắn nội dung cần hỗ trợ nhé.",
  });
  const baseReply =
    "Em có thể hỗ trợ tình trạng mồ hôi/mùi, cách dùng hoặc bảng giá.\n\nAnh/chị muốn bắt đầu từ phần nào ạ?";
  const result = await bridge.enhanceOpening({
    baseReply,
    variantId: "AUTO.dynamic",
    includeGreeting: true,
  });

  assert.equal(result.status, "fallback");
  assert.equal(result.reason, "structure_guard");
  assert.equal(result.reply, baseReply);
});

test("Codex viết lại toàn bộ gói mở đầu nhưng không được làm mất biến danh tính", async () => {
  let prompt = "";
  const bridge = new CodexLlmBridge({
    enabled: true,
    runner: async (value) => {
      prompt = value;
      return [
        "Em chào {{CUSTOMER_ADDRESS}} nhé! Em là {{STAFF_IDENTITY}}, rất vui được hỗ trợ mình.",
        "Mình muốn được tư vấn tình trạng trước hay xem bảng giá trước?",
      ].join("\n\n");
    },
  });
  const result = await bridge.enhanceOpening({
    baseReply:
      "Dạ em chào {{CUSTOMER_ADDRESS}} ạ! Em là {{STAFF_IDENTITY}} đây ạ.\n\nMình muốn tư vấn trước hay xem giá trước?",
    variantId: "A.choice",
    styleSeed: "bundle-01",
    includeGreeting: true,
  });

  assert.equal(result.status, "enhanced");
  assert.match(result.reply, /\{\{CUSTOMER_ADDRESS\}\}/);
  assert.match(result.reply, /\{\{STAFF_IDENTITY\}\}/);
  assert.match(prompt, /Viết lại cả lời chào/);
  assert.doesNotMatch(prompt, /Minh|Mai Lan/);
});

test("Codex bridge vẫn đọc toàn bộ tin chứa SĐT để không bỏ sót câu hỏi đi kèm", async () => {
  let called = false;
  const bridge = new CodexLlmBridge({
    enabled: true,
    runner: async () => {
      called = true;
      return "Dạ em đã ghi nhận thông tin mình gửi ạ.";
    },
  });
  const result = await bridge.enhance({
    customerMessage: "SĐT của mình là 0912345678",
    baseReply: "Dạ em đã ghi nhận ạ.",
    state,
  });
  assert.equal(result.status, "enhanced");
  assert.equal(called, true);
});

test("Codex vẫn là bộ não đọc ngữ cảnh trong flow CSKH", async () => {
  let called = false;
  const bridge = new CodexLlmBridge({
    enabled: true,
    runner: async () => {
      called = true;
      return '{"intent":"ineffective","topic":"effectiveness","scenario":"actual","asksDirectAnswer":true,"confidence":0.98,"evidence":["dùng rồi vẫn ra mồ hôi"]}';
    },
  });

  const result = await bridge.interpret({
    customerMessage: "Mình dùng rồi nhưng vẫn ra mồ hôi",
    state: {
      ...state,
      mode: "care",
      careIssue: "ineffective",
      journeyStage: "C2.diagnose",
    },
  });

  assert.equal(called, true);
  assert.equal(result.status, "interpreted");
  assert.equal(result.intent, "ineffective");
  assert.equal(result.scenario, "actual");
});

test("Codex vẫn xử lý câu hỏi không chứa PII khi đang làm đơn", async () => {
  let called = false;
  const bridge = new CodexLlmBridge({
    enabled: true,
    runner: async () => {
      called = true;
      return '{"intent":"negotiation","topic":"price","asksDirectAnswer":true}';
    },
  });
  const result = await bridge.interpret({
    customerMessage: "giảm giá nữa k",
    state: { ...state, selectedQuantity: 1, consultationStage: "S8.order" },
  });
  assert.equal(result.status, "interpreted");
  assert.equal(result.intent, "negotiation");
  assert.equal(called, true);
});

test("Codex bóc tách câu hỏi xác minh chương trình và số tiền giảm", async () => {
  const bridge = new CodexLlmBridge({
    enabled: true,
    runner: async () =>
      '{"intent":"promotion_inquiry","topic":"promotion","discountAmountVnd":75000,"asksDirectAnswer":true,"confidence":0.98}',
  });
  const result = await bridge.interpret({
    customerMessage: "Sao thấy có chương trình giảm 75k phải không shop",
    state,
  });

  assert.equal(result.intent, "promotion_inquiry");
  assert.equal(result.topic, "promotion");
  assert.equal(result.discountAmountVnd, 75_000);
  assert.equal(result.asksDirectAnswer, true);
});

test("Codex composer fallback nếu làm mất giá bắt buộc", async () => {
  const bridge = new CodexLlmBridge({
    enabled: true,
    runner: async () => "Dạ em gửi giá để mình tham khảo ạ.",
  });
  const result = await bridge.enhance({
    customerMessage: "Giá bao nhiêu?",
    baseReply: "Dạ 1 lọ giá 285.000đ và combo giá 510.000đ ạ.",
    state,
  });
  assert.equal(result.status, "fallback");
  assert.match(result.reply, /285\.000đ/);
});

test("Codex bridge fallback khi LLM sinh claim bị chặn", async () => {
  const bridge = new CodexLlmBridge({
    enabled: true,
    runner: async () => "Sản phẩm giúp khô thoáng tuyệt đối.",
  });
  const result = await bridge.enhance({
    customerMessage: "Có hiệu quả không?",
    baseReply: "Stopirex hỗ trợ kiểm soát mồ hôi khi dùng đúng hướng dẫn ạ.",
    state,
  });
  assert.equal(result.status, "fallback");
  assert.equal(result.reason, "claim_guard");
  assert.equal(result.reply, "Stopirex hỗ trợ kiểm soát mồ hôi khi dùng đúng hướng dẫn ạ.");
});

test("đọc đúng agent_message cuối từ JSONL của Codex CLI", () => {
  const output = [
    '{"type":"thread.started","thread_id":"demo"}',
    '{"type":"item.completed","item":{"type":"agent_message","text":"Xin chào"}}',
  ].join("\n");
  assert.equal(parseCodexJsonl(output), "Xin chào");
});

test("Codex hiểu ý trước rồi trả slot cấu trúc cho state machine", async () => {
  const bridge = new CodexLlmBridge({
    enabled: true,
    runner: async () =>
      '{"workContext":"outdoor_heavy","primarySymptom":null,"priorProduct":null,"priorIrritation":null}',
  });
  const result = await bridge.interpret({
    customerMessage: "Anh chỉ bị lúc đánh padel thôi",
    state,
  });
  assert.equal(result.status, "interpreted");
  assert.deepEqual(result.slots, { workContext: "outdoor_heavy" });
});

test("Codex nhận diện câu hỏi trực tiếp và dữ liệu đổi giá", async () => {
  const bridge = new CodexLlmBridge({
    enabled: true,
    runner: async () =>
      '{"intent":"price_change","asksDirectAnswer":true,"priceFromVnd":245000,"priceToVnd":285000}',
  });
  const result = await bridge.interpret({
    customerMessage: "245k giờ lên giá 285k",
    state,
  });
  assert.equal(result.intent, "price_change");
  assert.equal(result.asksDirectAnswer, true);
  assert.equal(result.priceFromVnd, 245000);
  assert.deepEqual(result.slots, {});
});

test("semantic parser nhận intent so sánh sản phẩm", () => {
  const result = parseSemanticUnderstanding(
    '{"intent":"product_comparison","topic":"comparison","subject":"product","confidence":0.99,"asksDirectAnswer":true}',
  );
  assert.equal(result.intent, "product_comparison");
  assert.equal(result.topic, "comparison");
  assert.equal(result.subject, "product");
  assert.equal(result.asksDirectAnswer, true);
});

test("semantic parser nhận kế hoạch kiểm chứng ngắn, không phải chain-of-thought", () => {
  const result = parseSemanticUnderstanding(
    JSON.stringify({
      answeredQuestions: ["so sánh giá", "cơ chế"],
      newAngle: "mechanism",
      rejectedArguments: ["duration_or_cost"],
      nextStep: "ask_discovery",
    }),
  );

  assert.deepEqual(result.answeredQuestions, ["so sánh giá", "cơ chế"]);
  assert.equal(result.newAngle, "mechanism");
  assert.deepEqual(result.rejectedArguments, ["duration_or_cost"]);
  assert.equal(result.nextStep, "ask_discovery");
});

test("Codex composer fallback nếu làm mất mốc dùng giãn cách", async () => {
  const bridge = new CodexLlmBridge({
    enabled: true,
    runner: async () => "Dạ Stopirex là dòng ngăn tiết mồ hôi chuyên sâu, khác lăn thông thường ạ.",
  });
  const result = await bridge.enhance({
    customerMessage: "Khác gì lăn truyền thống?",
    baseReply:
      "Dạ Stopirex là dòng ngăn tiết mồ hôi chuyên sâu, sau giai đoạn làm quen thường dùng giãn cách 2–3 ngày/lần ạ.",
    state,
  });
  assert.equal(result.status, "fallback");
  assert.match(result.reply, /2–3 ngày\/lần/);
});

test("Codex chấp nhận cách viết tự nhiên tương đương của tần suất", async () => {
  const bridge = new CodexLlmBridge({
    enabled: true,
    runner: async () =>
      "Stopirex dùng buổi tối khoảng 2 đến 3 lần mỗi tuần. Mình đang dùng lăn nách hằng ngày không?",
  });
  const result = await bridge.enhanceOpening({
    baseReply: "Stopirex dùng buổi tối 2–3 lần/tuần. Mình đang dùng lăn nách hằng ngày không?",
    variantId: "C.prior",
  });

  assert.equal(result.status, "enhanced");
  assert.match(result.reply, /2 đến 3 lần mỗi tuần/);
});

test("prompt hiểu ý nhận các lượt chat gần nhất", async () => {
  let prompt = "";
  const bridge = new CodexLlmBridge({
    enabled: true,
    runner: async (value) => {
      prompt = value;
      return '{"intent":"usage_time","asksDirectAnswer":true,"primarySymptom":"both"}';
    },
  });
  await bridge.interpret({
    customerMessage: "Dùng buổi sáng được không?",
    state: {
      ...state,
      recentTurns: [{ role: "user", text: "Mình làm cả ngày và sợ bị mùi" }],
    },
  });
  assert.match(prompt, /Mình làm cả ngày và sợ bị mùi/);
  assert.match(prompt, /usage_time/);
  assert.match(prompt, /CONVERSATION_MEMORY/);
});

test("semantic parser chỉ nhận giá trị nằm trong schema", () => {
  assert.deepEqual(
    parseSemanticSlots(
      '```json\n{"workContext":"both","primarySymptom":"odor","priorProduct":"invented"}\n```',
    ),
    { workContext: "both", primarySymptom: "odor" },
  );
});

test("semantic parser đọc chủ đề, chủ thể, pending reply và độ tin cậy", () => {
  const bridgeResult = parseSemanticUnderstanding(
    '{"intent":"safety","topic":"child_age","subject":"child","age":13,"confidence":0.98,"needsClarification":false,"evidence":["bé nhà chị","13 tuổi"]}',
  );
  assert.equal(bridgeResult.intent, "safety");
  assert.equal(bridgeResult.topic, "child_age");
  assert.equal(bridgeResult.subject, "child");
  assert.equal(bridgeResult.age, 13);
  assert.equal(bridgeResult.confidence, 0.98);
  assert.deepEqual(bridgeResult.evidence, ["bé nhà chị", "13 tuổi"]);
});

test("semantic parser phân biệt giả định với tình trạng đang xảy ra", () => {
  const result = parseSemanticUnderstanding(
    '{"intent":"safety","topic":"irritation","scenario":"hypothetical","confidence":0.99,"asksDirectAnswer":true}',
  );
  assert.equal(result.intent, "safety");
  assert.equal(result.topic, "irritation");
  assert.equal(result.scenario, "hypothetical");
});

test("semantic parser không chấp nhận JSON rỗng hoặc thiếu contract bắt buộc", () => {
  assert.throws(() => parseSemanticUnderstanding("{}"), /không có intent, action hoặc draftReply/u);
  assert.throws(
    () => parseSemanticUnderstanding('{"intent":"other"}', { strict: true }),
    /Structured Output thiếu trường/u,
  );
});

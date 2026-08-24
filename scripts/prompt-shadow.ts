import { retrieveKnowledge } from "../src/domain/knowledge.js";
import { reconcileConversationActions } from "../src/domain/conversationActions.js";
import type { CustomerIntent } from "../src/domain/consultation.js";
import { stopirexApprovedKnowledge } from "../src/domain/stopirexKnowledge.js";
import { tenantId } from "../src/domain/types.js";
import {
  buildInterpretPromptForDiagnostics,
  CodexLlmBridge,
  requiresKnowledgeGrounding,
} from "../src/services/codexLlm.js";
import { DemoChatService, type DemoChatState } from "../src/services/demoChat.js";

type ShadowCase = {
  id: string;
  message: string;
  expectedIntents: readonly string[];
  requiredActions: readonly string[];
  forbiddenActions?: readonly string[];
  rejectDraft?: RegExp;
  requireFinalReply?: RegExp;
  rejectFinalReply?: RegExp;
  reconcile?: {
    exactIntent?: CustomerIntent;
    detectedCareIssue?: "irritation";
    careScenario?: "actual" | "hypothetical";
    priorOtherProductAdverseExperience?: boolean;
  };
  prepare?: (chat: DemoChatService) => DemoChatState;
};

const knowledgeTenant = tenantId("stopirex-prompt-shadow");
const knowledge = stopirexApprovedKnowledge(knowledgeTenant);
const cases: readonly ShadowCase[] = [
  {
    id: "botox-comparison",
    message:
      "Giá và miễn ship mình nắm rồi. Trước mình cắt tuyến mồ hôi, tiêm botox mà một thời gian lại bị. Stopirex có ăn thua không?",
    expectedIntents: ["product_comparison"],
    requiredActions: ["answer_question"],
    requireFinalReply: /cắt tuyến|botox/iu,
    rejectDraft: /Dạ có ạ.*hỗ trợ kiểm soát tiết mồ hôi/isu,
    reconcile: { exactIntent: "product_comparison" },
  },
  {
    id: "permanent-or-control",
    message: "Nó là thuốc chữa dứt điểm hay chỉ ngăn tạm thời thôi? Ngừng bôi là mồ hôi lại ra à?",
    expectedIntents: ["product_effect", "knowledge_unknown"],
    requiredActions: ["answer_question"],
    rejectDraft: /^Dạ có(?: ạ)?[.!]/iu,
    requireFinalReply: /không phải.*chữa dứt điểm|không.*dứt điểm/iu,
    rejectFinalReply: /Dạ có ạ.*kiểm soát/isu,
  },
  {
    id: "multi-action-buy",
    message: "Nếu đúng như lời nói thì cho mình 1 lọ",
    expectedIntents: ["buying"],
    requiredActions: ["answer_question", "select_quantity", "continue_order_collection"],
    requireFinalReply: /theo dõi trong 2 tuần đầu.*ghi nhận mình lấy 1 lọ/isu,
    reconcile: { exactIntent: "buying" },
  },
  {
    id: "multi-question-buy-vat",
    message:
      "Mình muốn lấy 1 lọ. Cho mình hỏi bôi xong sáng hôm sau tắm lại bằng xà phòng thì có mất tác dụng không? Và shop có xuất hóa đơn VAT điện tử cho đơn này luôn được không?",
    expectedIntents: ["buying", "usage_guidance", "knowledge_unknown"],
    requiredActions: ["answer_question", "select_quantity", "continue_order_collection"],
    requireFinalReply: /xà phòng|VAT/iu,
    rejectFinalReply: /tên người nhận|SĐT|địa chỉ trước sáp nhập/iu,
    reconcile: { exactIntent: "buying" },
  },
  {
    id: "safety-before-order",
    message: "Da đang đỏ rát nhưng nếu ổn thì lấy 1 lọ",
    expectedIntents: ["safety"],
    requiredActions: ["start_customer_care", "answer_question", "pause_order"],
    forbiddenActions: ["select_quantity"],
    rejectDraft: /ghi nhận.*1 lọ/iu,
    requireFinalReply: /tạm ngưng/iu,
    rejectFinalReply: /ghi nhận.*1 lọ/iu,
    reconcile: {
      exactIntent: "buying",
      detectedCareIssue: "irritation",
      careScenario: "actual",
    },
  },
  {
    id: "application-feel-clothing",
    message: "Bôi cái này lúc mới lăn lên nó có bị ướt nhẹp hay bết dính, ố ra áo sơ mi trắng không shop?",
    expectedIntents: ["product_effect"],
    requiredActions: ["answer_question"],
    requireFinalReply: /khô nhanh|khô hoàn toàn|khô hẳn|không bám|không (?:gây )?ố/iu,
    rejectFinalReply: /chưa thấy thông tin|chuyển nhân viên/iu,
    reconcile: { exactIntent: "product_effect" },
  },
  {
    id: "dialect-usage-feel-refund",
    message:
      "alo shop ấy, họa m thấy qc trên tóp top. lọ số tốp pi réch này xài tnao đấy? bôi xong có bị bết k nhỉ? mk bị hôi nách nặng từ hồi c3 rồ, dùng bh loại k khỏi. nếu mức 1 c mà k đỡ có dc hoàn xèng k. t ship về tp thái bình",
    expectedIntents: ["usage_guidance", "order_support", "product_effect"],
    requiredActions: ["answer_question"],
    forbiddenActions: ["continue_order_collection", "select_quantity", "handoff_to_human"],
    requireFinalReply: /(?=[\s\S]*không bết)(?=[\s\S]*2 tuần)(?=[\s\S]*hoàn tiền)/iu,
    rejectFinalReply: /chưa có đủ thông tin|chuyển bộ phận liên quan/iu,
  },
  {
    id: "gym-sweat-washoff",
    message:
      "Chiều nào mình cũng tập gym với đá bóng. Bôi xong ra mồ hôi đầm đìa thì có bị trôi mất tác dụng không?",
    expectedIntents: ["product_effect"],
    requiredActions: ["answer_question"],
    requireFinalReply: /không|không bị trôi/iu,
    rejectFinalReply: /^Dạ có(?: ạ)?[.!]/iu,
    reconcile: { exactIntent: "product_effect" },
  },
  {
    id: "prior-product-irritation",
    message:
      "Trước mình mua mấy loại lăn quảng cáo trên mạng, dùng vài bữa lại viêm cả cánh. Loại nhà mình có xịn thật không hay lại như thế?",
    expectedIntents: ["product_comparison"],
    requiredActions: ["answer_question"],
    forbiddenActions: ["start_customer_care"],
    requireFinalReply: /công thức dịu nhẹ|da nhạy cảm|dùng đúng hướng dẫn/iu,
    rejectFinalReply: /vùng da.*đang|tạm ngưng sử dụng|xác minh thêm lô hàng|kiểm tra lô hàng/iu,
    reconcile: {
      exactIntent: "product_comparison",
      detectedCareIssue: "irritation",
      careScenario: "actual",
      priorOtherProductAdverseExperience: true,
    },
  },
  {
    id: "bottle-duration",
    message: "Một lọ bé thế thì dùng được mấy tháng?",
    expectedIntents: ["usage_frequency"],
    requiredActions: ["answer_question"],
    requireFinalReply: /3–4 tháng|3-4 tháng/iu,
    rejectFinalReply: /tiếp tục combo|địa chỉ trước sáp nhập/iu,
    reconcile: { exactIntent: "usage_frequency" },
  },
  {
    id: "bottle-duration-boi-can",
    message: "Một lọ lăn bé tí tẹo thế này thì bôi được mấy tháng là cạn đầy vậy shop?",
    expectedIntents: ["usage_frequency"],
    requiredActions: ["answer_question"],
    requireFinalReply: /3–4 tháng|3-4 tháng/iu,
    rejectFinalReply: /sau cạo|wax|tạm ngưng|da trầy/iu,
    reconcile: { exactIntent: "usage_frequency" },
  },
  {
    id: "price-objection",
    message: "Giá hơi cao nhỉ, bên khác bán rẻ hơn.",
    expectedIntents: ["price_objection"],
    requiredActions: ["answer_question"],
    requireFinalReply: /nhập khẩu từ Pháp|ngăn tiết mồ hôi chuyên sâu/iu,
    rejectFinalReply: /trải nghiệm trước/iu,
    reconcile: { exactIntent: "price_objection" },
  },
  {
    id: "hypothetical-irritation",
    message: "Da mình mỏng, dùng có bị ngứa rát hay thâm nách không?",
    expectedIntents: ["safety"],
    requiredActions: ["answer_question"],
    forbiddenActions: ["start_customer_care"],
    rejectFinalReply: /rất tiếc.*sau khi dùng|đang bị khó chịu|mình cần mình|em cần em/isu,
    reconcile: {
      exactIntent: "safety",
      detectedCareIssue: "irritation",
      careScenario: "hypothetical",
    },
  },
];

const selectedCaseIds = new Set(
  (process.env.PROMPT_SHADOW_CASES ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean),
);
const selectedCases = selectedCaseIds.size > 0 ? cases.filter((item) => selectedCaseIds.has(item.id)) : cases;

const promptProfile = process.env.PROMPT_SHADOW_PROFILE === "legacy" ? "legacy" : "compact";
const bridge = CodexLlmBridge.fromEnvironment({
  ...process.env,
  LLM_PROVIDER: "codex",
  LLM_ENABLED: "true",
  LLM_PROMPT_PROFILE: promptProfile,
  CODEX_LLM_TIMEOUT_MS: process.env.PROMPT_SHADOW_TIMEOUT_MS ?? "60000",
  CODEX_STRUCTURED_INTERPRET_OUTPUT: "true",
  CODEX_LLM_REASONING_EFFORT: process.env.PROMPT_SHADOW_REASONING_EFFORT ?? "low",
});

const results = [];
for (const fixture of selectedCases) {
  const chat = new DemoChatService();
  const state = fixture.prepare?.(chat) ?? chat.peek(`shadow-${fixture.id}`);
  const relevantKnowledge = retrieveKnowledge({
    tenantId: knowledgeTenant,
    query: fixture.message,
    entities: knowledge,
    limit: 6,
  }).map(({ id, title, content }) => ({ id, title, content }));
  const legacyPrompt = buildInterpretPromptForDiagnostics(
    { customerMessage: fixture.message, state, knowledge: relevantKnowledge },
    "legacy",
  );
  const compactPrompt = buildInterpretPromptForDiagnostics(
    { customerMessage: fixture.message, state, knowledge: relevantKnowledge },
    "compact",
  );
  const interpreted = await bridge.interpret({
    customerMessage: fixture.message,
    state,
    knowledge: relevantKnowledge,
  });
  const actionPlan = reconcileConversationActions({
    customerMessage: fixture.message,
    semantic: interpreted,
    ...(fixture.reconcile?.exactIntent ? { exactIntent: fixture.reconcile.exactIntent } : {}),
    ...(fixture.reconcile?.detectedCareIssue
      ? { detectedCareIssue: fixture.reconcile.detectedCareIssue }
      : {}),
    ...(fixture.reconcile?.careScenario ? { careScenario: fixture.reconcile.careScenario } : {}),
    priorOtherProductAdverseExperience: fixture.reconcile?.priorOtherProductAdverseExperience ?? false,
    optOut: false,
    collectingOrder: false,
  });
  const actions = actionPlan.accepted.map((action) => action.type);
  const failures: string[] = [];
  if (interpreted.status !== "interpreted") failures.push(`status=${interpreted.status}`);
  const resolvedIntent = actionPlan.primaryIntent ?? interpreted.intent;
  if (!fixture.expectedIntents.includes(resolvedIntent ?? "")) {
    failures.push(`intent=${resolvedIntent ?? "missing"}`);
  }
  for (const action of fixture.requiredActions) {
    if (!actions.includes(action as never)) failures.push(`missing_action=${action}`);
  }
  for (const action of fixture.forbiddenActions ?? []) {
    if (actions.includes(action as never)) failures.push(`forbidden_action=${action}`);
  }
  if (fixture.rejectDraft?.test(interpreted.draftReply ?? "")) {
    failures.push("draft_rejected_pattern");
  }
  const base = chat.chat(`shadow-${fixture.id}`, fixture.message, interpreted, {
    actionExecutionMode: "multi_action",
  });
  const composed = bridge.adoptInterpretedDraft({
    customerMessage: fixture.message,
    ...(interpreted.draftReply ? { draftReply: interpreted.draftReply } : {}),
    baseReply: base.reply,
    baseReplies: base.replies,
    actions: interpreted.actions ?? [],
    state: base.state,
    ...(base.state.activeSkill ? { skillId: base.state.activeSkill } : {}),
    knowledge: relevantKnowledge,
    ...(interpreted.knowledgeIds ? { knowledgeIds: interpreted.knowledgeIds } : {}),
    ...(interpreted.unsupportedQuestions ? { unsupportedQuestions: interpreted.unsupportedQuestions } : {}),
    ...(interpreted.groundingConfidence !== undefined
      ? { groundingConfidence: interpreted.groundingConfidence }
      : {}),
    knowledgeGroundingRequired: requiresKnowledgeGrounding(base.state.decisionTrace?.selectedIntent),
  });
  const finalReply = composed.reply;
  if (fixture.requireFinalReply && !fixture.requireFinalReply.test(finalReply)) {
    failures.push("final_reply_missing_pattern");
  }
  if (fixture.rejectFinalReply?.test(finalReply)) {
    failures.push("final_reply_rejected_pattern");
  }
  results.push({
    id: fixture.id,
    pass: failures.length === 0,
    failures,
    prompt: {
      legacyCharacters: legacyPrompt.length,
      compactCharacters: compactPrompt.length,
      reductionPercent: Math.round((1 - compactPrompt.length / legacyPrompt.length) * 100),
    },
    output: {
      promptProfile,
      status: interpreted.status,
      reason: interpreted.reason ?? null,
      latencyMs: interpreted.latencyMs,
      intent: resolvedIntent ?? null,
      rawIntent: interpreted.intent ?? null,
      actions,
      rawActions: interpreted.actions?.map((action) => action.type) ?? [],
      rejectedActions: actionPlan.rejected.map((item) => ({
        type: item.action.type,
        reason: item.reason,
      })),
      draftReply: interpreted.draftReply ?? null,
      knowledgeIds: interpreted.knowledgeIds ?? [],
      unsupportedQuestions: interpreted.unsupportedQuestions ?? [],
      groundingConfidence: interpreted.groundingConfidence ?? null,
      compositionStatus: composed.status,
      compositionReason: composed.reason ?? null,
      finalReply,
    },
  });
  process.stdout.write(`${JSON.stringify(results.at(-1))}\n`);
}

const passed = results.filter((item) => item.pass).length;
process.stdout.write(
  `${JSON.stringify({ summary: { passed, total: selectedCases.length, productionChanged: false } })}\n`,
);
if (passed !== selectedCases.length) process.exitCode = 1;

import type { CustomerIntent, SemanticUnderstanding } from "./consultation.js";

export type ProductWorkflowIntent =
  "product_info" | "ingredients" | "usage" | "price" | "purchase" | "safety";

export type ProductOffer = {
  id: string;
  items: ReadonlyArray<{
    sku: string;
    name: string;
    quantity: number;
  }>;
  totalVnd: number;
  shippingVnd: number;
  soldSeparately: boolean;
  fulfillment: "automated" | "human";
  knowledgeId: string;
};

export type ProductWorkflowDefinition = {
  id: string;
  productId: string;
  displayName: string;
  aliases: readonly string[];
  knowledgeIds: Readonly<Record<ProductWorkflowIntent, readonly string[]>>;
  responses: Readonly<Record<Exclude<ProductWorkflowIntent, "purchase" | "price">, string>>;
  offer?: ProductOffer;
};

export type ApprovedProductWorkflowTurn = {
  workflowId: string;
  productId: string;
  intent: CustomerIntent;
  workflowIntent: ProductWorkflowIntent;
  reply: string;
  knowledgeIds: string[];
  authoritative: true;
  handoff: boolean;
  handoffReason?: string;
  offerId?: string;
};

const herbalBodyWashWorkflow: ProductWorkflowDefinition = {
  id: "herbal-body-wash",
  productId: "STOPIREX-HBW-500ML",
  displayName: "STOPIREX HERBAL BODY WASH 500 ml",
  aliases: ["sữa tắm", "body wash", "herbal body wash"],
  knowledgeIds: {
    product_info: ["body-wash-product-profile-2026-08"],
    ingredients: ["body-wash-product-profile-2026-08", "body-wash-approved-ingredient-benefits-2026-08"],
    usage: ["body-wash-rollon-odor-routine-2026-08"],
    price: ["body-wash-rollon-combo-price-2026-08"],
    purchase: ["body-wash-rollon-combo-price-2026-08"],
    safety: ["body-wash-unapproved-safety-boundaries-2026-08", "body-wash-unapproved-populations-2026-08"],
  },
  responses: {
    ingredients:
      "Dạ Herbal Body Wash 500 ml có Mướp đắng, Tràm trà, Niacinamide, Lactic Acid (AHA), Vitamin E và các chiết xuất thực vật; sản phẩm giúp làm sạch, hỗ trợ chăm sóc dầu thừa, mùi cơ thể, làm sáng và dưỡng ẩm da ạ.",
    usage:
      "Mình dùng sữa tắm hằng ngày; lăn Stopirex dùng buổi tối khi vùng nách sạch, khô hoàn toàn, lăn mỏng khoảng 2–3 lần/tuần theo hướng dẫn ạ.",
    safety:
      "Thông tin đã duyệt hiện xác nhận sản phẩm có pH cân bằng và phù hợp dùng hằng ngày; các thông tin như pH chính xác, không sulfate hoặc hướng dẫn riêng cho nhóm đặc biệt cần được kiểm tra thêm trước khi tư vấn ạ.",
    product_info:
      "Dạ STOPIREX HERBAL BODY WASH là sữa tắm thảo mộc 500 ml, xuất xứ Việt Nam, có pH cân bằng và phù hợp sử dụng hằng ngày ạ.",
  },
  offer: {
    id: "stopirex-rollon-bodywash-2026-08",
    items: [
      { sku: "STOPIREX-ROLLON", name: "lăn Stopirex", quantity: 1 },
      { sku: "STOPIREX-HBW-500ML", name: "chai Herbal Body Wash 500 ml", quantity: 1 },
    ],
    totalVnd: 525_000,
    shippingVnd: 0,
    soldSeparately: false,
    fulfillment: "human",
    knowledgeId: "body-wash-rollon-combo-price-2026-08",
  },
};

export const approvedProductWorkflows: readonly ProductWorkflowDefinition[] = Object.freeze([
  herbalBodyWashWorkflow,
]);

validateProductWorkflows(approvedProductWorkflows);

export function resolveApprovedProductWorkflowTurn(input: {
  text: string;
  semantic?: Pick<
    SemanticUnderstanding,
    "intent" | "topic" | "confidence" | "status" | "knowledgeIds" | "groundingConfidence"
  >;
  activeWorkflowId?: string;
}): ApprovedProductWorkflowTurn | undefined {
  const text = normalizeProductText(input.text);
  const workflow = resolveWorkflow(input, text);
  if (!workflow) return undefined;

  const workflowIntents = resolveWorkflowIntents(text, input.semantic);
  const primaryIntent = workflowIntents[0] ?? "product_info";
  const offer = workflow.offer;

  // The LLM may propose a purchase, but code only accepts it when the current
  // customer message contains an explicit purchase instruction.
  if (primaryIntent === "purchase" && offer && hasExplicitPurchaseEvidence(text)) {
    const handoff = offer.fulfillment === "human";
    return {
      workflowId: workflow.id,
      productId: workflow.productId,
      workflowIntent: "purchase",
      intent: "buying",
      reply: purchaseReply(offer, handoff),
      knowledgeIds: [offer.knowledgeId],
      authoritative: true,
      handoff,
      ...(handoff
        ? {
            handoffReason: `product_workflow_order_requires_human:${workflow.id}:${offer.id}`,
          }
        : {}),
      offerId: offer.id,
    };
  }

  const replies: string[] = [];
  const knowledgeIds: string[] = [];
  for (const workflowIntent of workflowIntents.filter((value) => value !== "purchase")) {
    const rendered = renderApprovedWorkflowAnswer(workflow, workflowIntent);
    if (!rendered) continue;
    replies.push(rendered);
    knowledgeIds.push(...workflow.knowledgeIds[workflowIntent]);
  }
  if (replies.length === 0) {
    const rendered = renderApprovedWorkflowAnswer(workflow, "product_info");
    if (!rendered) return undefined;
    replies.push(rendered);
    knowledgeIds.push(...workflow.knowledgeIds.product_info);
  }

  const workflowIntent = primaryIntent === "purchase" ? "product_info" : primaryIntent;
  return {
    workflowId: workflow.id,
    productId: workflow.productId,
    workflowIntent,
    intent:
      workflowIntent === "price"
        ? "price_request"
        : workflowIntent === "usage"
          ? "usage_guidance"
          : workflowIntent === "safety"
            ? "safety"
            : "product_effect",
    reply: replies.join("\n\n"),
    knowledgeIds: [...new Set(knowledgeIds)],
    authoritative: true,
    handoff: false,
    ...(offer ? { offerId: offer.id } : {}),
  };
}

export function hasAuthoritativeProductWorkflowDecision(
  ruleMatches: ReadonlyArray<{ id: string; kind: "hard" | "soft" }> | undefined,
): boolean {
  return Boolean(
    ruleMatches?.some((match) => match.kind === "hard" && match.id.startsWith("product_workflow:")),
  );
}

function resolveWorkflow(
  input: {
    semantic?: Pick<SemanticUnderstanding, "knowledgeIds" | "groundingConfidence">;
    activeWorkflowId?: string;
  },
  normalizedText: string,
): ProductWorkflowDefinition | undefined {
  const explicitlyNamed = approvedProductWorkflows.find((workflow) =>
    workflow.aliases.some((alias) => normalizedText.includes(normalizeProductText(alias))),
  );
  if (explicitlyNamed) return explicitlyNamed;

  // A citation may be auto-repaired from broad retrieval, so citation alone
  // cannot switch products. Accept it only when the LLM explicitly reports a
  // strong grounding score; otherwise require a literal alias or active flow.
  if ((input.semantic?.groundingConfidence ?? 0) >= 0.85) {
    const citedIds = new Set(input.semantic?.knowledgeIds ?? []);
    const grounded = approvedProductWorkflows.find((workflow) =>
      Object.values(workflow.knowledgeIds).some((ids) => ids.some((id) => citedIds.has(id))),
    );
    if (grounded) return grounded;
  }

  if (input.activeWorkflowId) {
    return approvedProductWorkflows.find((workflow) => workflow.id === input.activeWorkflowId);
  }
  return undefined;
}

function resolveWorkflowIntents(
  text: string,
  semantic: Pick<SemanticUnderstanding, "intent" | "topic" | "confidence" | "status"> | undefined,
): ProductWorkflowIntent[] {
  const intents: ProductWorkflowIntent[] = [];
  const add = (intent: ProductWorkflowIntent): void => {
    if (!intents.includes(intent)) intents.push(intent);
  };

  if (semantic?.intent === "buying" && hasExplicitPurchaseEvidence(text)) add("purchase");
  if (["price_request", "promotion_inquiry", "price_objection"].includes(semantic?.intent ?? "")) {
    add("price");
  }
  if (["usage_guidance", "usage_time", "usage_frequency"].includes(semantic?.intent ?? "")) {
    add("usage");
  }
  if (semantic?.intent === "safety") add("safety");

  // Literal signals are fallback evidence and also preserve multiple questions
  // from one message. They select a workflow facet, never a price or SKU.
  if (hasExplicitPurchaseEvidence(text)) add("purchase");
  if (hasAny(text, ["giá", "bao nhiêu", "bán lẻ", "mua riêng", "combo", "ship", "freeship", "free ship"])) {
    add("price");
  }
  if (
    hasAny(text, [
      "thành phần",
      "mướp đắng",
      "tràm trà",
      "tea tree",
      "niacinamide",
      "vitamin b3",
      "aha",
      "lactic acid",
      "vitamin e",
    ])
  ) {
    add("ingredients");
  }
  if (hasAny(text, ["dùng sao", "dùng như thế nào", "cách dùng", "tắm xong", "kết hợp", "phối hợp"])) {
    add("usage");
  }
  if (
    hasAny(text, [
      "sulfate",
      "ph chính xác",
      "trẻ em",
      "bé dùng",
      "bà bầu",
      "mang thai",
      "cho con bú",
      "dị ứng",
      "da nhạy cảm",
    ])
  ) {
    add("safety");
  }
  return intents.length > 0 ? intents : ["product_info"];
}

function renderApprovedWorkflowAnswer(
  workflow: ProductWorkflowDefinition,
  intent: Exclude<ProductWorkflowIntent, "purchase">,
): string | undefined {
  if (intent === "price") return offerPriceReply(workflow);
  return workflow.responses[intent];
}

function offerPriceReply(workflow: ProductWorkflowDefinition): string | undefined {
  const offer = workflow.offer;
  if (!offer) return undefined;
  const items = formatOfferItems(offer);
  const saleMode = offer.soldSeparately ? "có bán lẻ" : "hiện không bán lẻ";
  return `${workflow.displayName} ${saleMode}; bên em bán combo ${items} giá ${formatVnd(offer.totalVnd)}${offer.shippingVnd === 0 ? " và miễn phí giao" : ` + ${formatVnd(offer.shippingVnd)} phí giao`} ạ.`;
}

function purchaseReply(offer: ProductOffer, handoff: boolean): string {
  return `Dạ em ghi nhận mình chọn combo ${formatOfferItems(offer)}, giá ${formatVnd(offer.totalVnd)}${offer.shippingVnd === 0 ? " và miễn phí giao" : ` + ${formatVnd(offer.shippingVnd)} phí giao`} ạ.${handoff ? " Em chuyển bộ phận liên quan hỗ trợ lên đúng combo cho mình nhé." : ""}`;
}

function formatOfferItems(offer: ProductOffer): string {
  return offer.items.map((item) => `${item.quantity} ${item.name}`).join(" + ");
}

function hasExplicitPurchaseEvidence(text: string): boolean {
  const purchaseVerbs = ["lấy", "chốt", "đặt", "mua", "gửi cho", "gửi về"];
  const nonPurchaseQuestions = [
    "có bán",
    "bán lẻ",
    "giá",
    "bao nhiêu",
    "mua riêng",
    "thành phần",
    "công dụng",
    "dùng sao",
    "dùng như thế nào",
  ];
  return hasAny(text, purchaseVerbs) && !hasAny(text, nonPurchaseQuestions);
}

function hasAny(text: string, values: readonly string[]): boolean {
  return values.some((value) => text.includes(normalizeProductText(value)));
}

function normalizeProductText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function formatVnd(amount: number): string {
  return `${amount.toLocaleString("vi-VN")}đ`;
}

function validateProductWorkflows(workflows: readonly ProductWorkflowDefinition[]): void {
  const workflowIds = new Set<string>();
  const productIds = new Set<string>();
  const offerIds = new Set<string>();
  for (const workflow of workflows) {
    if (workflowIds.has(workflow.id)) throw new Error(`Duplicate product workflow: ${workflow.id}`);
    if (productIds.has(workflow.productId))
      throw new Error(`Duplicate workflow product: ${workflow.productId}`);
    workflowIds.add(workflow.id);
    productIds.add(workflow.productId);
    if (workflow.offer) {
      if (offerIds.has(workflow.offer.id)) throw new Error(`Duplicate product offer: ${workflow.offer.id}`);
      offerIds.add(workflow.offer.id);
    }
  }
}

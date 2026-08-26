import assert from "node:assert/strict";
import test from "node:test";
import {
  approvedProductWorkflows,
  hasAuthoritativeProductWorkflowDecision,
  resolveApprovedProductWorkflowTurn,
} from "../src/domain/productWorkflows.js";

test("Product Workflow resolves the approved body-wash offer instead of roll-on quantity pricing", () => {
  const turn = resolveApprovedProductWorkflowTurn({
    text: "Sữa tắm Stopirex giá bao nhiêu, có bán lẻ không?",
    semantic: { intent: "price_request", confidence: 0.98, status: "interpreted" },
  });

  assert.equal(turn?.workflowId, "herbal-body-wash");
  assert.equal(turn?.offerId, "stopirex-rollon-bodywash-2026-08");
  assert.equal(turn?.authoritative, true);
  assert.match(turn?.reply ?? "", /1 lăn Stopirex.*1 chai Herbal Body Wash 500 ml.*525\.000đ/isu);
  assert.doesNotMatch(turn?.reply ?? "", /510\.000đ|285\.000đ/u);
});

test("LLM can propose purchase intent but cannot create a purchase without customer evidence", () => {
  const turn = resolveApprovedProductWorkflowTurn({
    text: "Sữa tắm này có thành phần gì?",
    semantic: {
      intent: "buying",
      confidence: 0.99,
      status: "interpreted",
      knowledgeIds: ["body-wash-approved-ingredient-benefits-2026-08"],
    },
  });

  assert.equal(turn?.workflowIntent, "ingredients");
  assert.equal(turn?.intent, "product_effect");
  assert.equal(turn?.handoff, false);
  assert.match(turn?.reply ?? "", /Mướp đắng.*Tràm trà.*Niacinamide/su);
});

test("explicit body-wash purchase selects the exact offer and pauses unsupported fulfillment", () => {
  const turn = resolveApprovedProductWorkflowTurn({
    text: "Chốt cho mình combo sữa tắm nhé",
    semantic: { intent: "buying", confidence: 0.99, status: "interpreted" },
  });

  assert.equal(turn?.workflowIntent, "purchase");
  assert.equal(turn?.intent, "buying");
  assert.equal(turn?.handoff, true);
  assert.equal(
    turn?.handoffReason,
    "product_workflow_order_requires_human:herbal-body-wash:stopirex-rollon-bodywash-2026-08",
  );
});

test("grounded LLM citation may select product workflow but catalog remains authoritative", () => {
  const turn = resolveApprovedProductWorkflowTurn({
    text: "cái chai herbal kia nhiêu vậy",
    semantic: {
      intent: "price_request",
      confidence: 0.93,
      status: "interpreted",
      groundingConfidence: 0.96,
      knowledgeIds: ["body-wash-rollon-combo-price-2026-08"],
    },
  });

  assert.equal(turn?.workflowId, "herbal-body-wash");
  assert.match(turn?.reply ?? "", /525\.000đ/u);
});

test("roll-on-only questions do not enter the body-wash workflow", () => {
  const turn = resolveApprovedProductWorkflowTurn({
    text: "Lăn Stopirex một lọ giá bao nhiêu?",
    semantic: { intent: "price_request", confidence: 0.98, status: "interpreted" },
  });

  assert.equal(turn, undefined);
});

test("auto-repaired citation without strong grounding cannot switch the customer to another product", () => {
  const turn = resolveApprovedProductWorkflowTurn({
    text: "Mình bị cả mồ hôi làm ướt áo và mùi cơ thể",
    semantic: {
      intent: "consultation",
      confidence: 0.97,
      status: "interpreted",
      knowledgeIds: ["body-wash-product-profile-2026-08"],
    },
  });

  assert.equal(turn, undefined);
});

test("workflow registry has stable unique product and offer identifiers", () => {
  assert.equal(
    new Set(approvedProductWorkflows.map((workflow) => workflow.id)).size,
    approvedProductWorkflows.length,
  );
  assert.equal(
    new Set(approvedProductWorkflows.map((workflow) => workflow.productId)).size,
    approvedProductWorkflows.length,
  );
  assert.equal(
    hasAuthoritativeProductWorkflowDecision([
      {
        id: "product_workflow:herbal-body-wash:price:stopirex-rollon-bodywash-2026-08",
        kind: "hard",
      },
    ]),
    true,
  );
});

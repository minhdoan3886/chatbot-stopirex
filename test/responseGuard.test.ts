import assert from "node:assert/strict";
import test from "node:test";
import { responseAttentionForVerdict, responseGuardVerdict } from "../src/domain/responseGuard.js";

test("lỗi văn phong và coverage chỉ yêu cầu LLM repair", () => {
  for (const reason of ["advisor_voice_guard", "skill_shape_guard", "missing_topics:usage"]) {
    const verdict = responseGuardVerdict({ reason, source: "workflow_safe_fallback" });
    assert.equal(verdict.outcome, "repair");
    assert.equal(verdict.hard, false);
  }
});

test("giá, claim, action và state sai bị block cứng", () => {
  for (const reason of [
    "commerce_guard",
    "claim_guard",
    "unsupported_claim_guard",
    "fact_applicability_guard",
    "action_grounding_guard",
    "price_change_guard",
    "response_state_mismatch",
  ]) {
    const verdict = responseGuardVerdict({ reason, source: "workflow_safe_fallback" });
    assert.equal(verdict.outcome, "block");
    assert.equal(verdict.hard, true);
  }
});

test("draft hoặc repair đã qua validation được allow", () => {
  assert.deepEqual(responseGuardVerdict({ accepted: true, reason: "validated", source: "llm_repair" }), {
    outcome: "allow",
    reason: "validated",
    hard: false,
    source: "llm_repair",
  });
});

test("verdict lỗi tạo needs_attention có mã ổn định và không chứa prose", () => {
  const attention = responseAttentionForVerdict(
    responseGuardVerdict({
      reason: "commerce_guard: shipping role mismatch",
      source: "llm_repair",
    }),
    { at: new Date("2026-09-16T01:00:00.000Z"), traceId: "trace-7" },
  );
  assert.deepEqual(attention, {
    status: "needs_attention",
    severity: "critical",
    code: "commerce_guard",
    source: "llm_repair",
    at: "2026-09-16T01:00:00.000Z",
    traceId: "trace-7",
  });
  assert.equal(
    responseAttentionForVerdict(responseGuardVerdict({ accepted: true, source: "llm_draft" })),
    undefined,
  );
});

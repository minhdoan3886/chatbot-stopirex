import assert from "node:assert/strict";
import test from "node:test";
import { responseGuardVerdict } from "../src/domain/responseGuard.js";

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
  assert.deepEqual(
    responseGuardVerdict({ accepted: true, reason: "validated", source: "llm_repair" }),
    {
      outcome: "allow",
      reason: "validated",
      hard: false,
      source: "llm_repair",
    },
  );
});


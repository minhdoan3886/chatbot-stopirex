import assert from "node:assert/strict";
import test from "node:test";

import type { LogRecord } from "../src/services/logger.js";
import { PipelineTelemetryTracker } from "../src/services/pipelineTelemetry.js";

const at = "2026-09-03T07:00:00.000Z";
const record = (event: string, context: Record<string, unknown> = {}): LogRecord => ({
  level: "info",
  event,
  at,
  ...context,
});

test("pipeline telemetry phân biệt interpret, normalize, reducer, compose và guard", () => {
  const tracker = new PipelineTelemetryTracker();
  tracker.observe(record("llm_interpretation", { status: "interpreted" }));
  tracker.observe(record("llm_composition", { status: "fallback", reason: "draft_validation_failed" }));
  tracker.observe(
    record("conversation_turn_audit", {
      rejectedOrderMutations: [{ reason: "invalid_phone" }],
      orderChangedFields: ["deliveryNote"],
      orderConflicts: [],
      responseOutcome: "allow",
    }),
  );

  const stages = Object.fromEntries(tracker.snapshot().map((stage) => [stage.id, stage]));
  assert.equal(stages.interpret?.status, "healthy");
  assert.equal(stages.normalize?.status, "healthy");
  assert.match(stages.normalize?.detail ?? "", /chặn an toàn 1/u);
  assert.equal(stages.reducer?.status, "healthy");
  assert.equal(stages.compose?.status, "degraded");
  assert.equal(stages.guard?.status, "healthy");
});

test("pipeline telemetry báo riêng reducer conflict và response bị guard chặn", () => {
  const tracker = new PipelineTelemetryTracker();
  tracker.observe(
    record("conversation_turn_audit", {
      orderConflicts: ["state_version_conflict"],
      responseOutcome: "block",
      responseReason: "response_state_divergence",
    }),
  );

  const stages = Object.fromEntries(tracker.snapshot().map((stage) => [stage.id, stage]));
  assert.equal(stages.reducer?.status, "degraded");
  assert.equal(stages.guard?.status, "down");
  assert.match(stages.guard?.detail ?? "", /response_state_divergence/u);
});

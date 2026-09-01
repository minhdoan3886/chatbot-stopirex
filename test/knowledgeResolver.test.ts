import assert from "node:assert/strict";
import test from "node:test";
import {
  assertCanonicalFactApplicability,
  resolveCanonicalKnowledge,
} from "../src/domain/knowledgeResolver.js";
import type { KnowledgeMatch } from "../src/domain/knowledge.js";
import type { TenantId } from "../src/domain/types.js";

const tenantId = "00000000-0000-4000-8000-000000000001" as TenantId;

function match(input: {
  id: string;
  content: string;
  priority?: number;
  validFrom?: string;
  validTo?: string;
}): KnowledgeMatch {
  return {
    entity: {
      id: input.id,
      tenantId,
      type: "price",
      title: input.id,
      content: input.content,
      status: "active",
      scope: "current",
      sourceRow: 1,
      ...(input.priority !== undefined ? { priority: input.priority } : {}),
      ...(input.validFrom ? { validFrom: input.validFrom } : {}),
      ...(input.validTo ? { validTo: input.validTo } : {}),
    },
    score: 10,
    matchedTerms: ["gia"],
    matchedConcepts: ["price"],
  };
}

test("resolver tạo fact canonical có provenance và applicability", () => {
  const resolved = resolveCanonicalKnowledge({
    query: "giá 1 lọ và combo 2 lọ",
    at: new Date("2026-09-01T00:00:00.000Z"),
    matches: [
      match({
        id: "current-price",
        content: "Giá hiện tại: 1 lọ 285.000đ; combo 2 lọ 510.000đ; combo 2–5 lọ miễn phí giao.",
        priority: 3,
        validFrom: "2026-08-01T00:00:00.000Z",
      }),
    ],
  });

  assert.equal(resolved.unresolvedFacts.length, 0);
  assert.equal(resolved.facts.find((fact) => fact.key === "price.stopirex.1_unit")?.value, 285000);
  assert.equal(resolved.facts.find((fact) => fact.key === "price.stopirex.2_units")?.value, 510000);
  assert.ok(resolved.facts.every((fact) => fact.sourceVersion.length === 16));
  assert.ok(resolved.facts.every((fact) => fact.applicable));
});

test("resolver loại record hết hạn và báo conflict giữa hai fact còn hiệu lực", () => {
  const resolved = resolveCanonicalKnowledge({
    query: "giá combo 2 lọ",
    at: new Date("2026-09-01T00:00:00.000Z"),
    matches: [
      match({
        id: "expired",
        content: "Combo 2 lọ 490.000đ.",
        validTo: "2026-07-31T23:59:59.000Z",
        priority: 9,
      }),
      match({ id: "lower", content: "Combo 2 lọ 500.000đ.", priority: 1 }),
      match({ id: "approved", content: "Combo 2 lọ 510.000đ.", priority: 3 }),
    ],
  });

  assert.equal(resolved.facts.find((fact) => fact.key === "price.stopirex.2_units")?.value, 510000);
  assert.equal(resolved.conflicts.length, 1);
  assert.deepEqual(resolved.conflicts[0]?.values.sort(), [500000, 510000]);
  assert.ok(!resolved.sourceIds.includes("expired"));
});

test("applicability guard chặn giá LLM tự thêm nhưng cho phép tổng do workflow tính", () => {
  const resolution = resolveCanonicalKnowledge({
    query: "giá 1 lọ",
    matches: [match({ id: "approved", content: "1 lọ 285.000đ và phí giao 30.000đ." })],
  });
  assert.equal(
    resolution.facts.find((fact) => fact.key === "shipping.stopirex.standard_fee")?.value,
    30_000,
  );
  assert.equal(
    resolution.conflicts.some((conflict) => conflict.key === "price.stopirex.1_unit"),
    false,
  );
  assert.doesNotThrow(() =>
    assertCanonicalFactApplicability({
      reply: "1 lọ 285.000đ, tổng 315.000đ.",
      authoritativeReply: "1 lọ 285.000đ, phí giao 30.000đ, tổng 315.000đ.",
      resolution,
    }),
  );
  assert.throws(
    () =>
      assertCanonicalFactApplicability({
        reply: "Giá mới là 300.000đ.",
        authoritativeReply: "1 lọ 285.000đ.",
        resolution,
      }),
    /fact_applicability_guard/u,
  );
});

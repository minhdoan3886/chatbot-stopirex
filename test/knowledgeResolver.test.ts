import assert from "node:assert/strict";
import test from "node:test";
import {
  assertCanonicalClaimsSupported,
  assertCanonicalFactApplicability,
  parseMoneySpans,
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

test("resolver không coi record thiếu metadata duyệt là nguồn current", () => {
  const approved = match({ id: "unknown-metadata", content: "1 lọ 199.000đ" });
  const entityWithoutApproval = { ...approved.entity };
  delete entityWithoutApproval.status;
  delete entityWithoutApproval.scope;
  const resolved = resolveCanonicalKnowledge({
    query: "giá 1 lọ",
    matches: [
      {
        ...approved,
        entity: entityWithoutApproval,
      },
    ],
  });

  assert.deepEqual(resolved.facts, []);
  assert.deepEqual(resolved.sourceIds, []);
});

test("closed-world guard chỉ cho phép claim sản phẩm có canonical fact hỗ trợ", () => {
  const resolution = resolveCanonicalKnowledge({
    query: "sản phẩm có giảm mồ hôi không",
    matches: [match({ id: "effect", content: "Stopirex hỗ trợ kiểm soát và giảm tiết mồ hôi." })],
  });
  assert.doesNotThrow(() =>
    assertCanonicalClaimsSupported({
      reply: "Stopirex hỗ trợ giảm tiết mồ hôi khi dùng đúng hướng dẫn.",
      authoritativeReply: "",
      resolution,
    }),
  );
  assert.throws(
    () =>
      assertCanonicalClaimsSupported({
        reply: "Stopirex chữa được ung thư.",
        authoritativeReply: "",
        resolution,
      }),
    /unsupported_claim_guard/u,
  );
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
  assert.throws(
    () =>
      assertCanonicalFactApplicability({
        reply: "Combo 2 lọ 510.000đ.",
        authoritativeReply: "",
        resolution: resolved,
      }),
    /fact_applicability_guard:conflicting_fact/u,
  );
});

test("applicability guard chặn giá LLM tự thêm nhưng cho phép tổng do workflow tính", () => {
  const resolution = resolveCanonicalKnowledge({
    query: "giá 1 lọ",
    matches: [match({ id: "approved", content: "1 lọ 285.000đ và phí giao 30.000đ." })],
  });
  assert.equal(resolution.facts.find((fact) => fact.key === "shipping.stopirex.standard_fee")?.value, 30_000);
  assert.equal(
    resolution.conflicts.some((conflict) => conflict.key === "price.stopirex.1_unit"),
    false,
  );
  assert.doesNotThrow(() =>
    assertCanonicalFactApplicability({
      reply: "1 lọ 285.000đ, tổng 315.000đ.",
      authoritativeReply: "1 lọ 285.000đ, phí giao 30.000đ, tổng 315.000đ.",
      resolution,
      allowedMoney: [{ role: "total", amount: 315_000, currency: "VND", quantity: 1 }],
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

test("closed-world guard không dùng workflow prose để chứng minh claim và chặn đảo phủ định", () => {
  const resolution = resolveCanonicalKnowledge({
    query: "có miễn phí giao không",
    matches: [match({ id: "shipping-policy", content: "Stopirex không có miễn phí giao cho 1 lọ." })],
  });

  assert.throws(
    () =>
      assertCanonicalClaimsSupported({
        reply: "Stopirex có miễn phí giao cho 1 lọ.",
        authoritativeReply: "Stopirex có miễn phí giao cho 1 lọ.",
        resolution,
      }),
    /unsupported_claim_guard/u,
  );
});

test("applicability guard gắn mỗi số tiền với đúng vai trò", () => {
  const resolution = resolveCanonicalKnowledge({
    query: "giá 1 lọ và phí giao",
    matches: [match({ id: "approved-role", content: "1 lọ 285.000đ và phí giao 30.000đ." })],
  });

  assert.throws(
    () =>
      assertCanonicalFactApplicability({
        reply: "Tiền hàng 30.000đ, phí giao 285.000đ.",
        authoritativeReply: "Tiền hàng 285.000đ, phí giao 30.000đ, tổng 315.000đ.",
        resolution,
      }),
    /money_role_mismatch/u,
  );
});

test("closed-world guard không dùng token overlap để đổi buổi tối thành buổi sáng", () => {
  const resolution = resolveCanonicalKnowledge({
    query: "Stopirex dùng lúc nào",
    matches: [match({ id: "usage-time", content: "Stopirex dùng buổi tối trên da sạch và khô." })],
  });
  assert.doesNotThrow(() =>
    assertCanonicalClaimsSupported({
      reply: "Stopirex dùng vào buổi tối khi da sạch, khô.",
      authoritativeReply: "",
      resolution,
    }),
  );
  assert.throws(
    () =>
      assertCanonicalClaimsSupported({
        reply: "Stopirex dùng buổi sáng trên da sạch và khô.",
        authoritativeReply: "",
        resolution,
      }),
    /unsupported_claim_guard/u,
  );
});

test("P01 money parser chuẩn hóa các biểu diễn VND tương đương và giữ vai trò", () => {
  for (const text of ["Giá 1 lọ 285.000đ", "Giá 1 lọ 285,000 đ", "Giá 1 lọ 285000 VND", "Giá 1 lọ 285k"]) {
    assert.deepEqual(
      parseMoneySpans(text).map(({ amount, role, quantity }) => ({ amount, role, quantity })),
      [{ amount: 285_000, role: "unit_price", quantity: 1 }],
      text,
    );
  }
});

test("P02-P04 parser thấy tiền cực nhỏ nhưng bỏ qua điện thoại, địa chỉ, lịch và tần suất", () => {
  assert.deepEqual(
    parseMoneySpans("Giá đúng 285.000đ nhưng riêng mình 1k và thêm 1đ").map((span) => span.amount),
    [285_000, 1_000, 1],
  );
  assert.deepEqual(parseMoneySpans("SĐT 0912345678, số 12 Đội Cấn, gym thứ 3-5-7, dùng 2–3 lần/tuần"), []);
});

test("claim guard chặn claim tuyệt đối, sai tần suất, nối câu và đường uống không có nguồn", () => {
  const resolution = resolveCanonicalKnowledge({
    query: "công dụng và cách dùng Stopirex",
    matches: [
      match({
        id: "approved-usage",
        content: "Stopirex hỗ trợ giảm tiết mồ hôi. Dùng ngoài da 2–3 lần/tuần vào buổi tối.",
      }),
    ],
  });

  for (const reply of [
    "Stopirex giúp giảm mồ hôi vĩnh viễn chỉ sau một lần dùng.",
    "Stopirex dùng vào buổi tối, lăn 20–30 lần/tuần.",
    "Stopirex giúp giảm mồ hôi. Nó còn chữa khỏi bệnh tiểu đường.",
    "Có thể uống trực tiếp mỗi ngày.",
    "Stopirex uống.",
  ]) {
    assert.throws(
      () =>
        assertCanonicalClaimsSupported({
          reply,
          authoritativeReply: "",
          resolution,
        }),
      /unsupported_claim_guard/u,
      reply,
    );
  }

  assert.doesNotThrow(() =>
    assertCanonicalClaimsSupported({
      reply: "Stopirex hỗ trợ giảm tiết mồ hôi, dùng ngoài da 2–3 lần/tuần vào buổi tối.",
      authoritativeReply: "",
      resolution,
    }),
  );
});

test("money guard hiểu dấu hai chấm và không cho tráo vai trò hoặc tráo số lượng", () => {
  const resolution = resolveCanonicalKnowledge({
    query: "giá 1 lọ, 2 lọ và phí giao",
    matches: [
      match({
        id: "approved-money-tuples",
        content: "Giá 1 lọ 285.000đ; combo 2 lọ 510.000đ; phí giao 30.000đ.",
      }),
    ],
  });

  assert.deepEqual(
    parseMoneySpans("Tiền hàng: 30.000đ. Phí giao: 285.000đ.").map(({ amount, role }) => ({
      amount,
      role,
    })),
    [
      { amount: 30_000, role: "subtotal" },
      { amount: 285_000, role: "shipping" },
    ],
  );
  assert.throws(
    () =>
      assertCanonicalFactApplicability({
        reply: "Tiền hàng: 30.000đ. Phí giao: 285.000đ.",
        authoritativeReply: "",
        resolution,
      }),
    /money_role_mismatch/u,
  );
  assert.throws(
    () =>
      assertCanonicalFactApplicability({
        reply: "Giá 5 lọ là 510.000đ.",
        authoritativeReply: "",
        resolution,
      }),
    /money_role_mismatch/u,
  );
});

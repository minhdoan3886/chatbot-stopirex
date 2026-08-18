import assert from "node:assert/strict";
import test from "node:test";
import { assignVariant } from "../src/domain/experiments.js";
import { customerId, pageId, tenantId } from "../src/domain/types.js";

test("cùng khách và experiment luôn nhận cùng variant", () => {
  const input = {
    scope: { tenantId: tenantId("tenant-a"), pageId: pageId("page-a") },
    customerId: customerId("customer-a"),
    experimentId: "opening-v1",
    variants: ["V1", "V2", "V3", "V4", "V5"],
  };
  assert.equal(assignVariant(input), assignVariant(input));
});

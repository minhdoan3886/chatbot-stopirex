import { createHash } from "node:crypto";
import type { CustomerId, Scope } from "./types.js";

export function assignVariant(input: {
  scope: Scope;
  customerId: CustomerId;
  experimentId: string;
  variants: readonly string[];
}): string {
  if (input.variants.length === 0) throw new Error("Experiment phải có ít nhất một variant");
  const key = [input.scope.tenantId, input.scope.pageId, input.customerId, input.experimentId].join(":");
  const digest = createHash("sha256").update(key).digest();
  const bucket = digest.readUInt32BE(0) % input.variants.length;
  return input.variants[bucket]!;
}

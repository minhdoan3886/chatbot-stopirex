import { createHash } from "node:crypto";

export type FunnelEventName =
  | "opening_exposed"
  | "reply"
  | "useful_reply"
  | "price_sent"
  | "order_created"
  | "opt_out"
  | "handoff"
  | "cancelled"
  | "returned";
export type FunnelEvent = {
  name: FunnelEventName;
  experimentId?: string;
  variantId?: string;
  customerId: string;
  at: Date;
  orderId?: string;
};

export type ExperimentConfig = {
  id: string;
  variants: readonly string[];
  allocation: readonly number[];
  startsAt: Date;
  endsAt: Date;
  eligible: boolean;
};
export function validateExperiment(config: ExperimentConfig): void {
  if (!config.eligible || config.startsAt >= config.endsAt) throw new Error("experiment_not_eligible");
  if (config.variants.length === 0 || config.variants.length !== config.allocation.length)
    throw new Error("invalid_allocation");
  const total = config.allocation.reduce((sum, value) => sum + value, 0);
  if (Math.abs(total - 1) > 0.0001 || config.allocation.some((value) => value <= 0))
    throw new Error("allocation_must_sum_to_one");
}

export function weightedVariant(config: ExperimentConfig, customerId: string): string {
  validateExperiment(config);
  const bucket =
    createHash("sha256").update(`${config.id}:${customerId}`).digest().readUInt32BE(0) / 0xffffffff;
  let cursor = 0;
  for (let index = 0; index < config.variants.length; index += 1) {
    cursor += config.allocation[index]!;
    if (bucket <= cursor) return config.variants[index]!;
  }
  return config.variants[config.variants.length - 1]!;
}

export function shouldStopExperiment(
  input: { exposed: number; optOut: number; blocked: number; complaints: number },
  threshold = 0.05,
): boolean {
  if (input.exposed < 20) return false;
  return (input.optOut + input.blocked + input.complaints) / input.exposed > threshold;
}

export function funnelCounts(events: readonly FunnelEvent[]): Record<FunnelEventName, number> {
  const counts = Object.fromEntries(
    [
      "opening_exposed",
      "reply",
      "useful_reply",
      "price_sent",
      "order_created",
      "opt_out",
      "handoff",
      "cancelled",
      "returned",
    ].map((name) => [name, 0]),
  ) as Record<FunnelEventName, number>;
  for (const event of events) counts[event.name] += 1;
  return counts;
}

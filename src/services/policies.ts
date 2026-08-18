import { timingSafeEqual } from "node:crypto";

export type HumanStatus = "bot" | "human" | "paused";
export type OutboundContext = {
  now: Date;
  lastCustomerMessageAt?: Date;
  optedOut: boolean;
  humanStatus: HumanStatus;
  category: "reply" | "followup" | "transactional";
};

export type PolicyDecision = { allowed: true } | { allowed: false; reason: string };

export function canSendOutbound(context: OutboundContext, windowHours = 24): PolicyDecision {
  if (context.optedOut) return { allowed: false, reason: "customer_opted_out" };
  if (context.humanStatus !== "bot") return { allowed: false, reason: "human_authoritative" };
  if (context.category === "transactional") return { allowed: true };
  if (!context.lastCustomerMessageAt) return { allowed: false, reason: "missing_customer_window" };
  const elapsed = context.now.getTime() - context.lastCustomerMessageAt.getTime();
  if (elapsed > windowHours * 3_600_000) return { allowed: false, reason: "outside_messaging_window" };
  return { allowed: true };
}

export type AdminRole = "editor" | "approver" | "operator";
const permissions: Record<AdminRole, readonly string[]> = {
  editor: ["content:edit", "content:preview"],
  approver: ["content:approve", "content:rollback", "audit:read"],
  operator: ["conversation:handoff", "conversation:resume", "orders:retry", "audit:read"],
};

export function authorize(role: AdminRole, action: string): void {
  if (!permissions[role].includes(action)) throw new Error(`role ${role} không có quyền ${action}`);
}

export function safeSecretEquals(received: string | undefined, expected: string | undefined): boolean {
  if (!received || !expected) return false;
  const left = Buffer.from(received);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function detectPromptInjection(text: string): boolean {
  const normalized = text.normalize("NFKC").toLocaleLowerCase("vi-VN");
  return [
    "bỏ qua hướng dẫn trước",
    "ignore previous instructions",
    "system prompt",
    "tenant khác",
    "api key",
    "access token",
  ].some((marker) => normalized.includes(marker));
}

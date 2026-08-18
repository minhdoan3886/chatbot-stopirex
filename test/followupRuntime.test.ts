import assert from "node:assert/strict";
import test from "node:test";
import type { MetaMessenger } from "../src/integrations/contracts.js";
import { FollowupDispatcher, evaluateFollowupEligibility } from "../src/services/followupDispatcher.js";
import type { ClaimedFollowupJob, PgFollowupRepository } from "../src/services/followupRepository.js";
import { StructuredLogger } from "../src/services/logger.js";

const anchor = new Date("2026-08-17T01:00:00.000Z");

function claimed(overrides: Partial<ClaimedFollowupJob> = {}): ClaimedFollowupJob {
  return {
    id: "job-1",
    cycleId: "cycle-1",
    tenantId: "tenant-1",
    pageId: "page-1",
    conversationId: "conversation-1",
    externalCustomerId: "customer-1",
    stage: "3h",
    idempotencyKey: "followup-key",
    attemptCount: 1,
    anchorSentAt: anchor,
    anchorStateVersion: 1,
    currentStateVersion: 1,
    cycleStatus: "active",
    humanStatus: "bot",
    pipelineTag: "3.Đã báo giá",
    pageActive: true,
    customerDeleted: false,
    orderExists: false,
    lastCustomerActivityAt: new Date("2026-08-17T00:59:00.000Z"),
    ...overrides,
  };
}

test("eligibility hủy follow-up nếu khách vừa trả lời hoặc đơn đã tồn tại", () => {
  assert.deepEqual(
    evaluateFollowupEligibility(
      claimed({ lastCustomerActivityAt: new Date("2026-08-17T01:01:00.000Z") }),
      new Date("2026-08-17T04:00:00.000Z"),
      24,
    ),
    { eligible: false, reason: "customer_replied" },
  );
  assert.deepEqual(
    evaluateFollowupEligibility(claimed({ orderExists: true }), new Date("2026-08-17T04:00:00.000Z"), 24),
    { eligible: false, reason: "order_already_exists" },
  );
});

test("eligibility chặn gửi ngoài cửa sổ outbound", () => {
  assert.deepEqual(
    evaluateFollowupEligibility(
      claimed({
        anchorSentAt: new Date("2026-08-18T01:00:00.000Z"),
        lastCustomerActivityAt: new Date("2026-08-17T00:00:00.000Z"),
      }),
      new Date("2026-08-18T00:00:00.000Z"),
      24,
    ),
    { eligible: false, reason: "outside_messaging_window" },
  );
});

test("shadow đánh dấu job nhưng tuyệt đối không gọi Meta", async () => {
  let metaCalls = 0;
  let shadowed = "";
  const repository = {
    async markShadowed(jobId: string) { shadowed = jobId; },
  } as unknown as PgFollowupRepository;
  const messenger = messengerFixture(async () => {
    metaCalls += 1;
    return { ok: true, value: { messageId: "meta-1" } };
  });
  const dispatcher = new FollowupDispatcher({
    repository,
    messenger,
    logger: new StructuredLogger(() => undefined),
    mode: "shadow",
    outboundWindowHours: 24,
    maxAttempts: 3,
    now: () => new Date("2026-08-17T04:00:00.000Z"),
  });

  assert.equal(await dispatcher.process(claimed()), "shadowed");
  assert.equal(shadowed, "job-1");
  assert.equal(metaCalls, 0);
});

test("timeout Meta được đánh dấu delivery_unknown và không retry tự động", async () => {
  let failureInput: Record<string, unknown> | undefined;
  const repository = {
    async isStillClaimed() { return true; },
    async markSendFailure(input: Record<string, unknown>) {
      failureInput = input;
      return "delivery_unknown" as const;
    },
  } as unknown as PgFollowupRepository;
  const dispatcher = new FollowupDispatcher({
    repository,
    messenger: messengerFixture(async () => ({
      ok: false,
      retryable: true,
      code: "network_error",
      message: "request timed out",
    })),
    logger: new StructuredLogger(() => undefined),
    mode: "enabled",
    outboundWindowHours: 24,
    maxAttempts: 3,
    now: () => new Date("2026-08-17T04:00:00.000Z"),
  });

  assert.equal(await dispatcher.process(claimed()), "delivery_unknown");
  assert.equal(failureInput?.ambiguous, true);
});

function messengerFixture(
  sendText: MetaMessenger["sendText"],
): MetaMessenger {
  return {
    sendText,
    async sendImage() { return { ok: true, value: { messageId: "image-1" } }; },
    async sendTyping() { return { ok: true, value: undefined }; },
  };
}

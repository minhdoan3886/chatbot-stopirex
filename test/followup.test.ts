import assert from "node:assert/strict";
import test from "node:test";
import { buildFollowupJobs, cancelPendingJobs } from "../src/domain/followup.js";
import { conversationId, pageId, tenantId } from "../src/domain/types.js";
import { InMemoryFollowupRepository } from "../src/services/followupRepository.js";

const scope = { tenantId: tenantId("tenant-a"), pageId: pageId("page-a") };
const conversation = conversationId("conversation-a");

test("lên lịch chính xác 3h, 6h và 9h", () => {
  const sentAt = new Date("2026-07-22T01:00:00.000Z");
  const jobs = buildFollowupJobs({ scope, conversationId: conversation, priceSentAt: sentAt });
  assert.deepEqual(
    jobs.map((job) => job.stage),
    ["3h", "6h", "9h"],
  );
  assert.deepEqual(
    jobs.map((job) => job.dueAt.toISOString()),
    ["2026-07-22T04:00:00.000Z", "2026-07-22T07:00:00.000Z", "2026-07-22T10:00:00.000Z"],
  );
});

test("schedule retry không tạo job trùng", () => {
  const jobs = buildFollowupJobs({ scope, conversationId: conversation, priceSentAt: new Date() });
  const repository = new InMemoryFollowupRepository();
  repository.schedule(jobs);
  repository.schedule(jobs);
  assert.equal(repository.list().length, 3);
});

test("reply hủy toàn bộ job đang chờ", () => {
  const jobs = buildFollowupJobs({ scope, conversationId: conversation, priceSentAt: new Date() });
  const cancelled = cancelPendingJobs(jobs, "customer_replied");
  assert.ok(cancelled.every((job) => job.status === "cancelled" && job.cancelReason === "customer_replied"));
});

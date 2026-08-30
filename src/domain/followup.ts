import type { ConversationId, Scope } from "./types.js";
import { scopedKey } from "./types.js";

export type FollowupStage = "3h" | "6h" | "9h";
export type FollowupStatus = "scheduled" | "claimed" | "sent" | "cancelled";

export type FollowupContextSnapshot = {
  customerMessage?: string;
  assistantReply?: string;
  customerDisplayName?: string;
  lastIntent?: string;
  activeSkill?: string;
  pipeline?: string;
  nextBestAction?: {
    key: string;
    prompt?: string;
  };
  conversationMemory?: {
    currentGoal?: string;
    usedArguments?: string[];
    rejectedArguments?: string[];
    openQuestions?: string[];
  };
  answeredTopics?: string[];
  askedTopics?: string[];
};

export type FollowupJob = {
  id: string;
  conversationId: ConversationId;
  scope: Scope;
  stage: FollowupStage;
  dueAt: Date;
  status: FollowupStatus;
  idempotencyKey: string;
  freeShippingOneApproved: true;
  cancelReason?: string;
};

export function buildFollowupJobs(input: {
  scope: Scope;
  conversationId: ConversationId;
  priceSentAt: Date;
}): FollowupJob[] {
  const stages: Array<[FollowupStage, number]> = [
    ["3h", 3],
    ["6h", 6],
    ["9h", 9],
  ];
  return stages.map(([stage, hours]) => {
    const idempotencyKey = scopedKey(input.scope, input.conversationId, "followup", stage);
    return {
      id: idempotencyKey,
      conversationId: input.conversationId,
      scope: input.scope,
      stage,
      dueAt: new Date(input.priceSentAt.getTime() + hours * 60 * 60 * 1000),
      status: "scheduled",
      idempotencyKey,
      freeShippingOneApproved: true,
    };
  });
}

export function cancelPendingJobs(jobs: readonly FollowupJob[], reason: string): FollowupJob[] {
  return jobs.map((job) =>
    job.status === "scheduled" || job.status === "claimed"
      ? { ...job, status: "cancelled", cancelReason: reason }
      : { ...job },
  );
}

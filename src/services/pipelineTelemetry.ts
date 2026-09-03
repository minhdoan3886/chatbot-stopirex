import type { LogRecord } from "./logger.js";

export type PipelineStageId = "interpret" | "normalize" | "reducer" | "compose" | "guard";
export type PipelineStageStatus = "idle" | "healthy" | "degraded" | "down";

export type PipelineStageTelemetry = {
  id: PipelineStageId;
  label: string;
  status: PipelineStageStatus;
  lastEventAt?: string;
  detail: string;
};

const definitions: ReadonlyArray<Pick<PipelineStageTelemetry, "id" | "label">> = [
  { id: "interpret", label: "Interpret" },
  { id: "normalize", label: "Normalize" },
  { id: "reducer", label: "Reducer" },
  { id: "compose", label: "Compose" },
  { id: "guard", label: "Guard" },
];

export class PipelineTelemetryTracker {
  private readonly stages = new Map<PipelineStageId, PipelineStageTelemetry>(
    definitions.map(({ id, label }) => [id, { id, label, status: "idle", detail: "Chưa có lượt xử lý" }]),
  );

  observe(record: LogRecord): void {
    if (record.event === "llm_interpretation") {
      const status = String(record.status ?? "unknown");
      this.update(
        "interpret",
        status === "interpreted" ? "healthy" : status === "unavailable" ? "down" : "degraded",
        status === "interpreted"
          ? "Structured Output hợp lệ"
          : `Fallback: ${safeReason(record.reason, status)}`,
        record.at,
      );
      return;
    }
    if (record.event === "llm_composition") {
      const status = String(record.status ?? "unknown");
      this.update(
        "compose",
        status === "enhanced" ? "healthy" : status === "unavailable" ? "down" : "degraded",
        status === "enhanced" ? "Bản soạn đã qua kiểm tra" : `Fallback: ${safeReason(record.reason, status)}`,
        record.at,
      );
      return;
    }
    if (record.event !== "conversation_turn_audit") return;

    const rejected = arrayLength(record.rejectedOrderMutations);
    const conflicts = arrayLength(record.orderConflicts);
    const changed = arrayLength(record.orderChangedFields);
    this.update(
      "normalize",
      "healthy",
      rejected > 0 ? `Đã chặn an toàn ${rejected} mutation không hợp lệ` : "Dữ liệu đầu vào đã chuẩn hóa",
      record.at,
    );
    this.update(
      "reducer",
      conflicts > 0 ? "degraded" : "healthy",
      conflicts > 0 ? `${conflicts} xung đột cần reconcile` : `Commit hợp lệ · ${changed} trường thay đổi`,
      record.at,
    );
    const blocked = record.responseOutcome === "block";
    this.update(
      "guard",
      blocked ? "down" : "healthy",
      blocked
        ? `Đã chặn response: ${safeReason(record.responseReason, "guard_rejected")}`
        : "Response invariant đạt",
      record.at,
    );
  }

  snapshot(): PipelineStageTelemetry[] {
    return definitions.map(({ id }) => ({ ...this.stages.get(id)! }));
  }

  private update(id: PipelineStageId, status: PipelineStageStatus, detail: string, at: string): void {
    const current = this.stages.get(id)!;
    this.stages.set(id, { ...current, status, detail, lastEventAt: at });
  }
}

function arrayLength(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function safeReason(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 120) : fallback;
}

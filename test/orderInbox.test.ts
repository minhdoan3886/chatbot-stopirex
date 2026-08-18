/**
 * test/orderInbox.test.ts
 * Unit tests cho OrderInboxService.
 * Dùng mock Pool – không cần PostgreSQL thật.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { OrderInboxService } from "../src/services/orderInbox.js";
import type { OrderInboxRecord } from "../src/services/orderInbox.js";

// ---------------------------------------------------------------------------
// Helper: tạo một Pool mock đơn giản
// ---------------------------------------------------------------------------
function makePool(rows: OrderInboxRecord[] = []) {
  return {
    async query(_text: string, _params?: unknown[]) {
      return { rows };
    },
  };
}

// Mẫu OrderDraft hợp lệ
const validDraft = {
  recipientName: "Nguyễn Thị B",
  phone: "0912345678",
  legacyAddress: "Số 5 Trần Phú, phường Mộ Lao, quận Hà Đông, Hà Nội",
  sku: "STOPIREX-30ML",
  quantity: 2 as const,
  totalVnd: 560_000,
  paymentMethod: "cod" as const,
  deliveryNote: "Gọi trước 30 phút",
};

// Mẫu record đã lưu
const savedRecord: OrderInboxRecord = {
  id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  sessionId: "session-001",
  channel: "meta",
  recipientName: validDraft.recipientName,
  phone: validDraft.phone,
  legacyAddress: validDraft.legacyAddress,
  deliveryNote: validDraft.deliveryNote,
  sku: validDraft.sku,
  quantity: validDraft.quantity,
  totalVnd: validDraft.totalVnd,
  paymentMethod: validDraft.paymentMethod,
  status: "pending",
  confirmedAt: "2026-08-18T09:00:00.000Z",
  createdAt: "2026-08-18T09:00:00.000Z",
  updatedAt: "2026-08-18T09:00:00.000Z",
};

// ---------------------------------------------------------------------------
// push() – ghi đơn mới
// ---------------------------------------------------------------------------
test("push() trả về record khi INSERT thành công", async () => {
  const pool = makePool([savedRecord]);
  const service = new OrderInboxService(pool as never);

  const result = await service.push({
    sessionId: "session-001",
    draft: validDraft,
    confirmedAt: new Date("2026-08-18T09:00:00.000Z"),
  });

  assert.equal(result.id, savedRecord.id);
  assert.equal(result.status, "pending");
  assert.equal(result.recipientName, validDraft.recipientName);
  assert.equal(result.phone, validDraft.phone);
  assert.equal(result.sku, validDraft.sku);
  assert.equal(result.quantity, 2);
  assert.equal(result.totalVnd, 560_000);
  assert.equal(result.paymentMethod, "cod");
});

test("push() trả về record từ SELECT khi ON CONFLICT bắn ra (rows rỗng lần 1)", async () => {
  let callCount = 0;
  const pool = {
    async query(_text: string, _params?: unknown[]) {
      callCount++;
      // Lần 1 (INSERT): rows rỗng → ON CONFLICT
      // Lần 2 (SELECT fallback): trả record
      return { rows: callCount === 1 ? [] : [savedRecord] };
    },
  };
  const service = new OrderInboxService(pool as never);

  const result = await service.push({
    sessionId: "session-001",
    draft: validDraft,
    confirmedAt: new Date("2026-08-18T09:00:00.000Z"),
  });

  assert.equal(callCount, 2, "Phải gọi SELECT fallback sau khi ON CONFLICT");
  assert.equal(result.id, savedRecord.id);
  assert.equal(result.status, "pending");
});

test("push() tự động điền channel mặc định là 'meta'", async () => {
  const capturedParams: unknown[][] = [];
  const pool = {
    async query(_text: string, params?: unknown[]) {
      if (params) capturedParams.push(params);
      return { rows: [savedRecord] };
    },
  };
  const service = new OrderInboxService(pool as never);

  await service.push({
    sessionId: "session-001",
    draft: validDraft,
    confirmedAt: new Date(),
  });

  // Tham số thứ 2 (index 1) là channel
  assert.equal(capturedParams[0]?.[1], "meta");
});

// ---------------------------------------------------------------------------
// list() – lấy danh sách đơn
// ---------------------------------------------------------------------------
test("list() trả về tổng, số pending và records", async () => {
  let queryCount = 0;
  const pool = {
    async query(_text: string) {
      queryCount++;
      if (queryCount === 1) {
        // COUNT query
        return { rows: [{ total: "3", pending: "1" }] };
      }
      // Records query
      return { rows: [savedRecord] };
    },
  };
  const service = new OrderInboxService(pool as never);

  const result = await service.list();

  assert.equal(result.total, 3);
  assert.equal(result.pending, 1);
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0]?.id, savedRecord.id);
});

test("list() không có đơn trả về total và pending bằng 0", async () => {
  let queryCount = 0;
  const pool = {
    async query() {
      queryCount++;
      return { rows: queryCount === 1 ? [{ total: "0", pending: "0" }] : [] };
    },
  };
  const service = new OrderInboxService(pool as never);

  const result = await service.list();

  assert.equal(result.total, 0);
  assert.equal(result.pending, 0);
  assert.equal(result.records.length, 0);
});

test("list() lọc theo status khi truyền filter", async () => {
  const capturedQueries: string[] = [];
  const pool = {
    async query(text: string) {
      capturedQueries.push(text);
      return {
        rows: capturedQueries.length === 1 ? [{ total: "5", pending: "2" }] : [],
      };
    },
  };
  const service = new OrderInboxService(pool as never);

  await service.list({ status: "completed" });

  // Query thứ hai (SELECT records) phải có WHERE clause
  const recordsQuery = capturedQueries[1] ?? "";
  assert.match(recordsQuery, /WHERE status = \$1/);
});

// ---------------------------------------------------------------------------
// updateStatus() – cập nhật trạng thái
// ---------------------------------------------------------------------------
test("updateStatus() trả về record đã cập nhật khi thành công", async () => {
  const completedRecord: OrderInboxRecord = {
    ...savedRecord,
    status: "completed",
    updatedAt: "2026-08-18T10:00:00.000Z",
  };
  const pool = makePool([completedRecord]);
  const service = new OrderInboxService(pool as never);

  const result = await service.updateStatus(savedRecord.id, "completed");

  assert.ok(result, "Phải trả về record");
  assert.equal(result!.status, "completed");
  assert.equal(result!.id, savedRecord.id);
});

test("updateStatus() trả về undefined khi không tìm thấy đơn", async () => {
  const pool = makePool([]); // rows rỗng → UPDATE không khớp
  const service = new OrderInboxService(pool as never);

  const result = await service.updateStatus("id-khong-ton-tai", "completed");

  assert.equal(result, undefined);
});

test("updateStatus() ghi note khi huỷ đơn", async () => {
  const capturedParams: unknown[][] = [];
  const cancelledRecord: OrderInboxRecord = {
    ...savedRecord,
    status: "cancelled",
    note: "Khách đổi ý",
  };
  const pool = {
    async query(_text: string, params?: unknown[]) {
      if (params) capturedParams.push(params);
      return { rows: [cancelledRecord] };
    },
  };
  const service = new OrderInboxService(pool as never);

  const result = await service.updateStatus(savedRecord.id, "cancelled", "Khách đổi ý");

  assert.ok(result);
  assert.equal(result!.status, "cancelled");
  assert.equal(result!.note, "Khách đổi ý");
  // Kiểm tra note được truyền vào params đúng
  assert.equal(capturedParams[0]?.[2], "Khách đổi ý");
});

test("updateStatus() chấp nhận cả 'completed' và 'cancelled'", async () => {
  const pool = makePool([{ ...savedRecord, status: "completed" }]);
  const service = new OrderInboxService(pool as never);

  const r1 = await service.updateStatus(savedRecord.id, "completed");
  assert.equal(r1?.status, "completed");

  const pool2 = makePool([{ ...savedRecord, status: "cancelled" }]);
  const service2 = new OrderInboxService(pool2 as never);

  const r2 = await service2.updateStatus(savedRecord.id, "cancelled");
  assert.equal(r2?.status, "cancelled");
});

// ---------------------------------------------------------------------------
// Kiểm tra tính toàn vẹn kiểu dữ liệu
// ---------------------------------------------------------------------------
test("record trả về có đủ các trường bắt buộc", async () => {
  const pool = makePool([savedRecord]);
  const service = new OrderInboxService(pool as never);
  const result = await service.push({
    sessionId: "session-001",
    draft: validDraft,
    confirmedAt: new Date(),
  });

  // Các trường bắt buộc phải có
  assert.ok(typeof result.id === "string", "id phải là string");
  assert.ok(typeof result.sessionId === "string", "sessionId phải là string");
  assert.ok(typeof result.channel === "string", "channel phải là string");
  assert.ok(typeof result.status === "string", "status phải là string");
  assert.ok(typeof result.confirmedAt === "string", "confirmedAt phải là string ISO");
  assert.ok(typeof result.createdAt === "string", "createdAt phải là string ISO");
  assert.ok(typeof result.updatedAt === "string", "updatedAt phải là string ISO");
});

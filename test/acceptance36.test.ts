import assert from "node:assert/strict";
import test from "node:test";
import { routeSalesIntent, type SalesIntent } from "../src/domain/sales.js";

const fixtures: Array<{ id: string; text: string; expected: SalesIntent }> = [
  ["T-001", "tư vấn giúp mình", "opening"],
  ["T-002", "xin chào shop", "opening"],
  ["T-003", "ib", "opening"],
  ["T-004", "mình cần tư vấn", "opening"],
  ["T-005", "mình làm ngoài trời", "work_context"],
  ["T-006", "ngồi văn phòng phòng lạnh vẫn ra", "work_context"],
  ["T-007", "vận động mạnh mới bị", "work_context"],
  ["T-008", "căng thẳng thì ra nhiều", "work_context"],
  ["T-009", "mồ hôi nhiều", "symptom"],
  ["T-010", "bị mùi cơ thể", "symptom"],
  ["T-011", "ướt áo", "symptom"],
  ["T-012", "vừa mồ hôi vừa mùi", "symptom"],
  ["T-013", "đã dùng lăn cũ", "prior_product"],
  ["T-014", "chưa dùng loại nào", "prior_product"],
  ["T-015", "đang dùng lăn hằng ngày", "prior_product"],
  ["T-016", "đã dùng dòng chuyên sâu", "prior_product"],
  ["T-017", "giá bao nhiêu", "price"],
  ["T-018", "combo 2 lọ", "price"],
  ["T-019", "phí ship thế nào", "price"],
  ["T-020", "xin bảng giá", "price"],
  ["T-021", "mình chốt 1 lọ", "order"],
  ["T-022", "đặt combo", "order"],
  ["T-023", "số điện thoại 0912345678", "order"],
  ["T-024", "địa chỉ của mình là Hà Nội", "order"],
  ["T-025", "dùng bị rát", "customer_care"],
  ["T-026", "da đang ngứa", "customer_care"],
  ["T-027", "dùng không hiệu quả", "customer_care"],
  ["T-028", "nghi hàng giả", "customer_care"],
  ["T-029", "đơn giao chậm", "customer_care"],
  ["T-030", "đơn bị thiếu hàng", "customer_care"],
  ["T-031", "dừng nhắn", "opt_out"],
  ["T-032", "không nhắn nữa", "opt_out"],
  ["T-033", "STOP", "opt_out"],
  ["T-034", "hủy đăng ký", "opt_out"],
  ["T-035", "abc xyz", "fallback"],
  ["T-036", "🙂", "fallback"],
].map(([id, text, expected]) => ({ id, text, expected })) as Array<{
  id: string;
  text: string;
  expected: SalesIntent;
}>;

test("replay đủ 36 tình huống nghiệm thu", () => {
  assert.equal(fixtures.length, 36);
  for (const fixture of fixtures) assert.equal(routeSalesIntent(fixture.text), fixture.expected, fixture.id);
});

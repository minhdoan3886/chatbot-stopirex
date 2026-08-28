import assert from "node:assert/strict";
import test from "node:test";
import { ordersPage } from "../src/http/ordersPage.js";

test("script trang đơn hàng hợp lệ và chỉ hoàn tất sau khi gửi vận đơn", () => {
  const script = ordersPage.match(/<script>([\s\S]*?)<\/script>/u)?.[1];
  assert.ok(script, "Trang đơn hàng phải có script");
  assert.doesNotThrow(() => new Function(script));
  assert.match(script, /data-order-action="send-tracking"/u);
  assert.match(script, /\/api\/orders\/'\+id\+'\/tracking/u);
  assert.doesNotMatch(script, /data-order-action="completed"/u);
  assert.match(script, /orderRows.*addEventListener\('click'/su);
  assert.doesNotMatch(script, /onclick=/u);
});

test("trang production không còn lối vào chat thử hay nhãn demo", () => {
  assert.doesNotMatch(ordersPage, /Chat thử|DEMO-|localhost|sandbox/iu);
  assert.match(ordersPage, /Nhập mã vận đơn thật/u);
  assert.match(ordersPage, /Viettel Post/u);
  assert.doesNotMatch(ordersPage, /Mở trang tra cứu/u);
  assert.match(ordersPage, /Đã gửi vận đơn/u);
});

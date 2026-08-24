import assert from "node:assert/strict";
import test from "node:test";
import { ordersPage } from "../src/http/ordersPage.js";

test("script trang đơn hàng hợp lệ và dùng event delegation cho nút trạng thái", () => {
  const script = ordersPage.match(/<script>([\s\S]*?)<\/script>/u)?.[1];
  assert.ok(script, "Trang đơn hàng phải có script");
  assert.doesNotThrow(() => new Function(script));
  assert.match(script, /data-order-action="completed"/u);
  assert.match(script, /orderRows.*addEventListener\('click'/su);
  assert.doesNotMatch(script, /onclick=/u);
});

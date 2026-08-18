import assert from "node:assert/strict";
import test from "node:test";
import { InvalidPipelineTransition, transitionPipeline, validateTagLengths } from "../src/domain/pipeline.js";

test("tất cả tag không vượt quá 14 ký tự", () => {
  assert.doesNotThrow(validateTagLengths);
});

test("Pipeline đi đúng các bước tạo đơn", () => {
  let state = transitionPipeline("0.Chưa tư vấn", "first_reply");
  state = transitionPipeline(state, "classified");
  state = transitionPipeline(state, "price_sent");
  state = transitionPipeline(state, "agreed_to_buy");
  state = transitionPipeline(state, "order_created");
  assert.equal(state, "6.Đã tạo đơn");
});

test("không cho chuyển thẳng từ khách mới sang tạo đơn", () => {
  assert.throws(() => transitionPipeline("0.Chưa tư vấn", "order_created"), InvalidPipelineTransition);
});

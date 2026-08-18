import assert from "node:assert/strict";
import test from "node:test";
import { batchMessages } from "../src/services/messageBatcher.js";

test("gom tin theo thời gian và không trả từng tin rời", () => {
  const batch = batchMessages([
    { id: "2", sentAt: new Date("2026-01-01T00:00:02Z"), text: "em từng bị rát" },
    { id: "1", sentAt: new Date("2026-01-01T00:00:01Z"), text: "cho chị hỏi giá" },
    { id: "3", sentAt: new Date("2026-01-01T00:00:03Z"), text: "chị làm ngoài trời" },
  ]);
  assert.equal(batch, "cho chị hỏi giá\nem từng bị rát\nchị làm ngoài trời");
});

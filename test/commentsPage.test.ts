import assert from "node:assert/strict";
import test from "node:test";
import { commentsPage } from "../src/http/commentsPage.js";

test("comment operations exposes the Meta review evidence without exposing credentials", () => {
  const script = commentsPage.match(/<script>([\s\S]*?)<\/script>/u)?.[1];
  assert.ok(script);
  assert.doesNotThrow(() => new Function(script));
  assert.match(commentsPage, /Facebook Comment operations/u);
  assert.match(commentsPage, /Reviewer evidence/u);
  assert.match(commentsPage, /Public reply/u);
  assert.match(commentsPage, /Private reply/u);
  assert.match(commentsPage, /Hide comment/u);
  assert.match(commentsPage, /Unhide comment/u);
  assert.match(commentsPage, /<html lang="en">/u);
  assert.doesNotMatch(commentsPage, /EAA[A-Za-z0-9]/u);
});

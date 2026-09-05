import assert from "node:assert/strict";
import test from "node:test";
import { parseMetaWebhook } from "../src/adapters/metaEvents.js";
import { GraphMetaMessenger } from "../src/adapters/metaMessenger.js";

test("feed comment mới được chuyển thành inbound comment", () => {
  const events = parseMetaWebhook({
    object: "page",
    entry: [
      {
        id: "page-1",
        changes: [
          {
            field: "feed",
            value: {
              item: "comment",
              verb: "add",
              from: { id: "customer-1" },
              comment_id: "comment-1",
              post_id: "post-1",
              message: "  Giá 2 lọ bao nhiêu?  ",
              created_time: 1_770_000_001,
            },
          },
        ],
      },
    ],
  });
  assert.deepEqual(
    events.map((event) => ({
      kind: event.kind,
      senderId: event.senderId,
      commentId: event.commentId,
      postId: event.postId,
      text: event.text,
    })),
    [
      {
        kind: "comment",
        senderId: "customer-1",
        commentId: "comment-1",
        postId: "post-1",
        text: "Giá 2 lọ bao nhiêu?",
      },
    ],
  );
});

test("bỏ qua comment do Page tạo", () => {
  const events = parseMetaWebhook({
    object: "page",
    entry: [
      {
        id: "page-1",
        changes: [
          {
            field: "feed",
            value: {
              item: "comment",
              verb: "add",
              from: { id: "page-1" },
              comment_id: "c",
              message: "Shop trả lời",
            },
          },
        ],
      },
    ],
  });
  assert.deepEqual(events, []);
});

test("Graph adapter gửi public, private và ẩn comment đúng endpoint", async () => {
  const calls: Array<{ url: string; body: unknown }> = [];
  const messenger = new GraphMetaMessenger({
    pageAccessToken: "page-token",
    graphVersion: "v25.0",
    fetcher: async (input, init) => {
      calls.push({ url: String(input), body: JSON.parse(String(init?.body)) });
      return Response.json(calls.length < 3 ? { id: `result-${calls.length}` } : { success: true });
    },
  });
  assert.equal(
    (await messenger.sendPublicCommentReply({ commentId: "c1", text: "Public", idempotencyKey: "1" })).ok,
    true,
  );
  assert.equal(
    (await messenger.sendPrivateCommentReply({ commentId: "c1", text: "Private", idempotencyKey: "2" })).ok,
    true,
  );
  assert.equal((await messenger.setCommentHidden({ commentId: "c1", hidden: true })).ok, true);
  assert.match(calls[0]!.url, /\/c1\/comments\?/u);
  assert.match(calls[1]!.url, /\/c1\/private_replies\?/u);
  assert.deepEqual(calls[2]!.body, { is_hidden: true });
});

import assert from "node:assert/strict";
import test from "node:test";
import { parseMetaWebhook } from "../src/adapters/metaEvents.js";

test("Meta feed comment mới được chuyển thành inbound comment", () => {
  const events = parseMetaWebhook({
    object: "page",
    entry: [
      {
        id: "page-1",
        time: 1_770_000_000,
        changes: [
          {
            field: "feed",
            value: {
              item: "comment",
              verb: "add",
              from: { id: "customer-1", name: "Khách" },
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

  assert.equal(events.length, 1);
  assert.deepEqual(
    {
      kind: events[0]?.kind,
      senderId: events[0]?.senderId,
      eventId: events[0]?.eventId,
      commentId: events[0]?.commentId,
      postId: events[0]?.postId,
      text: events[0]?.text,
    },
    {
      kind: "comment",
      senderId: "customer-1",
      eventId: "comment-1",
      commentId: "comment-1",
      postId: "post-1",
      text: "Giá 2 lọ bao nhiêu?",
    },
  );
});

test("Meta bỏ qua comment do chính Page tạo và các thay đổi không phải comment mới", () => {
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
              comment_id: "page-comment",
              message: "Shop trả lời",
            },
          },
          {
            field: "feed",
            value: {
              item: "comment",
              verb: "edited",
              from: { id: "customer-1" },
              comment_id: "edited-comment",
              message: "Đã sửa",
            },
          },
        ],
      },
    ],
  });

  assert.deepEqual(events, []);
});

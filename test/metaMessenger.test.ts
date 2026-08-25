import assert from "node:assert/strict";
import test from "node:test";
import { GraphMetaMessenger } from "../src/adapters/metaMessenger.js";

test("Meta gửi private reply và public reply từ comment qua đúng Graph endpoint", async () => {
  const calls: Array<{ url: string; body: unknown }> = [];
  const messenger = new GraphMetaMessenger({
    pageAccessToken: "page-token",
    graphVersion: "v25.0",
    fetcher: async (input, init) => {
      calls.push({ url: String(input), body: JSON.parse(String(init?.body)) });
      return Response.json({ id: `result-${calls.length}` });
    },
  });

  const privateReply = await messenger.sendPrivateCommentReply({
    commentId: "comment_1",
    text: "Em đã nhắn tin tư vấn mình ạ.",
    idempotencyKey: "private-1",
  });
  const publicReply = await messenger.sendPublicCommentReply({
    commentId: "comment_1",
    text: "Mình kiểm tra Messenger giúp shop nhé.",
    idempotencyKey: "public-1",
  });

  assert.equal(privateReply.ok, true);
  assert.equal(publicReply.ok, true);
  assert.match(calls[0]?.url ?? "", /\/v25\.0\/comment_1\/private_replies\?/u);
  assert.match(calls[1]?.url ?? "", /\/v25\.0\/comment_1\/comments\?/u);
  assert.deepEqual(
    calls.map((call) => call.body),
    [{ message: "Em đã nhắn tin tư vấn mình ạ." }, { message: "Mình kiểm tra Messenger giúp shop nhé." }],
  );
});

test("Meta ẩn và hiện lại comment bằng is_hidden", async () => {
  const calls: Array<{ url: string; body: unknown }> = [];
  const messenger = new GraphMetaMessenger({
    pageAccessToken: "page-token",
    graphVersion: "v25.0",
    fetcher: async (input, init) => {
      calls.push({ url: String(input), body: JSON.parse(String(init?.body)) });
      return Response.json({ success: true });
    },
  });

  assert.equal((await messenger.setCommentHidden({ commentId: "comment_1", hidden: true })).ok, true);
  assert.equal((await messenger.setCommentHidden({ commentId: "comment_1", hidden: false })).ok, true);
  assert.match(calls[0]?.url ?? "", /\/v25\.0\/comment_1\?/u);
  assert.deepEqual(
    calls.map((call) => call.body),
    [{ is_hidden: true }, { is_hidden: false }],
  );
});

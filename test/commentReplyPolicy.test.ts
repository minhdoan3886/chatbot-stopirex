import assert from "node:assert/strict";
import test from "node:test";
import { composeCommentReplyPlan } from "../src/services/commentReplyPolicy.js";

test("comment hỏi giá không lộ giá công khai và giữ báo giá grounded trong private reply", () => {
  const plan = composeCommentReplyPlan({
    commentText: "giá combo 2 lọ bao nhiêu shop",
    intent: "price_request",
    groundedReplies: ["Dạ combo 2 lọ hiện là 510.000đ, miễn phí giao ạ."],
  });

  assert.equal(plan.category, "price");
  assert.doesNotMatch(plan.publicReply, /\b510\b|\b\d{1,3}(?:[.]\d{3})+\s*đ|\b\d+\s*(?:k|nghìn)\b/iu);
  assert.match(plan.publicReply, /tin nhắn riêng/iu);
  assert.match(plan.privateReply, /510\.000đ/u);
});

test("comment khiếu nại chỉ xoa dịu và xin dữ liệu xử lý, không chào bán", () => {
  const plan = composeCommentReplyPlan({
    commentText: "đơn báo hủy mà giao lâu quá",
    intent: "order_support",
    humanCareRequired: true,
    groundedReplies: ["Mình lấy 1 lọ hay combo 2 lọ để em lên đơn ạ?"],
  });

  assert.equal(plan.category, "complaint");
  assert.equal(plan.priority, "urgent");
  assert.match(plan.publicReply, /rất tiếc|trải nghiệm/iu);
  assert.match(plan.privateReply, /mã đơn|SĐT/iu);
  assert.doesNotMatch(`${plan.publicReply} ${plan.privateReply}`, /combo|lấy \d+ lọ|chốt đơn/iu);
});

test("comment tích cực được cảm ơn ngắn gọn và không ép mua", () => {
  const plan = composeCommentReplyPlan({
    commentText: "dùng rất tốt, cảm ơn shop",
    intent: "other",
    groundedReplies: ["Dạ cảm ơn mình ạ."],
  });

  assert.equal(plan.category, "positive");
  assert.match(plan.publicReply, /cảm ơn/iu);
  assert.doesNotMatch(plan.privateReply, /mua|combo|chốt/iu);
});

test("private reply luôn là đúng một nội dung cô đọng", () => {
  const long = `Dạ ${"thông tin phù hợp. ".repeat(50)}`;
  const plan = composeCommentReplyPlan({
    commentText: "tư vấn giúp mình",
    intent: "consultation",
    groundedReplies: [long, "Mình cho shop biết tình trạng nhé."],
  });

  assert.equal(plan.category, "consultation");
  assert.ok(plan.privateReply.length <= 480);
  assert.equal(Array.isArray(plan.privateReply), false);
});

import assert from "node:assert/strict";
import test from "node:test";
import { composeCommentReplyPlan, isLowInformationComment } from "../src/services/commentReplyPolicy.js";

test("comment hỏi giá giữ giá trong private reply, không lộ giá công khai", () => {
  const plan = composeCommentReplyPlan({
    commentText: "giá combo 2 lọ bao nhiêu shop",
    intent: "price_request",
    groundedReplies: ["Dạ combo 2 lọ hiện là 510.000đ, miễn phí giao ạ."],
  });
  assert.equal(plan.category, "price");
  assert.doesNotMatch(plan.publicReply, /\b510\b|\b\d{1,3}(?:[.]\d{3})+\s*đ/iu);
  assert.match(plan.publicReply, /tin nhắn riêng/iu);
  assert.match(plan.privateReply, /510\.000đ/u);
});

test("PII được tự ẩn, khiếu nại thật không PII vẫn giữ", () => {
  const pii = composeCommentReplyPlan({
    commentText: "shop gọi mình số 0983425566 nhé",
    intent: "consultation",
    groundedReplies: ["Dạ shop hỗ trợ mình ạ."],
  });
  assert.equal(pii.moderationRecommendation, "hide");
  assert.equal(pii.autoHide, true);

  const complaint = composeCommentReplyPlan({
    commentText: "đơn bị hủy mà giao lâu quá",
    intent: "order_support",
    humanCareRequired: true,
    groundedReplies: [],
  });
  assert.equal(complaint.category, "complaint");
  assert.equal(complaint.priority, "urgent");
  assert.equal(complaint.autoHide, false);
});

test("comment không có nội dung mở discovery ngắn", () => {
  assert.equal(isLowInformationComment("."), true);
  assert.equal(isLowInformationComment("😊"), true);
  assert.equal(isLowInformationComment("giá combo 2 lọ bao nhiêu?"), false);
  const plan = composeCommentReplyPlan({ commentText: ".", groundedReplies: [] });
  assert.equal((plan.privateReply.match(/\?/gu) ?? []).length, 1);
});

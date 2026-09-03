import assert from "node:assert/strict";
import test from "node:test";
import { CodexLlmBridge } from "../src/services/codexLlm.js";
import { DemoChatService } from "../src/services/demoChat.js";
import { MetaChatBrain } from "../src/services/metaChatBrain.js";

test("Meta brain dùng Knowledge chuẩn cho các câu P0 khi OpenAI hết quota", async () => {
  const llm = new CodexLlmBridge({
    enabled: true,
    provider: "openai",
    apiKey: "sk-test-not-a-real-key",
    runner: async () => {
      throw Object.assign(new Error("No credits remaining"), {
        status: 429,
        type: "insufficient_quota",
      });
    },
  });
  const brain = new MetaChatBrain(new DemoChatService(), llm);

  const priceAndSweat = await brain.reply({
    sessionId: "quota-price-sweat",
    text: "Báo giá giúp mình, mình ra mồ hôi nách nhiều thì dùng có đỡ không?",
  });
  const pregnancy = await brain.reply({
    sessionId: "quota-pregnancy",
    text: "Vợ mình đang mang thai thì dùng được không?",
  });

  assert.match(priceAndSweat.reply, /kiểm soát.*mồ hôi.*1 lọ.*285\.000đ/isu);
  assert.doesNotMatch(priceAndSweat.reply, /chưa có đủ thông tin.*chuyển bộ phận/isu);
  assert.match(pregnancy.reply, /mang thai.*tham khảo ý kiến bác sĩ/isu);
  assert.doesNotMatch(pregnancy.reply, /chưa có đủ thông tin.*chuyển bộ phận/isu);
});

test("OpenAI lỗi giữa lúc thu đơn vẫn giữ phone chữ, địa chỉ nối tiếp và delivery note", async () => {
  const llm = new CodexLlmBridge({
    enabled: true,
    provider: "openai",
    apiKey: "sk-test-not-a-real-key",
    runner: async () => {
      throw new Error("temporary_openai_failure");
    },
  });
  const brain = new MetaChatBrain(new DemoChatService(), llm);
  const common = {
    sessionId: "fallback-teencode-order",
    identity: { customerDisplayName: "Nguyễn Minh" },
    orderConfirmationMode: "inbox" as const,
    orderEditable: true,
  };

  await brain.reply({
    ...common,
    text: "thui chot m 1 lọ. ship dc q1 sg khum shop? free shp k b?",
  });
  const details = await brain.reply({
    ...common,
    text: "dc m la 12/4 nguyen thj minh khai, f dakao. sdt ko 9 tam bay 6 nam 4 ba 2 mot. giao trong gio hchjnh nha.",
  });

  assert.equal(details.state.orderDraft?.phone, "0987654321");
  assert.equal(
    details.state.orderDraft?.legacyAddress,
    "12/4 Nguyễn Thị Minh Khai, Phường Đa Kao, Quận 1, TP. Hồ Chí Minh",
  );
  assert.match(details.state.orderDraft?.deliveryNote ?? "", /Giao trong giờ hành chính/u);

  const inspection = await brain.reply({
    ...common,
    text: "a qen nua, dc do chi nhan dc t2 den t6 thui nhe. thu 7 m ngi lam. ma nhan hag dc kjem tra k b?",
  });
  assert.match(inspection.state.orderDraft?.deliveryNote ?? "", /Thứ 2 đến Thứ 6/u);
  assert.match(inspection.state.orderDraft?.deliveryNote ?? "", /Không nhận hàng Thứ 7/u);
  assert.match(inspection.reply, /kiểm tra bao bì|kiểm hàng|seal|tem/iu);
});

test("proposition mutation buộc composer chạy sau reducer commit", async () => {
  const calls: Array<{ purpose?: string; prompt: string }> = [];
  const llm = new CodexLlmBridge({
    enabled: true,
    runner: async (prompt, purpose) => {
      calls.push({ prompt, ...(purpose ? { purpose } : {}) });
      if (purpose === "interpret") {
        return JSON.stringify({
          intent: "buying",
          topic: "order",
          confidence: 0.99,
          needsClarification: false,
          propositions: [
            {
              id: "p1",
              speechAct: "request",
              action: "set_quantity",
              target: "order.quantity",
              topic: null,
              field: null,
              value: null,
              quantity: 1,
              rawEvidence: "chốt mình 1 lọ",
              confidence: 0.99,
            },
            {
              id: "p2",
              speechAct: "request",
              action: "continue_order_collection",
              target: "order.collection",
              topic: null,
              field: null,
              value: null,
              quantity: null,
              rawEvidence: "chốt mình 1 lọ",
              confidence: 0.99,
            },
          ],
          actions: [],
          claimedSavedFields: [{ field: "quantity", value: "1" }],
          draftReply: "Dạ em đã ghi nhận 1 lọ ạ.",
          draftBubbles: ["Dạ em đã ghi nhận 1 lọ ạ."],
          knowledgeIds: [],
          unsupportedQuestions: [],
          groundingConfidence: 1,
          asksDirectAnswer: false,
          slots: {},
        });
      }
      assert.equal(purpose, "post_commit");
      assert.match(prompt, /COMMIT_RECEIPT/u);
      assert.match(prompt, /"selectedQuantity":1/u);
      assert.match(prompt, /"acceptedMutations"/u);
      return JSON.stringify({
        bubbles: ["Dạ em đã ghi nhận mình chọn 1 lọ ạ. Mình gửi giúp em tên người nhận nhé?"],
        claimedSavedFields: [{ field: "quantity", value: "1" }],
      });
    },
  });
  const brain = new MetaChatBrain(
    new DemoChatService(),
    llm,
    undefined,
    { mode: "enabled", canaryPercent: 100 },
  );

  const response = await brain.reply({
    sessionId: "post-commit-proposition",
    text: "chốt mình 1 lọ",
  });

  assert.equal(calls.length, 2);
  assert.equal(response.state.selectedQuantity, 1);
  assert.equal(response.state.orderTransactionTrace?.acceptedMutations?.[0]?.propositionId, "p1");
  assert.match(response.reply, /đã ghi nhận.*1 lọ/iu);
});

test("post-commit composer lỗi vẫn giữ draft LLM đã được kiểm tra trên state mới", async () => {
  const llm = new CodexLlmBridge({
    enabled: true,
    runner: async (_prompt, purpose) => {
      if (purpose === "post_commit") throw new Error("temporary_openai_failure");
      return JSON.stringify({
        intent: "order_support",
        topic: "order",
        confidence: 0.99,
        needsClarification: false,
        propositions: [
          {
            id: "p-quantity",
            speechAct: "request",
            action: "set_quantity",
            target: "order.quantity",
            topic: null,
            field: null,
            value: null,
            quantity: 1,
            rawEvidence: "chốt 1 lọ",
            confidence: 0.99,
          },
          {
            id: "p-delivery",
            speechAct: "question",
            action: "answer_question",
            target: "delivery.availability",
            topic: "delivery",
            field: null,
            value: null,
            quantity: null,
            rawEvidence: "ship Quận 1 được không",
            confidence: 0.99,
          },
        ],
        actions: [],
        claimedSavedFields: [{ field: "quantity", value: "1" }],
        draftReply:
          "Dạ shop giao được Quận 1 ạ. Phí giao 30.000đ; cùng tỉnh/thành phố dự kiến 1–2 ngày, nội miền 2–3 ngày và liên miền Bắc–Nam 3–5 ngày. Em đã ghi nhận mình chọn 1 lọ.",
        draftBubbles: [
          "Dạ shop giao được Quận 1 ạ. Phí giao 30.000đ; cùng tỉnh/thành phố dự kiến 1–2 ngày, nội miền 2–3 ngày và liên miền Bắc–Nam 3–5 ngày. Em đã ghi nhận mình chọn 1 lọ.",
        ],
        knowledgeIds: ["online-only-standard-carrier-policy"],
        unsupportedQuestions: [],
        groundingConfidence: 1,
        asksDirectAnswer: true,
        slots: {},
      });
    },
  });
  const brain = new MetaChatBrain(new DemoChatService(), llm, undefined, {
    mode: "enabled",
    canaryPercent: 100,
  });

  const response = await brain.reply({
    sessionId: "post-commit-failure-keeps-validated-draft",
    text: "chốt 1 lọ, ship Quận 1 được không",
  });

  assert.equal(response.state.selectedQuantity, 1);
  assert.match(response.reply, /giao được Quận 1/iu);
  assert.match(response.reply, /đã ghi nhận.*1 lọ/iu);
  assert.match(response.state.responseDecision?.reason ?? "", /post_commit_unavailable_used_validated_draft/u);
});

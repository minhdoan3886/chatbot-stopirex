import assert from "node:assert/strict";
import test from "node:test";
import type { ConversationProposition } from "../src/domain/propositions.js";
import { CodexLlmBridge } from "../src/services/codexLlm.js";
import { DemoChatService } from "../src/services/demoChat.js";
import { MetaChatBrain } from "../src/services/metaChatBrain.js";
import { StructuredLogger } from "../src/services/logger.js";

function semanticResponse(input: {
  intent: "buying" | "order_support";
  propositions: ConversationProposition[];
  draft: string;
  knowledgeIds?: string[];
}) {
  return JSON.stringify({
    intent: input.intent,
    topic: "order",
    confidence: 0.99,
    needsClarification: false,
    propositions: input.propositions.map((item) => ({
      target: null,
      topic: null,
      field: null,
      value: null,
      quantity: null,
      ...item,
    })),
    actions: [],
    claimedSavedFields: [],
    draftReply: input.draft,
    draftBubbles: [input.draft],
    knowledgeIds: input.knowledgeIds ?? [],
    unsupportedQuestions: [],
    groundingConfidence: 1,
    asksDirectAnswer: true,
    slots: {},
  });
}

function jsonLine<T>(prompt: string, label: string): T {
  const line = prompt.split("\n").find((candidate) => candidate.startsWith(`${label}: `));
  assert.ok(line, `missing ${label}`);
  return JSON.parse(line.slice(label.length + 2)) as T;
}

test("product path: teencode turn 4–6 commits each proposition before composing", async () => {
  const calls: string[] = [];
  const logs: string[] = [];
  const llm = new CodexLlmBridge({
    enabled: true,
    runner: async (prompt, purpose) => {
      calls.push(purpose ?? "unknown");
      if (purpose === "post_commit") {
        const preCommitDraft = jsonLine<string>(prompt, "PRE_COMMIT_DRAFT");
        const receipt = jsonLine<{ acceptedMutations?: Array<{ type: string }> }>(prompt, "COMMIT_RECEIPT");
        const state = jsonLine<{
          selectedQuantity?: number;
          orderDraft?: Record<string, string | number>;
        }>(prompt, "POST_COMMIT_STATE");
        const fieldByMutation: Record<string, string> = {
          set_quantity: "quantity",
          set_phone: "phone",
          set_recipient_name: "recipientName",
          set_address: "legacyAddress",
          set_delivery_note: "deliveryNote",
        };
        return JSON.stringify({
          bubbles: [preCommitDraft],
          claimedSavedFields: (receipt.acceptedMutations ?? [])
            .map((mutation) => fieldByMutation[mutation.type])
            .filter((field): field is string => Boolean(field))
            .map((field) => ({
              field,
              value: String(field === "quantity" ? state.selectedQuantity : state.orderDraft?.[field]),
            })),
        });
      }

      const message = prompt.includes("Tin khách: ")
        ? jsonLine<string>(prompt, "Tin khách")
        : jsonLine<string>(prompt, "MESSAGE");
      if (message.includes("thui chot m 1 lọ")) {
        return semanticResponse({
          intent: "buying",
          knowledgeIds: ["pricing-approved-options-2026-08", "online-only-standard-carrier-policy"],
          draft:
            "Dạ shop giao được Quận 1, TP.HCM. 1 lọ là 285.000đ + 30.000đ phí giao, tổng 315.000đ. Bạn gửi giúp mình tên, SĐT và địa chỉ cụ thể nhé?",
          propositions: [
            {
              id: "t4-quantity",
              speechAct: "request",
              action: "set_quantity",
              quantity: 1,
              rawEvidence: "chot m 1 lọ",
              confidence: 0.99,
            },
            {
              id: "t4-delivery",
              speechAct: "question",
              action: "answer_question",
              topic: "delivery",
              rawEvidence: "ship dc q1 sg khum shop?",
              confidence: 0.99,
            },
            {
              id: "t4-shipping-fee",
              speechAct: "question",
              action: "answer_question",
              topic: "shipping",
              rawEvidence: "free shp k b?",
              confidence: 0.99,
            },
          ],
        });
      }
      if (message.includes("sdt ko 9 tam bay")) {
        return semanticResponse({
          intent: "order_support",
          draft: "Dạ mình đã ghi nhận địa chỉ, SĐT và ghi chú giao giờ hành chính ạ.",
          propositions: [
            {
              id: "t5-address",
              speechAct: "provide_data",
              action: "provide_order_field",
              field: "legacyAddress",
              value: "12/4 nguyen thj minh khai, f dakao",
              rawEvidence: "dc m la 12/4 nguyen thj minh khai, f dakao",
              confidence: 0.99,
            },
            {
              id: "t5-phone",
              speechAct: "provide_data",
              action: "provide_order_field",
              field: "phone",
              value: "ko 9 tam bay 6 nam 4 ba 2 mot",
              rawEvidence: "sdt ko 9 tam bay 6 nam 4 ba 2 mot",
              confidence: 0.99,
            },
            {
              id: "t5-note",
              speechAct: "provide_data",
              action: "append_delivery_note",
              field: "deliveryNote",
              value: "giao trong gio hchjnh",
              rawEvidence: "giao trong gio hchjnh nha",
              confidence: 0.99,
            },
          ],
        });
      }
      assert.match(message, /t2 den t6/u);
      return semanticResponse({
        intent: "order_support",
        draft:
          "Dạ mình đã cập nhật chỉ nhận từ Thứ 2 đến Thứ 6 và không nhận Thứ 7. Khi nhận, mình được kiểm tra bao bì ngoài, tem và đúng sản phẩm; không mở seal trước khi nhận hàng ạ.",
        knowledgeIds: ["domestic-delivery-inspection-policy"],
        propositions: [
          {
            id: "t6-note",
            speechAct: "update",
            action: "append_delivery_note",
            field: "deliveryNote",
            value: "chỉ nhận T2 đến T6, không nhận T7",
            rawEvidence: "dc do chi nhan dc t2 den t6 thui nhe. thu 7 m ngi lam",
            confidence: 0.99,
          },
          {
            id: "t6-inspection",
            speechAct: "question",
            action: "answer_question",
            topic: "delivery",
            rawEvidence: "nhan hag dc kjem tra k b?",
            confidence: 0.99,
          },
        ],
      });
    },
  });
  const chat = new DemoChatService();
  const brain = new MetaChatBrain(chat, llm, new StructuredLogger((line) => logs.push(line)), {
    mode: "enabled",
    canaryPercent: 100,
  });
  const sessionId = "teencode-proposition-product-path";
  const common = {
    sessionId,
    identity: { customerDisplayName: "Nguyễn Minh" },
    orderConfirmationMode: "inbox" as const,
    orderEditable: true,
  };

  const turn4 = await brain.reply({
    ...common,
    text: "thui chot m 1 lọ. ship dc q1 sg khum shop? free shp k b?",
  });
  assert.equal(turn4.state.selectedQuantity, 1);
  assert.equal(turn4.state.orderDraft?.legacyAddress, undefined);
  assert.equal(turn4.state.locationMemory?.addressContext?.district, "Quận 1");
  assert.equal(turn4.state.locationMemory?.addressContext?.city, "TP. Hồ Chí Minh");
  assert.deepEqual(
    turn4.state.decisionTrace?.actionPlan?.accepted
      .filter((action) => action.propositionId?.startsWith("t4-"))
      .map((action) => action.propositionId),
    ["t4-delivery", "t4-shipping-fee", "t4-quantity"],
    JSON.stringify({ plan: turn4.state.decisionTrace?.actionPlan, logs }),
  );

  const turn5 = await brain.reply({
    ...common,
    text: "dc m la 12/4 nguyen thj minh khai, f dakao. sdt ko 9 tam bay 6 nam 4 ba 2 mot. giao trong gio hchjnh nha.",
  });
  assert.equal(turn5.state.orderDraft?.phone, "0987654321");
  assert.equal(turn5.state.orderDraft?.recipientName, "Nguyễn Minh");
  assert.equal(
    turn5.state.orderDraft?.legacyAddress,
    "12/4 Nguyễn Thị Minh Khai, Phường Đa Kao, Quận 1, TP. Hồ Chí Minh",
  );
  assert.equal(turn5.state.orderDraft?.deliveryNote, "Giao trong giờ hành chính");
  assert.doesNotMatch(turn5.state.orderDraft?.recipientName ?? "", /M La/iu);

  const turn6 = await brain.reply({
    ...common,
    text: "a qen nua, dc do chi nhan dc t2 den t6 thui nhe. thu 7 m ngi lam. ma nhan hag dc kjem tra k b?",
  });
  assert.equal(turn6.state.orderDraft?.phone, "0987654321");
  assert.equal(turn6.state.orderDraft?.recipientName, "Nguyễn Minh");
  assert.match(turn6.state.orderDraft?.deliveryNote ?? "", /Thứ 2 đến Thứ 6/u);
  assert.match(turn6.state.orderDraft?.deliveryNote ?? "", /Không nhận hàng Thứ 7/u);
  assert.match(turn6.reply, /kiểm tra bao bì ngoài|kiem tra bao bi ngoai/iu);
  assert.deepEqual(
    turn6.state.decisionTrace?.actionPlan?.accepted
      .filter((action) => action.propositionId?.startsWith("t6-"))
      .map((action) => action.propositionId),
    ["t6-inspection", "t6-note"],
  );
  assert.equal(calls.filter((purpose) => purpose === "interpret").length, 3);
  assert.ok(calls.filter((purpose) => purpose === "post_commit").length >= 3);
  assert.ok(calls.filter((purpose) => purpose === "post_commit").length <= 6);
});

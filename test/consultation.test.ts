import assert from "node:assert/strict";
import test from "node:test";
import {
  initialConsultation,
  mergeConfirmedSlots,
  nextConsultationAction,
} from "../src/domain/consultation.js";

test("hỏi bối cảnh công việc trước", () => {
  const action = nextConsultationAction(initialConsultation());
  assert.equal(action.stage, "S1.context");
  assert.match(action.question ?? "", /điều hòa/);
  assert.doesNotMatch(action.question ?? "", /Có hoặc Không là được/);
});

test("lao động ngoài trời được đặt kỳ vọng thực tế", () => {
  const state = mergeConfirmedSlots(initialConsultation(), { workContext: "outdoor_heavy" });
  const action = nextConsultationAction(state);
  assert.equal(action.stage, "S2.symptom");
  assert.match(action.question ?? "", /1\. Ướt hoặc ố áo/);
  assert.doesNotMatch(action.reply, /tuyệt đối|dứt điểm/);
});

test("hướng dẫn phản chiếu đúng vấn đề rồi mới dẫn sang lựa chọn tiếp theo", () => {
  const state = mergeConfirmedSlots(initialConsultation(), {
    workContext: "outdoor_heavy",
    primarySymptom: "sweat",
  });
  const action = nextConsultationAction(state);
  assert.equal(action.stage, "S5.guidance");
  assert.match(action.reply, /mồ hôi làm ướt hoặc ố áo/);
  assert.match(action.reply, /vận động hoặc ở ngoài trời/);
  assert.match(action.question ?? "", /Để mình dễ cân nhắc/);
  assert.match(action.question ?? "", /1 lọ dùng thử/);
});

test("kích ứng đang hoạt động chuyển người thật", () => {
  const state = mergeConfirmedSlots(initialConsultation(), {
    workContext: "both",
    primarySymptom: "both",
    priorProduct: "daily_rollon",
    priorIrritation: true,
    activeIrritation: true,
  });
  const action = nextConsultationAction(state);
  assert.equal(action.stage, "H.handoff");
  assert.equal(action.handoffReason, "safety_red_flag");
});

test("khách muốn giá trước được chuyển S6 và vẫn kéo về tư vấn", () => {
  const state = mergeConfirmedSlots(initialConsultation(), { wantsPriceFirst: true });
  const action = nextConsultationAction(state);
  assert.equal(action.stage, "S6.price");
  assert.match(action.question ?? "", /vận động/);
});

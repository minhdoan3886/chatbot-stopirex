import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyConversationTurn,
  currentConversationFact,
  initialConversationFactLedger,
  reduceConversationFactLedger,
} from "../src/domain/conversationFacts.js";

test("Fact Ledger tách da của khách và em, rồi correction thay fact cũ", () => {
  const first = reduceConversationFactLedger({
    ledger: initialConversationFactLedger(),
    raw: "Da tui nhạy cảm",
    turn: 1,
  });
  const corrected = reduceConversationFactLedger({
    ledger: first.ledger,
    raw: "Nó mới là da nhạy cảm nha, tui da bt thôi",
    turn: 2,
  });

  assert.equal(currentConversationFact(corrected.ledger, "skin_type", "self")?.value, "normal");
  assert.equal(currentConversationFact(corrected.ledger, "skin_type", "sibling-1")?.value, "sensitive");
  assert.equal(corrected.receipt.supersededFactIds.length, 1);
});

test("Fact Ledger gắn phản ứng của bạn và review vào đúng chủ thể", () => {
  const friend = reduceConversationFactLedger({
    ledger: initialConversationFactLedger(),
    raw: "Thằng bạn tui xài Stopirex xong bị ngứa mấy ngày",
    turn: 1,
  });
  const review = reduceConversationFactLedger({
    ledger: friend.ledger,
    raw: "Tui copy review này: ‘xài Stopirex 3 hôm là tui bị ngứa với đỏ da’",
    turn: 2,
  });

  assert.equal(currentConversationFact(review.ledger, "product_reaction", "friend-1")?.value, "itching");
  assert.equal(
    currentConversationFact(review.ledger, "product_reaction", "external-reviewer-1")?.source,
    "copied_review",
  );
  assert.equal(classifyConversationTurn("Thằng bạn tui bị ngứa").currentCustomerStopirexIrritation, false);
  assert.equal(
    classifyConversationTurn("Mình đã dùng Stopirex và hiện đang bị ngứa rát")
      .currentCustomerStopirexIrritation,
    true,
  );
});

test("lịch gym và thời điểm cạo dùng last-evidence-wins nhưng giữ lịch sử", () => {
  const oldSchedule = reduceConversationFactLedger({
    ledger: initialConversationFactLedger(),
    raw: "Tui gym tối 2 4 6",
    turn: 1,
  });
  const newSchedule = reduceConversationFactLedger({
    ledger: oldSchedule.ledger,
    raw: "Lịch đổi rồi nha, giờ tui gym sáng 3 5 7",
    turn: 2,
  });
  const today = reduceConversationFactLedger({
    ledger: newSchedule.ledger,
    raw: "Bữa ni tui mới cạo",
    turn: 3,
  });
  const yesterday = reduceConversationFactLedger({
    ledger: today.ledger,
    raw: "Cái vụ mới cạo là hôm qua nha, nãy tui nói hôm nay nhầm",
    turn: 4,
  });

  assert.equal(currentConversationFact(yesterday.ledger, "exercise_schedule")?.value, "morning|3,5,7");
  assert.equal(currentConversationFact(yesterday.ledger, "hair_removal_time")?.value, "yesterday");
  assert.equal(yesterday.ledger.facts.filter((fact) => fact.status === "superseded").length, 2);
});

test("fact từ OpenAI được chuẩn hóa đóng trước khi có thể che fact deterministic", () => {
  const raw = "ê shop, tui bị mh nách nh dữ lắm á, mùi thì k bao nhiêu mà áo cứ ướt quài";
  const result = reduceConversationFactLedger({
    ledger: initialConversationFactLedger(),
    raw,
    turn: 1,
    semanticFacts: [
      {
        field: "sweat_concern",
        value: "nặng",
        target: "self",
        evidence: ["tui bị mh nách nh dữ lắm á"],
        confidence: 0.95,
      },
      {
        field: "sweat_concern",
        value: "áo_ướt_thường_xuyên",
        target: "self",
        evidence: ["áo cứ ướt quài"],
        confidence: 0.95,
      },
    ],
  });

  assert.equal(currentConversationFact(result.ledger, "sweat_concern")?.value, true);
  assert.equal(
    result.ledger.facts.filter((fact) => fact.status === "current" && fact.predicate === "sweat_concern")
      .length,
    1,
  );
});

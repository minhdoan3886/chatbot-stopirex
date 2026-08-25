import assert from "node:assert/strict";
import test from "node:test";
import { retrieveKnowledgeMatches } from "../src/domain/knowledge.js";
import { stopirexApprovedKnowledge } from "../src/domain/stopirexKnowledge.js";
import { tenantId } from "../src/domain/types.js";
import { buildProductInformationSnapshot } from "../src/services/productInformation.js";

test("tab sản phẩm dùng cùng knowledge và catalog mà chatbot đang sử dụng", () => {
  const snapshot = buildProductInformationSnapshot(tenantId("product-tab-test"));

  assert.equal(snapshot.product.name, "Stopirex");
  assert.equal(snapshot.product.sku, "STOPIREX");
  assert.equal(
    snapshot.product.knowledgeItems,
    stopirexApprovedKnowledge(tenantId("product-tab-test")).length,
  );
  assert.equal(snapshot.offers.length, 5);
  assert.deepEqual(
    snapshot.offers.map((item) => ({
      quantity: item.quantity,
      product: item.productPrice.amount,
      shipping: item.shippingFee.amount,
      total: item.total.amount,
    })),
    [
      { quantity: 1, product: 285_000, shipping: 30_000, total: 315_000 },
      { quantity: 2, product: 510_000, shipping: 0, total: 510_000 },
      { quantity: 3, product: 750_000, shipping: 0, total: 750_000 },
      { quantity: 4, product: 1_000_000, shipping: 0, total: 1_000_000 },
      { quantity: 5, product: 1_250_000, shipping: 0, total: 1_250_000 },
    ],
  );
  assert.equal(
    snapshot.knowledge.find((item) => item.id === "usage-bottle-duration")?.content.includes("3–4 tháng"),
    true,
  );
  assert.equal(
    snapshot.knowledge
      .find((item) => item.id === "usage-exercise-sweat-washoff")
      ?.content.includes("không phải lớp lăn vừa bôi ngay trước khi vận động"),
    true,
  );
  assert.equal(
    snapshot.knowledge
      .find((item) => item.id === "safety-known-aluminum-salt-allergy")
      ?.content.includes("không tiếp tục chốt đơn"),
    true,
  );
  assert.equal(
    snapshot.knowledge
      .find((item) => item.id === "usage-application-feel-clothing")
      ?.content.includes("không làm cứng vải"),
    true,
  );
  assert.equal(
    snapshot.knowledge
      .find((item) => item.id === "usage-morning-wash-with-soap")
      ?.content.includes("không làm mất tác dụng"),
    true,
  );
  assert.equal(
    snapshot.knowledge
      .find((item) => item.id === "usage-timing-missed-evening-application")
      ?.content.includes("không cần bôi bù vào sáng hôm sau"),
    true,
  );
  assert.equal(
    snapshot.knowledge
      .find((item) => item.id === "usage-after-hair-removal")
      ?.content.includes("Chờ 24–48 giờ"),
    true,
  );
  assert.equal(
    snapshot.knowledge
      .find((item) => item.id === "usage-underarm-darkening-prevention")
      ?.content.includes("không gây thâm nách"),
    true,
  );
  assert.equal(
    snapshot.knowledge.some((item) => item.id === "usage-approved-area-underarms-only"),
    true,
  );
  assert.equal(
    snapshot.knowledge.some((item) => item.id === "shelf-life-and-after-opening"),
    true,
  );
  assert.equal(
    snapshot.knowledge
      .find((item) => item.id === "product-composition-tolerance-approved")
      ?.content.includes("Tuyệt đối không tư vấn rằng sản phẩm không cồn"),
    true,
  );
  assert.equal(
    snapshot.knowledge
      .find((item) => item.id === "product-official-ingredient-list-2022")
      ?.content.includes("Aqua, Alcohol, Aluminium Sesquichlorohydrate"),
    true,
  );
  assert.equal(
    snapshot.knowledge
      .find((item) => item.id === "lab-test-2025-skin-irritation")
      ?.content.includes("không đáng kể"),
    true,
  );
  assert.equal(
    snapshot.knowledge
      .find((item) => item.id === "lab-test-2025-microbiology")
      ?.content.includes("Pseudomonas aeruginosa"),
    true,
  );
  assert.equal(
    snapshot.knowledge
      .find((item) => item.id === "product-training-72h-conditional-claim")
      ?.content.includes("kết quả thử nghiệm hiệu quả của Stopirex trên nhóm mẫu thử"),
    true,
  );
  assert.equal(
    snapshot.knowledge.some((item) => item.id === "international-shipping-compensation-handoff"),
    true,
  );
  const onlineOnlyPolicy =
    snapshot.knowledge.find((item) => item.id === "online-only-standard-carrier-policy")?.content ?? "";
  assert.match(onlineOnlyPolicy, /không có cửa hàng offline/iu);
  assert.match(onlineOnlyPolicy, /không có.*ship hỏa tốc/iu);
  assert.match(onlineOnlyPolicy, /đơn vị vận chuyển/iu);
  assert.equal(
    snapshot.knowledge
      .find((item) => item.id === "effectiveness-usage-journey")
      ?.content.includes("tuần đầu"),
    true,
  );
  assert.equal(
    snapshot.knowledge
      .find((item) => item.id === "domestic-delivery-inspection-policy")
      ?.content.includes("không mở seal"),
    true,
  );
  assert.match(
    snapshot.knowledge.find((item) => item.id === "domestic-delivery-inspection-policy")?.content ?? "",
    /cùng tỉnh\/thành phố.*1–2 ngày.*nội miền.*2–3 ngày.*liên miền.*3–5 ngày/isu,
  );
  assert.equal(
    snapshot.knowledge
      .find((item) => item.id === "business-approved-alcohol-odor-guidance-2026-08")
      ?.content.includes("mùi đặc trưng nhẹ và bay nhanh"),
    true,
  );
  assert.equal(
    snapshot.knowledge
      .find((item) => item.id === "promotion-multiuse-bag-from-two")
      ?.content.includes("Mỗi đơn hàng chỉ tặng 1 túi, không phải mỗi lọ một túi"),
    true,
  );
  assert.equal(
    snapshot.blockedClaims.some((item) => item.phrase === "an toàn 100%"),
    true,
  );
  assert.equal(snapshot.customerCare.length, 6);
  assert.deepEqual(
    snapshot.customerCare.map((item) => [item.issue, item.targetMinutes]),
    [
      ["irritation", 15],
      ["ineffective", 60],
      ["missing_or_damaged", 60],
      ["delivery", 60],
      ["counterfeit", 60],
      ["negative_review", 60],
    ],
  );
  assert.equal(snapshot.warrantyAndReturns.status, "approved_with_verification");
  assert.equal(
    snapshot.warrantyAndReturns.humanOnlyDecisions.includes("Thực hiện đổi hàng hoặc hoàn tiền"),
    true,
  );
  assert.equal(snapshot.warrantyAndReturns.sections.length, 5);
  assert.equal(
    snapshot.warrantyAndReturns.sections.some(
      (section) =>
        section.title === "Đã dùng đúng nhưng chưa hiệu quả" &&
        section.items.some((item) => item.includes("đủ 2 tuần")),
    ),
    true,
  );
  assert.equal(snapshot.negativeReviewSteps.length, 6);
});

test("retrieval đưa đúng hồ sơ mới vào các câu hỏi thành phần, kiểm nghiệm và 72 giờ", () => {
  const currentTenant = tenantId("product-doc-retrieval");
  const entities = stopirexApprovedKnowledge(currentTenant);
  const topIds = (query: string) =>
    retrieveKnowledgeMatches({ tenantId: currentTenant, query, entities, limit: 3 }).map(
      (item) => item.entity.id,
    );

  assert.ok(topIds("thành phần Stopirex có cồn không").includes("product-official-ingredient-list-2022"));
  assert.equal(topIds("kiểm nghiệm kích ứng da thế nào")[0], "lab-test-2025-skin-irritation");
  assert.equal(topIds("pH paraben kim loại nặng")[0], "lab-test-2025-physical-chemical");
  assert.equal(topIds("hiệu quả 72 giờ có chắc không")[0], "product-training-72h-conditional-claim");
  assert.ok(topIds("bao lâu thấy khô và duy trì mấy lần").includes("effectiveness-usage-journey"));
  const durationAndOdor = topIds("Một lọ Stopirex dùng được bao lâu và sản phẩm có mùi nồng không?");
  assert.ok(durationAndOdor.includes("usage-bottle-duration"));
  assert.ok(durationAndOdor.includes("business-approved-alcohol-odor-guidance-2026-08"));
  assert.ok(
    topIds("Đà Nẵng mấy ngày nhận và có bóc kiểm hàng không").includes("domestic-delivery-inspection-policy"),
  );
  assert.equal(topIds("mẹ bầu dùng được k e")[0], "audience-pregnancy");
  assert.equal(topIds("phụ nữ đang bầu có dùng dược k")[0], "audience-pregnancy");
});

test("retrieval ưu tiên đúng knowledge hẹp và không để hướng dẫn nội bộ làm nhiễu", () => {
  const currentTenant = tenantId("knowledge-precision");
  const entities = stopirexApprovedKnowledge(currentTenant);
  const topIds = (query: string) =>
    retrieveKnowledgeMatches({ tenantId: currentTenant, query, entities, limit: 3 }).map(
      (item) => item.entity.id,
    );

  assert.equal(topIds("giá bao nhiêu")[0], "pricing-approved-options-2026-08");
  assert.equal(topIds("có cồn không")[0], "business-approved-alcohol-odor-guidance-2026-08");
  assert.equal(topIds("bao lâu thấy hiệu quả")[0], "effectiveness-usage-journey");
  assert.deepEqual(topIds("bao lâu thì thấy hiệu quả"), ["effectiveness-usage-journey"]);
  assert.deepEqual(topIds("mấy hôm thì có tác dụng"), ["effectiveness-usage-journey"]);
  assert.deepEqual(topIds("mồ hôi tay dùng được không"), ["usage-approved-area-underarms-only"]);
  assert.deepEqual(topIds("cách dùng như nào"), ["usage-general"]);
  assert.equal(topIds("bị ngứa đỏ sau khi dùng")[0], "care-suspected-allergic-reaction");

  const skinSafetyAndAuthenticity = retrieveKnowledgeMatches({
    tenantId: currentTenant,
    query: "liệu có an toàn cho da ko e\nhàng giả h nhiều lắm",
    entities,
    limit: 6,
  });
  assert.ok(
    skinSafetyAndAuthenticity.some(
      (item) =>
        item.matchedConcepts.includes("irritation") &&
        ["product-composition-tolerance-approved", "lab-test-2025-skin-irritation"].includes(item.entity.id),
    ),
  );
  assert.ok(
    skinSafetyAndAuthenticity.some(
      (item) =>
        item.entity.id === "authenticity-before-purchase" && item.matchedConcepts.includes("authenticity"),
    ),
  );

  const dialectCompound = retrieveKnowledgeMatches({
    tenantId: currentTenant,
    query:
      "shop uii cho dỏi xí, cái lăn ni xài êm khum dạ? nách tui cơ địa mồ hôi vs thâm lém lun chẩy ướt cả áo ớ. xài cái bôi bôi này áo trắng có bị ố dính dính khôm? giá s zậy mua 2 chây có đc fs zìa sg khum sốp",
    entities,
    limit: 6,
  }).map((item) => item.entity.id);
  assert.ok(dialectCompound.includes("pricing-approved-options-2026-08"));
  assert.ok(dialectCompound.includes("usage-underarm-darkening-prevention"));
  assert.ok(dialectCompound.includes("usage-application-feel-clothing"));
  assert.ok(dialectCompound.includes("effectiveness-usage-journey"));

  const dialectUsageRefund = retrieveKnowledgeMatches({
    tenantId: currentTenant,
    query:
      "alo shop ấy, họa m thấy qc trên tóp top. lọ số tốp pi réch này xài tnao đấy? bôi xong có bị bết k nhỉ? mk bị hôi nách nặng từ hồi c3 rồ, dùng bh loại k khỏi. nếu mức 1 c mà k đỡ có dc hoàn xèng k. t ship về tp thái bình",
    entities,
    limit: 6,
  }).map((item) => item.entity.id);
  assert.ok(dialectUsageRefund.includes("usage-general"));
  assert.ok(dialectUsageRefund.includes("usage-application-feel-clothing"));
  assert.ok(dialectUsageRefund.includes("care-ineffective-refund"));
  assert.ok(dialectUsageRefund.includes("refund-used-ineffective"));
  assert.ok(dialectUsageRefund.includes("pricing-approved-options-2026-08"));

  const pricing = entities.find((item) => item.id === "pricing-approved-options-2026-08");
  assert.ok(pricing?.responseGuidance?.includes("chỉ báo phương án 1–3 lọ"));
  assert.equal(pricing?.content.includes("Khi khách hỏi giá chung"), false);
  assert.equal(
    entities
      .find((item) => item.id === "product-training-72h-conditional-claim")
      ?.content.includes("bao lâu thấy hiệu quả"),
    false,
  );
});

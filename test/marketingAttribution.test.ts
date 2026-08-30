import assert from "node:assert/strict";
import test from "node:test";
import {
  marketingSourceCategory,
  marketingCustomerStage,
  referralAdTitle,
  referralPostId,
  shouldRecordMarketingTouch,
} from "../src/domain/marketingAttribution.js";

test("phân loại traffic quảng cáo, referral và organic độc lập với khách mới/quay lại", () => {
  assert.equal(marketingSourceCategory(undefined), "organic");
  assert.equal(
    marketingSourceCategory({
      source: "ADS",
      adId: "120001",
      adsContextData: {},
      raw: {},
    }),
    "paid_ad",
  );
  assert.equal(
    marketingSourceCategory({
      source: "SHORTLINK",
      ref: "summer-campaign",
      adsContextData: {},
      raw: {},
    }),
    "referral",
  );
});

test("xác định khách mới/quay lại bằng lịch sử và không đếm nhiều tin trong cùng 24 giờ", () => {
  assert.equal(marketingCustomerStage({ hadPriorInbound: false, hadPriorTouch: false }), "new");
  assert.equal(marketingCustomerStage({ hadPriorInbound: true, hadPriorTouch: false }), "returning");
  const lastActivityAt = new Date("2026-08-01T00:00:00.000Z");
  assert.equal(
    shouldRecordMarketingTouch({
      occurredAt: new Date("2026-08-01T01:00:00.000Z"),
      lastActivityAt,
      hasReferral: false,
    }),
    false,
  );
  assert.equal(
    shouldRecordMarketingTouch({
      occurredAt: new Date("2026-08-02T00:00:00.000Z"),
      lastActivityAt,
      hasReferral: false,
    }),
    true,
  );
  assert.equal(
    shouldRecordMarketingTouch({
      occurredAt: new Date("2026-08-01T01:00:00.000Z"),
      lastActivityAt,
      hasReferral: true,
    }),
    true,
  );
});

test("đọc metadata quảng cáo dùng cho dashboard nhưng giới hạn độ dài", () => {
  const referral = {
    adsContextData: {
      ad_title: "Stopirex kiểm soát mồ hôi",
      post_id: "page_post_123",
    },
    raw: {},
  };
  assert.equal(referralAdTitle(referral), "Stopirex kiểm soát mồ hôi");
  assert.equal(referralPostId(referral), "page_post_123");
});

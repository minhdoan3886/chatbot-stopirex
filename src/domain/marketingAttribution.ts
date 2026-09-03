export type MarketingSourceCategory = "paid_ad" | "organic" | "referral" | "unknown";
export type MarketingCustomerStage = "new" | "returning";

export type MetaReferralAttribution = {
  source?: string;
  type?: string;
  ref?: string;
  adId?: string;
  adsContextData: Record<string, unknown>;
  raw: Record<string, unknown>;
};

export function marketingSourceCategory(
  referral: MetaReferralAttribution | undefined,
): MarketingSourceCategory {
  if (referral?.adId || referral?.source?.toUpperCase() === "ADS") return "paid_ad";
  if (referral) return "referral";
  return "organic";
}

export function marketingCustomerStage(input: {
  hadPriorInbound: boolean;
  hadPriorTouch: boolean;
}): MarketingCustomerStage {
  return input.hadPriorInbound || input.hadPriorTouch ? "returning" : "new";
}

export function shouldRecordMarketingTouch(input: {
  occurredAt: Date;
  lastActivityAt?: Date;
  hasReferral: boolean;
  sessionGapHours?: number;
}): boolean {
  if (input.hasReferral || !input.lastActivityAt) return true;
  const sessionGapMs = Math.max(1, input.sessionGapHours ?? 24) * 60 * 60 * 1000;
  return input.occurredAt.getTime() - input.lastActivityAt.getTime() >= sessionGapMs;
}

export function referralAdTitle(referral: MetaReferralAttribution | undefined): string | undefined {
  return boundedString(referral?.adsContextData.ad_title, 300);
}

export function referralPostId(referral: MetaReferralAttribution | undefined): string | undefined {
  return boundedString(referral?.adsContextData.post_id, 200);
}

function boundedString(value: unknown, limit: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, limit) : undefined;
}

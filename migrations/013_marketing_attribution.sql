BEGIN;

-- Một touch tương ứng với lần khách bắt đầu/khởi động lại cuộc trò chuyện,
-- không phải từng tin nhắn. Referral từ quảng cáo luôn được giữ lại để không
-- mất ad_id ngay cả khi khách đã từng nhắn Page trước đó.
CREATE TABLE IF NOT EXISTS marketing_attribution_touches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  page_id UUID NOT NULL REFERENCES pages(id),
  customer_id UUID NOT NULL REFERENCES customers(id),
  conversation_id UUID NOT NULL REFERENCES conversations(id),
  external_event_id TEXT NOT NULL,
  source_category TEXT NOT NULL
    CHECK (source_category IN ('paid_ad', 'organic', 'referral', 'unknown')),
  customer_stage TEXT NOT NULL
    CHECK (customer_stage IN ('new', 'returning')),
  referral_source TEXT,
  referral_type TEXT,
  referral_ref TEXT,
  ad_id TEXT,
  ad_title TEXT,
  post_id TEXT,
  ads_context_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  raw_referral JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (page_id, external_event_id),
  CHECK (jsonb_typeof(ads_context_data) = 'object'),
  CHECK (jsonb_typeof(raw_referral) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_marketing_attribution_period
  ON marketing_attribution_touches (occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_marketing_attribution_source
  ON marketing_attribution_touches (page_id, source_category, customer_stage, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_marketing_attribution_ad
  ON marketing_attribution_touches (page_id, ad_id, occurred_at DESC)
  WHERE ad_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_marketing_attribution_customer
  ON marketing_attribution_touches (customer_id, occurred_at DESC);

ALTER TABLE marketing_attribution_touches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_marketing_attribution_touches
  ON marketing_attribution_touches;
CREATE POLICY tenant_isolation_marketing_attribution_touches
  ON marketing_attribution_touches
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

COMMIT;

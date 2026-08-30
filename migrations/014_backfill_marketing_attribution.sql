BEGIN;

-- Các webhook cũ đã giữ raw payload trong inbound_events. Backfill riêng các
-- referral có giá trị marketing; organic session cũ không được suy diễn để
-- tránh tạo số liệu giả.
WITH referral_events AS (
  SELECT
    ie.tenant_id,
    ie.page_id,
    ie.external_event_id,
    ie.received_at,
    ie.payload,
    ie.payload->'sender'->>'id' AS external_customer_id,
    coalesce(
      ie.payload->'referral',
      ie.payload->'message'->'referral',
      ie.payload->'postback'->'referral'
    ) AS referral
  FROM inbound_events ie
  WHERE jsonb_typeof(
    coalesce(
      ie.payload->'referral',
      ie.payload->'message'->'referral',
      ie.payload->'postback'->'referral'
    )
  ) = 'object'
), normalized AS (
  SELECT
    r.*,
    c.id AS customer_id,
    conversation.id AS conversation_id,
    CASE
      WHEN upper(coalesce(r.referral->>'source', '')) = 'ADS'
        OR nullif(r.referral->>'ad_id', '') IS NOT NULL
        THEN 'paid_ad'
      ELSE 'referral'
    END AS source_category,
    CASE
      WHEN EXISTS (
        SELECT 1
        FROM inbound_events earlier
        WHERE earlier.tenant_id = r.tenant_id
          AND earlier.page_id = r.page_id
          AND earlier.payload->'sender'->>'id' = r.external_customer_id
          AND earlier.received_at < r.received_at
      ) THEN 'returning'
      ELSE 'new'
    END AS customer_stage
  FROM referral_events r
  JOIN customers c
    ON c.page_id = r.page_id
   AND c.external_customer_id = r.external_customer_id
  JOIN LATERAL (
    SELECT id
    FROM conversations
    WHERE customer_id = c.id
    ORDER BY updated_at DESC
    LIMIT 1
  ) conversation ON true
)
INSERT INTO marketing_attribution_touches (
  tenant_id, page_id, customer_id, conversation_id, external_event_id,
  source_category, customer_stage, referral_source, referral_type,
  referral_ref, ad_id, ad_title, post_id, ads_context_data,
  raw_referral, occurred_at
)
SELECT
  tenant_id,
  page_id,
  customer_id,
  conversation_id,
  external_event_id,
  source_category,
  customer_stage,
  nullif(referral->>'source', ''),
  nullif(referral->>'type', ''),
  nullif(referral->>'ref', ''),
  nullif(referral->>'ad_id', ''),
  nullif(referral->'ads_context_data'->>'ad_title', ''),
  nullif(referral->'ads_context_data'->>'post_id', ''),
  CASE
    WHEN jsonb_typeof(referral->'ads_context_data') = 'object'
      THEN referral->'ads_context_data'
    ELSE '{}'::jsonb
  END,
  referral,
  received_at
FROM normalized
ON CONFLICT (page_id, external_event_id) DO NOTHING;

COMMIT;

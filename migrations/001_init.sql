BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  channel text NOT NULL CHECK (channel IN ('facebook', 'shopee', 'tiktok')),
  external_page_id text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (channel, external_page_id)
);

CREATE TABLE customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  page_id uuid NOT NULL REFERENCES pages(id),
  external_customer_id text NOT NULL,
  display_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (page_id, external_customer_id)
);

CREATE TABLE conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  page_id uuid NOT NULL REFERENCES pages(id),
  customer_id uuid NOT NULL REFERENCES customers(id),
  state_version bigint NOT NULL DEFAULT 0,
  consultation_stage text NOT NULL DEFAULT 'S0.new',
  pipeline_tag text NOT NULL DEFAULT '0.Chưa tư vấn',
  signal_tag text,
  human_status text NOT NULL DEFAULT 'bot' CHECK (human_status IN ('bot', 'human', 'paused')),
  slots jsonb NOT NULL DEFAULT '{}'::jsonb,
  summary text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (char_length(pipeline_tag) <= 14),
  CHECK (signal_tag IS NULL OR char_length(signal_tag) <= 14)
);

CREATE TABLE inbound_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  page_id uuid NOT NULL REFERENCES pages(id),
  external_event_id text NOT NULL,
  payload jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  UNIQUE (page_id, external_event_id)
);

CREATE TABLE messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  page_id uuid NOT NULL REFERENCES pages(id),
  conversation_id uuid NOT NULL REFERENCES conversations(id),
  external_message_id text,
  direction text NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  kind text NOT NULL CHECK (kind IN ('text', 'image', 'postback', 'system')),
  text_content text,
  raw_payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (page_id, external_message_id)
);

CREATE TABLE customer_facts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  page_id uuid NOT NULL REFERENCES pages(id),
  customer_id uuid NOT NULL REFERENCES customers(id),
  fact_key text NOT NULL,
  fact_value jsonb NOT NULL,
  fact_type text NOT NULL CHECK (fact_type IN ('verified', 'observed', 'derived', 'authoritative')),
  provenance jsonb NOT NULL,
  confidence numeric(5,4),
  expires_at timestamptz,
  superseded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE product_prices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  channel text NOT NULL CHECK (channel IN ('facebook', 'shopee', 'tiktok')),
  sku text NOT NULL,
  quantity integer NOT NULL CHECK (quantity > 0),
  product_price_vnd bigint NOT NULL CHECK (product_price_vnd > 0),
  shipping_fee_vnd bigint NOT NULL CHECK (shipping_fee_vnd >= 0),
  status text NOT NULL CHECK (status IN ('draft', 'active', 'archived')),
  effective_from timestamptz NOT NULL,
  effective_to timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (effective_to IS NULL OR effective_to > effective_from)
);

CREATE TABLE claim_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  phrase text NOT NULL,
  status text NOT NULL CHECK (status IN ('approved', 'blocked', 'pending')),
  replacement text,
  evidence jsonb,
  effective_from timestamptz NOT NULL,
  effective_to timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE media_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  asset_type text NOT NULL,
  url text NOT NULL,
  checksum text NOT NULL,
  approved_caption text NOT NULL,
  version integer NOT NULL,
  active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, asset_type, version)
);

CREATE TABLE followup_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  page_id uuid NOT NULL REFERENCES pages(id),
  conversation_id uuid NOT NULL REFERENCES conversations(id),
  stage text NOT NULL CHECK (stage IN ('3h', '6h', '9h')),
  due_at timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('scheduled', 'claimed', 'sent', 'cancelled')),
  idempotency_key text NOT NULL UNIQUE,
  cancel_reason text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  page_id uuid NOT NULL REFERENCES pages(id),
  conversation_id uuid NOT NULL REFERENCES conversations(id),
  customer_id uuid NOT NULL REFERENCES customers(id),
  draft jsonb NOT NULL,
  customer_confirmed_at timestamptz,
  status text NOT NULL CHECK (status IN ('draft', 'confirmed', 'creating', 'created', 'failed', 'cancelled')),
  pancake_order_id text,
  sapo_order_id text,
  idempotency_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE experiment_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  page_id uuid NOT NULL REFERENCES pages(id),
  customer_id uuid NOT NULL REFERENCES customers(id),
  experiment_id text NOT NULL,
  variant_id text NOT NULL,
  exposed_at timestamptz,
  converted_order_id uuid REFERENCES orders(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, page_id, customer_id, experiment_id)
);

CREATE TABLE audit_log (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  page_id uuid REFERENCES pages(id),
  trace_id text NOT NULL,
  actor_type text NOT NULL,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  topic text NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'sent', 'failed')),
  available_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_inbound_events_pending ON inbound_events (received_at) WHERE processed_at IS NULL;
CREATE INDEX idx_messages_conversation_time ON messages (conversation_id, created_at);
CREATE INDEX idx_facts_customer_active ON customer_facts (customer_id, fact_key) WHERE superseded_at IS NULL;
CREATE INDEX idx_prices_lookup ON product_prices (tenant_id, channel, sku, quantity, effective_from) WHERE status = 'active';
CREATE INDEX idx_followup_due ON followup_jobs (due_at) WHERE status = 'scheduled';
CREATE INDEX idx_outbox_pending ON outbox (available_at) WHERE status = 'pending';

ALTER TABLE pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE inbound_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_facts ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE claim_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE media_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE followup_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE experiment_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE outbox ENABLE ROW LEVEL SECURITY;

-- Application sets SET LOCAL app.tenant_id = '<uuid>' inside each transaction.
CREATE POLICY tenant_isolation_pages ON pages USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_customers ON customers USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_conversations ON conversations USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_inbound_events ON inbound_events USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_messages ON messages USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_customer_facts ON customer_facts USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_product_prices ON product_prices USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_claim_rules ON claim_rules USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_media_assets ON media_assets USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_followup_jobs ON followup_jobs USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_orders ON orders USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_experiment_assignments ON experiment_assignments USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_audit_log ON audit_log USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_outbox ON outbox USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

COMMIT;

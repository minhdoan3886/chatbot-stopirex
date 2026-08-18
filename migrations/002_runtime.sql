BEGIN;

CREATE TABLE knowledge_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id),
  version integer NOT NULL, checksum text NOT NULL, status text NOT NULL CHECK (status IN ('draft','active','archived')),
  source_filename text NOT NULL, published_by text, published_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, version)
);
CREATE UNIQUE INDEX one_active_knowledge_version ON knowledge_versions (tenant_id) WHERE status = 'active';

CREATE TABLE knowledge_entities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id),
  version_id uuid NOT NULL REFERENCES knowledge_versions(id), entity_type text NOT NULL,
  title text NOT NULL, content text NOT NULL, source_row integer, embedding jsonb, created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE call_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), page_id uuid NOT NULL REFERENCES pages(id),
  conversation_id uuid NOT NULL REFERENCES conversations(id), issue_type text NOT NULL, owner text, due_at timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('open','submitted','calling','resolved','failed')),
  omicall_call_id text, result jsonb, idempotency_key text NOT NULL UNIQUE, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE order_status_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), order_id uuid NOT NULL REFERENCES orders(id),
  provider text NOT NULL, external_event_id text NOT NULL, status text NOT NULL, payload jsonb NOT NULL,
  occurred_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (provider, external_event_id)
);

CREATE TABLE funnel_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), page_id uuid NOT NULL REFERENCES pages(id),
  customer_id uuid NOT NULL REFERENCES customers(id), conversation_id uuid REFERENCES conversations(id),
  event_name text NOT NULL, experiment_id text, variant_id text, order_id uuid REFERENCES orders(id),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb, occurred_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE admin_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), email text NOT NULL,
  role text NOT NULL CHECK (role IN ('editor','approver','operator')), active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (tenant_id, email)
);

CREATE INDEX idx_call_requests_due ON call_requests (due_at) WHERE status IN ('open','submitted');
CREATE INDEX idx_funnel_events_time ON funnel_events (tenant_id, occurred_at);
CREATE INDEX idx_knowledge_entity_lookup ON knowledge_entities (tenant_id, version_id, entity_type);

ALTER TABLE knowledge_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE call_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_status_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE funnel_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_users ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_knowledge_versions ON knowledge_versions USING (tenant_id = current_setting('app.tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_knowledge_entities ON knowledge_entities USING (tenant_id = current_setting('app.tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_call_requests ON call_requests USING (tenant_id = current_setting('app.tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_order_status_events ON order_status_events USING (tenant_id = current_setting('app.tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_funnel_events ON funnel_events USING (tenant_id = current_setting('app.tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_admin_users ON admin_users USING (tenant_id = current_setting('app.tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

COMMIT;

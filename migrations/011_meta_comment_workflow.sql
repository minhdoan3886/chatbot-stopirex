BEGIN;

CREATE TABLE IF NOT EXISTS meta_comment_workflows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  page_id uuid NOT NULL REFERENCES pages(id),
  conversation_id uuid REFERENCES conversations(id),
  external_comment_id text NOT NULL,
  external_post_id text,
  external_customer_id text NOT NULL,
  comment_text text NOT NULL,
  intent text,
  category text NOT NULL DEFAULT 'other'
    CHECK (category IN ('price', 'consultation', 'complaint', 'positive', 'other')),
  priority text NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('normal', 'urgent')),
  status text NOT NULL DEFAULT 'received'
    CHECK (status IN ('received', 'processing', 'replied', 'partial', 'failed', 'paused')),
  public_reply_text text,
  private_reply_text text,
  public_message_id text,
  private_message_id text,
  public_sent_at timestamptz,
  private_sent_at timestamptz,
  error_code text,
  received_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (page_id, external_comment_id)
);

CREATE INDEX IF NOT EXISTS idx_meta_comment_workflows_recent
  ON meta_comment_workflows (received_at DESC);

CREATE INDEX IF NOT EXISTS idx_meta_comment_workflows_status
  ON meta_comment_workflows (status, priority, updated_at DESC);

ALTER TABLE meta_comment_workflows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_meta_comment_workflows ON meta_comment_workflows;
CREATE POLICY tenant_isolation_meta_comment_workflows ON meta_comment_workflows
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

COMMIT;

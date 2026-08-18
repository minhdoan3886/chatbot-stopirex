BEGIN;

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS runtime_state jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_conversations_external_runtime
  ON conversations (page_id, customer_id, updated_at DESC);

COMMIT;

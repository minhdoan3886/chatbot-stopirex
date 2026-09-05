BEGIN;

ALTER TABLE meta_comment_workflows
  ADD COLUMN IF NOT EXISTS moderation_recommendation text NOT NULL DEFAULT 'keep'
    CHECK (moderation_recommendation IN ('keep', 'review', 'hide')),
  ADD COLUMN IF NOT EXISTS moderation_reason text,
  ADD COLUMN IF NOT EXISTS is_hidden boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS hidden_at timestamptz,
  ADD COLUMN IF NOT EXISTS moderation_updated_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_meta_comment_workflows_moderation
  ON meta_comment_workflows (is_hidden, moderation_recommendation, received_at DESC);

COMMIT;

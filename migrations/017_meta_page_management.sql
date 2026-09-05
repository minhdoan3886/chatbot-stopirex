BEGIN;

ALTER TABLE pages
  ADD COLUMN IF NOT EXISTS display_name text,
  ADD COLUMN IF NOT EXISTS access_token_encrypted text,
  ADD COLUMN IF NOT EXISTS token_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

UPDATE pages
SET display_name = COALESCE(display_name, 'Facebook Page ' || right(external_page_id, 6)),
    updated_at = COALESCE(updated_at, created_at)
WHERE channel = 'facebook';

CREATE INDEX IF NOT EXISTS idx_pages_facebook_management
  ON pages (channel, active, updated_at DESC)
  WHERE channel = 'facebook';

COMMIT;

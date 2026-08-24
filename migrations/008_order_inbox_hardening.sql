-- Bổ sung idempotency cho các môi trường đã chạy migration 007 cũ.
ALTER TABLE order_inbox ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

UPDATE order_inbox
SET idempotency_key = 'legacy:' || id::text
WHERE idempotency_key IS NULL;

ALTER TABLE order_inbox ALTER COLUMN idempotency_key SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS order_inbox_idempotency_idx
  ON order_inbox (session_id, idempotency_key);

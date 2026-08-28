-- Chỉ gửi mã vận đơn cho khách sau khi nhân viên nhập mã thật trên trang Đơn hàng.
ALTER TABLE order_inbox ADD COLUMN IF NOT EXISTS tracking_carrier TEXT;
ALTER TABLE order_inbox ADD COLUMN IF NOT EXISTS tracking_number TEXT;
ALTER TABLE order_inbox ADD COLUMN IF NOT EXISTS tracking_url TEXT;
ALTER TABLE order_inbox ADD COLUMN IF NOT EXISTS tracking_send_status TEXT NOT NULL DEFAULT 'not_sent';
ALTER TABLE order_inbox ADD COLUMN IF NOT EXISTS tracking_message_id TEXT;
ALTER TABLE order_inbox ADD COLUMN IF NOT EXISTS tracking_sent_at TIMESTAMPTZ;
ALTER TABLE order_inbox ADD COLUMN IF NOT EXISTS tracking_last_error TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'order_inbox_tracking_send_status_check'
  ) THEN
    ALTER TABLE order_inbox
      ADD CONSTRAINT order_inbox_tracking_send_status_check
      CHECK (tracking_send_status IN ('not_sent', 'sending', 'sent', 'failed'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS order_inbox_tracking_send_idx
  ON order_inbox (tracking_send_status, confirmed_at DESC);

-- 007_order_inbox.sql
-- Bảng hứng đơn từ chatbot: khi khách xác nhận ĐỒNG Ý, đơn được ghi vào đây
-- để sale xem và tự lên Sapo.

CREATE TABLE IF NOT EXISTS order_inbox (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      TEXT NOT NULL,                  -- conversation session từ chatbot
  channel         TEXT NOT NULL DEFAULT 'meta',   -- kênh (meta, demo…)

  -- Thông tin khách hàng
  recipient_name  TEXT,
  phone           TEXT,
  legacy_address  TEXT,
  delivery_note   TEXT,

  -- Thông tin đơn hàng
  sku             TEXT,
  quantity        INTEGER,
  total_vnd       BIGINT,
  payment_method  TEXT,                           -- 'cod' | 'bank_transfer'

  -- Trạng thái xử lý
  status          TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'completed' | 'cancelled'
  note            TEXT,                           -- ghi chú nội bộ của sale

  -- Mốc thời gian
  confirmed_at    TIMESTAMPTZ NOT NULL,           -- thời điểm khách bấm ĐỒNG Ý
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS order_inbox_status_idx       ON order_inbox (status, confirmed_at DESC);
CREATE INDEX IF NOT EXISTS order_inbox_session_idx      ON order_inbox (session_id);
CREATE INDEX IF NOT EXISTS order_inbox_created_at_idx   ON order_inbox (created_at DESC);

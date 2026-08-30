BEGIN;

-- Lưu dấu vết khách yêu cầu thay đổi đơn. Mỗi phần tử gồm nguyên văn tin nhắn,
-- trường đã đổi và ảnh chụp dữ liệu trước/sau. Chỉ order_inbox service được
-- phép nối thêm lịch sử khi đơn chưa có mã vận đơn.
ALTER TABLE order_inbox
  ADD COLUMN IF NOT EXISTS change_history JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE order_inbox DROP CONSTRAINT IF EXISTS order_inbox_change_history_array_check;
ALTER TABLE order_inbox
  ADD CONSTRAINT order_inbox_change_history_array_check
  CHECK (jsonb_typeof(change_history) = 'array');

COMMIT;

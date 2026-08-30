BEGIN;

-- Đóng băng ngữ cảnh tại thời điểm gửi báo giá để từng nhịp follow-up
-- tiếp tục đúng nhu cầu đang dang dở, không phụ thuộc vào văn mẫu chung.
ALTER TABLE followup_cycles
  ADD COLUMN IF NOT EXISTS context_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE followup_cycles DROP CONSTRAINT IF EXISTS followup_cycles_context_object_check;
ALTER TABLE followup_cycles
  ADD CONSTRAINT followup_cycles_context_object_check
  CHECK (jsonb_typeof(context_snapshot) = 'object');

COMMIT;

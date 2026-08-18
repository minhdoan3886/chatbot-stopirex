BEGIN;

CREATE TABLE IF NOT EXISTS followup_cycles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  page_id uuid NOT NULL REFERENCES pages(id),
  conversation_id uuid NOT NULL REFERENCES conversations(id),
  anchor_outbound_message_id text NOT NULL,
  anchor_sent_at timestamptz NOT NULL,
  state_version bigint NOT NULL,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'completed', 'cancelled')),
  cancel_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (conversation_id, anchor_outbound_message_id)
);

ALTER TABLE followup_jobs
  ADD COLUMN IF NOT EXISTS cycle_id uuid REFERENCES followup_cycles(id),
  ADD COLUMN IF NOT EXISTS state_version bigint,
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_error_code text,
  ADD COLUMN IF NOT EXISTS last_error_message text,
  ADD COLUMN IF NOT EXISTS meta_message_id text;

ALTER TABLE followup_jobs DROP CONSTRAINT IF EXISTS followup_jobs_status_check;
ALTER TABLE followup_jobs
  ADD CONSTRAINT followup_jobs_status_check
  CHECK (status IN ('scheduled', 'claimed', 'sent', 'cancelled', 'failed', 'shadowed', 'delivery_unknown'));

CREATE UNIQUE INDEX IF NOT EXISTS idx_followup_cycle_stage
  ON followup_jobs (cycle_id, stage)
  WHERE cycle_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_followup_cycles_active
  ON followup_cycles (conversation_id, anchor_sent_at DESC)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_followup_claimed_stale
  ON followup_jobs (claimed_at)
  WHERE status = 'claimed';

ALTER TABLE followup_cycles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_followup_cycles ON followup_cycles;
CREATE POLICY tenant_isolation_followup_cycles ON followup_cycles
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

COMMIT;

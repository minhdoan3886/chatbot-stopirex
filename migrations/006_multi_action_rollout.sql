BEGIN;

CREATE TABLE action_rollout_events (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  page_id uuid NOT NULL REFERENCES pages(id),
  conversation_id uuid REFERENCES conversations(id),
  trace_id text,
  session_key text NOT NULL,
  rollout_mode text NOT NULL CHECK (rollout_mode IN ('shadow', 'canary', 'enabled')),
  live_variant text NOT NULL CHECK (live_variant IN ('legacy', 'multi_action')),
  intent_mismatch boolean NOT NULL DEFAULT false,
  pipeline_mismatch boolean NOT NULL DEFAULT false,
  handoff_mismatch boolean NOT NULL DEFAULT false,
  clarification_mismatch boolean NOT NULL DEFAULT false,
  reply_mismatch boolean NOT NULL DEFAULT false,
  rejected_action_count integer NOT NULL DEFAULT 0 CHECK (rejected_action_count >= 0),
  conflict_count integer NOT NULL DEFAULT 0 CHECK (conflict_count >= 0),
  candidate_has_multiple_actions boolean NOT NULL DEFAULT false,
  candidate_needs_clarification boolean NOT NULL DEFAULT false,
  comparison jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_action_rollout_events_time
  ON action_rollout_events (created_at DESC);
CREATE INDEX idx_action_rollout_events_page_time
  ON action_rollout_events (page_id, created_at DESC);

ALTER TABLE action_rollout_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_action_rollout_events
  ON action_rollout_events
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

COMMIT;

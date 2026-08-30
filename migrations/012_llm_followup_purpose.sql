BEGIN;

ALTER TABLE llm_usage_events DROP CONSTRAINT IF EXISTS llm_usage_events_purpose_check;
ALTER TABLE llm_usage_events
  ADD CONSTRAINT llm_usage_events_purpose_check
  CHECK (purpose IN ('interpret', 'enhance', 'opening', 'followup'));

COMMIT;

BEGIN;

CREATE TABLE llm_usage_events (
  id bigserial PRIMARY KEY,
  occurred_at timestamptz NOT NULL,
  provider text NOT NULL CHECK (provider IN ('openai', 'codex')),
  model text NOT NULL,
  purpose text NOT NULL CHECK (purpose IN ('interpret', 'enhance', 'opening')),
  status text NOT NULL CHECK (status IN ('success', 'failure')),
  response_id text,
  input_tokens bigint NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  cached_input_tokens bigint NOT NULL DEFAULT 0 CHECK (cached_input_tokens >= 0),
  output_tokens bigint NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  reasoning_output_tokens bigint NOT NULL DEFAULT 0 CHECK (reasoning_output_tokens >= 0),
  total_tokens bigint NOT NULL DEFAULT 0 CHECK (total_tokens >= 0),
  latency_ms integer NOT NULL CHECK (latency_ms >= 0),
  pricing_effective_at date,
  input_rate_usd_per_million numeric(14,6),
  cached_input_rate_usd_per_million numeric(14,6),
  output_rate_usd_per_million numeric(14,6),
  input_cost_usd numeric(20,12),
  cached_input_cost_usd numeric(20,12),
  output_cost_usd numeric(20,12),
  total_cost_usd numeric(20,12),
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (cached_input_tokens <= input_tokens),
  CHECK (
    (status = 'success' AND error_code IS NULL)
    OR (status = 'failure' AND error_code IS NOT NULL)
  )
);

CREATE UNIQUE INDEX idx_llm_usage_response_id
  ON llm_usage_events (response_id)
  WHERE response_id IS NOT NULL;

CREATE INDEX idx_llm_usage_occurred_at
  ON llm_usage_events (occurred_at DESC);

CREATE INDEX idx_llm_usage_model_time
  ON llm_usage_events (provider, model, occurred_at DESC);

COMMIT;

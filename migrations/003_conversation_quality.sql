BEGIN;

CREATE TABLE care_cases (
  id text PRIMARY KEY,
  issue_type text NOT NULL,
  priority text NOT NULL CHECK (priority IN ('normal','urgent')),
  owner text NOT NULL,
  due_at timestamptz NOT NULL,
  bot_paused boolean NOT NULL DEFAULT false,
  facts jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL CHECK (status IN ('open','waiting_customer','human_working','followup','resolved')),
  acknowledged_at timestamptz NOT NULL,
  resolution_summary text,
  closed_at timestamptz,
  updates jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE INDEX idx_care_cases_owner_due
  ON care_cases (owner, due_at)
  WHERE status IN ('open','waiting_customer','human_working','followup');

ALTER TABLE product_prices
  ADD COLUMN IF NOT EXISTS offer_version text,
  ADD COLUMN IF NOT EXISTS approved_by text,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz;

CREATE TABLE shipment_tracking (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id),
  carrier text NOT NULL,
  tracking_number text NOT NULL,
  tracking_url text NOT NULL,
  eta_at timestamptz,
  status text NOT NULL,
  provider_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (carrier, tracking_number)
);

COMMIT;

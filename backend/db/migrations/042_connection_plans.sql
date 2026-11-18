CREATE TABLE IF NOT EXISTS connection_plans (
  id SERIAL PRIMARY KEY,
  match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_plan_id UUID NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('call', 'meetup')),
  proposer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  proposed_at TIMESTAMPTZ NOT NULL,
  agreed_at TIMESTAMPTZ CHECK (agreed_at = proposed_at),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (match_id, created_by, client_plan_id)
);

CREATE INDEX IF NOT EXISTS connection_plans_timeline_idx ON connection_plans(match_id, created_at, id);

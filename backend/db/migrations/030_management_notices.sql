CREATE TABLE IF NOT EXISTS management_notices (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  reason TEXT NOT NULL,
  effective_until TIMESTAMPTZ,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS management_notices_inbox ON management_notices (user_id, id DESC);
CREATE INDEX IF NOT EXISTS management_notices_unread ON management_notices (user_id) WHERE read_at IS NULL;

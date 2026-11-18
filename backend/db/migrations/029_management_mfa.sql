CREATE TABLE IF NOT EXISTS auth_attempt_limits (
  bucket TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS auth_attempt_limits_expiry ON auth_attempt_limits(expires_at);

CREATE TABLE IF NOT EXISTS management_mfa (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  encrypted_secret TEXT NOT NULL,
  pending_until TIMESTAMPTZ NOT NULL,
  enabled_at TIMESTAMPTZ,
  last_counter BIGINT
);

CREATE TABLE IF NOT EXISTS account_sessions (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  auth_version INTEGER NOT NULL,
  device_label TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  PRIMARY KEY (user_id, session_id)
);

CREATE INDEX IF NOT EXISTS account_sessions_user_version
  ON account_sessions (user_id, auth_version, created_at DESC) WHERE revoked_at IS NULL;

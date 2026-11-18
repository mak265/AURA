CREATE TABLE IF NOT EXISTS meet_sessions (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 80),
  mode TEXT NOT NULL CHECK (mode IN ('chat', 'call')),
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL CHECK (ends_at > starts_at),
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  cancelled_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS meet_sessions_active_idx
  ON meet_sessions (starts_at, ends_at) WHERE cancelled_at IS NULL;

CREATE TABLE IF NOT EXISTS meet_session_reminders (
  session_id INTEGER NOT NULL REFERENCES meet_sessions(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  notified_at TIMESTAMPTZ,
  read_at TIMESTAMPTZ,
  PRIMARY KEY (session_id, user_id)
);

CREATE INDEX IF NOT EXISTS meet_session_reminders_pending_idx
  ON meet_session_reminders (session_id, user_id) WHERE notified_at IS NULL;

CREATE INDEX IF NOT EXISTS meet_session_reminders_activity_idx
  ON meet_session_reminders (user_id, notified_at DESC) WHERE notified_at IS NOT NULL;

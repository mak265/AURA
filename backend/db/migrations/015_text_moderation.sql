CREATE TABLE IF NOT EXISTS moderation_state (
 user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 window_started_at TIMESTAMPTZ,
 violations INTEGER NOT NULL DEFAULT 0,
 restricted_until TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS app_activity_reads (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('aura', 'glimpse-reply', 'lounge-invite', 'meet-session')),
  source_id INTEGER NOT NULL,
  read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, source, source_id)
);

CREATE TABLE IF NOT EXISTS glimpse_replies (
  id SERIAL PRIMARY KEY,
  glimpse_id INTEGER NOT NULL REFERENCES glimpses(id) ON DELETE CASCADE,
  sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body VARCHAR(300) NOT NULL CHECK (length(trim(body)) > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS glimpse_replies_glimpse_idx ON glimpse_replies (glimpse_id, id DESC);
CREATE INDEX IF NOT EXISTS messages_lounge_invite_idx ON messages (match_id, created_at DESC)
  WHERE content LIKE '/aura-lounge?room=%' AND unsent_at IS NULL;

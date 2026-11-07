ALTER TABLE users ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMPTZ;
CREATE TABLE IF NOT EXISTS user_presence (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id UUID NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY(user_id,session_id)
);
CREATE INDEX IF NOT EXISTS idx_user_presence_active ON user_presence(user_id,expires_at);

CREATE TABLE IF NOT EXISTS aura_requests (
  id SERIAL PRIMARY KEY,
  sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  receiver_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_id INTEGER REFERENCES posts(id) ON DELETE SET NULL,
  opening_message TEXT NOT NULL CHECK (length(opening_message) BETWEEN 1 AND 1000),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','declined')),
  match_id INTEGER REFERENCES matches(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(sender_id,receiver_id), CHECK(sender_id != receiver_id)
);
CREATE INDEX IF NOT EXISTS idx_aura_requests_inbox ON aura_requests(receiver_id,status,created_at);

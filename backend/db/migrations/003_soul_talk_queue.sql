ALTER TABLE aura_sessions ADD COLUMN IF NOT EXISTS requested_partner_id INTEGER REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE aura_sessions ADD COLUMN IF NOT EXISTS search_expires_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_aura_sessions_search ON aura_sessions (status, search_expires_at) WHERE status = 'waiting';
-- Old waiting rows have no live search lease and must never be paired.
UPDATE aura_sessions SET status = 'ended' WHERE status = 'waiting' AND search_expires_at IS NULL;

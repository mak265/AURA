ALTER TABLE messages ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;
ALTER TABLE aura_session_messages ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;
ALTER TABLE aura_session_messages ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ;
UPDATE messages SET delivered_at=read_at WHERE read_at IS NOT NULL AND delivered_at IS NULL;

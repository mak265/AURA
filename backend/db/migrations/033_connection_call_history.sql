ALTER TABLE connection_calls ADD COLUMN IF NOT EXISTS connected_at TIMESTAMPTZ;
ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_kind_check;
ALTER TABLE messages ADD CONSTRAINT messages_kind_check CHECK (kind IN ('text', 'image', 'audio', 'call'));

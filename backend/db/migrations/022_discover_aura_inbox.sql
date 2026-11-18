ALTER TABLE likes ADD COLUMN IF NOT EXISTS receiver_dismissed_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS likes_recipient_inbox ON likes(receiver_id,created_at DESC) WHERE receiver_dismissed_at IS NULL;

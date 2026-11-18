ALTER TABLE posts ADD COLUMN IF NOT EXISTS identity_mode TEXT NOT NULL DEFAULT 'aura'
  CHECK (identity_mode IN ('aura', 'profile'));

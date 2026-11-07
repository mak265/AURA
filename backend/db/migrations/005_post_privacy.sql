ALTER TABLE posts ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public','connections','private'));

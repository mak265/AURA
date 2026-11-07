ALTER TABLE messages ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'text' CHECK(kind IN ('text','image','audio'));
ALTER TABLE messages ADD COLUMN IF NOT EXISTS attachment BYTEA;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS attachment_mime TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS duration_seconds REAL;

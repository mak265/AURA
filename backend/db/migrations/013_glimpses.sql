CREATE TABLE IF NOT EXISTS glimpses (
 id SERIAL PRIMARY KEY,
 user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 caption TEXT NOT NULL DEFAULT '',
 image_url TEXT,
 visibility TEXT NOT NULL DEFAULT 'connections' CHECK(visibility IN ('public','connections')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW()+INTERVAL '24 hours'
);
CREATE INDEX IF NOT EXISTS glimpses_expiry_idx ON glimpses(expires_at);

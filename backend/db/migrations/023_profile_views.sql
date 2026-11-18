CREATE TABLE IF NOT EXISTS profile_views (
  owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  viewer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  viewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (owner_id, viewer_id),
  CHECK (owner_id <> viewer_id)
);

CREATE INDEX IF NOT EXISTS profile_views_recent ON profile_views (owner_id, viewed_at DESC, viewer_id);

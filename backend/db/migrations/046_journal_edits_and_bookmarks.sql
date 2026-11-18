ALTER TABLE posts ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS post_bookmarks (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  UNIQUE (user_id, post_id)
);

CREATE INDEX IF NOT EXISTS post_bookmarks_user_recency ON post_bookmarks(user_id, id DESC);
CREATE INDEX IF NOT EXISTS post_bookmarks_post ON post_bookmarks(post_id);

-- Migration: Add Feed, Credits, and Soul Game Gating
-- Run: psql -U postgres -d aura -f migrations/001_feed_credits_soulgate.sql

-- 1. Credits system on users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS credits INTEGER DEFAULT 10;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_credit_reset DATE DEFAULT CURRENT_DATE;

-- 2. Soul game completion gate on matches
ALTER TABLE matches ADD COLUMN IF NOT EXISTS soul_game_completed BOOLEAN DEFAULT FALSE;

-- 3. Posts (public pictures feed)
CREATE TABLE IF NOT EXISTS posts (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  image_url TEXT,
  caption TEXT,
  visibility TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public','connections','private')),
  created_at TIMESTAMP DEFAULT NOW()
);
-- Posts can be text-only; ensure image_url is nullable on existing tables
ALTER TABLE posts ALTER COLUMN image_url DROP NOT NULL;

-- 4. Post likes (with reactions)
CREATE TABLE IF NOT EXISTS post_likes (
  id SERIAL PRIMARY KEY,
  post_id INTEGER REFERENCES posts(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  reaction VARCHAR(20) DEFAULT 'like',
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(post_id, user_id)
);
ALTER TABLE post_likes ADD COLUMN IF NOT EXISTS reaction VARCHAR(20) DEFAULT 'like';

-- 5. Post comments (with replies)
CREATE TABLE IF NOT EXISTS post_comments (
  id SERIAL PRIMARY KEY,
  post_id INTEGER REFERENCES posts(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  parent_id INTEGER REFERENCES post_comments(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);
ALTER TABLE post_comments ADD COLUMN IF NOT EXISTS parent_id INTEGER REFERENCES post_comments(id) ON DELETE CASCADE;

-- 6. Comment reactions
CREATE TABLE IF NOT EXISTS comment_likes (
  id SERIAL PRIMARY KEY,
  comment_id INTEGER REFERENCES post_comments(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  reaction VARCHAR(20) DEFAULT 'like',
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(comment_id, user_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_posts_user_id ON posts(user_id);
CREATE INDEX IF NOT EXISTS idx_post_likes_post_id ON post_likes(post_id);
CREATE INDEX IF NOT EXISTS idx_post_comments_post_id ON post_comments(post_id);
CREATE INDEX IF NOT EXISTS idx_post_comments_parent_id ON post_comments(parent_id);
CREATE INDEX IF NOT EXISTS idx_comment_likes_comment_id ON comment_likes(comment_id);

-- 7. Aura session anonymous chat messages
CREATE TABLE IF NOT EXISTS aura_session_messages (
  id SERIAL PRIMARY KEY,
  session_id INTEGER REFERENCES aura_sessions(id) ON DELETE CASCADE,
  delivered_at TIMESTAMPTZ,
  read_at TIMESTAMPTZ,
  sender_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_aura_session_messages_session_id ON aura_session_messages(session_id);

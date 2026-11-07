-- AURA Database Schema
-- Run with: psql -U postgres -d aura -f db/schema.sql

-- Drop tables in reverse dependency order
DROP TABLE IF EXISTS aura_session_answers CASCADE;
DROP TABLE IF EXISTS aura_sessions CASCADE;
DROP TABLE IF EXISTS reveal_requests CASCADE;
DROP TABLE IF EXISTS messages CASCADE;
DROP TABLE IF EXISTS matches CASCADE;
DROP TABLE IF EXISTS likes CASCADE;
DROP TABLE IF EXISTS user_interests CASCADE;
DROP TABLE IF EXISTS reports CASCADE;
DROP TABLE IF EXISTS blocks CASCADE;
DROP TABLE IF EXISTS auras CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TABLE IF EXISTS interests CASCADE;

-- Interests catalog
CREATE TABLE interests (
  id SERIAL PRIMARY KEY,
  name VARCHAR(50) UNIQUE NOT NULL,
  emoji VARCHAR(10) NOT NULL
);

-- Users (authentication + private identity)
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  real_name VARCHAR(100),
  profile_photo TEXT,
  age INTEGER,
  gender VARCHAR(20),
  religion VARCHAR(50),
  city VARCHAR(100),
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  settings JSONB DEFAULT '{"hide_online": false, "hide_last_active": false, "incognito": false}'::jsonb,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Aura profiles (public anonymous identity)
CREATE TABLE auras (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  aura_name VARCHAR(50) NOT NULL,
  dating_intention VARCHAR(40) NOT NULL DEFAULT '',
  prompt_answers JSONB NOT NULL DEFAULT '[]'::jsonb,
  aura_color VARCHAR(100) NOT NULL DEFAULT 'violet',
  vibe VARCHAR(100),
  bio TEXT,
  emoji VARCHAR(10) DEFAULT '🌌',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- User interests (many-to-many)
CREATE TABLE user_interests (
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  interest_id INTEGER REFERENCES interests(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, interest_id)
);

-- Likes / Send Aura
CREATE TABLE likes (
  id SERIAL PRIMARY KEY,
  sender_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  receiver_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(sender_id, receiver_id)
);

-- Matches (mutual likes)
CREATE TABLE matches (
  id SERIAL PRIMARY KEY,
  user1_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  user2_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  revealed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user1_id, user2_id)
);

-- Messages
CREATE TABLE messages (
  id SERIAL PRIMARY KEY,
  match_id INTEGER REFERENCES matches(id) ON DELETE CASCADE,
  sender_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  read_at TIMESTAMP,
  delivered_at TIMESTAMPTZ,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Mutual reveal requests
CREATE TABLE reveal_requests (
  id SERIAL PRIMARY KEY,
  match_id INTEGER REFERENCES matches(id) ON DELETE CASCADE,
  requester_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  confirmer_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  status VARCHAR(20) DEFAULT 'pending', -- pending, mutual, rejected
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(match_id, requester_id)
);

-- Aura Chat sessions (Soul Game)
CREATE TABLE aura_sessions (
  id SERIAL PRIMARY KEY,
  user1_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  user2_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  compatibility INTEGER DEFAULT 0,
  requested_partner_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  search_expires_at TIMESTAMPTZ,
  status VARCHAR(20) DEFAULT 'active', -- active, matched, ended
  created_at TIMESTAMP DEFAULT NOW()
);

-- Aura session answers
CREATE TABLE aura_session_answers (
  id SERIAL PRIMARY KEY,
  session_id INTEGER REFERENCES aura_sessions(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  round INTEGER NOT NULL,
  answer TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Blocks
CREATE TABLE blocks (
  id SERIAL PRIMARY KEY,
  blocker_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  blocked_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(blocker_id, blocked_id)
);

-- Reports
CREATE TABLE reports (
  id SERIAL PRIMARY KEY,
  reporter_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  reported_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  reason VARCHAR(50) NOT NULL,
  details TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_messages_match_id ON messages(match_id);
CREATE INDEX idx_matches_user1 ON matches(user1_id);
CREATE INDEX idx_matches_user2 ON matches(user2_id);
CREATE INDEX idx_likes_sender ON likes(sender_id);
CREATE INDEX idx_likes_receiver ON likes(receiver_id);

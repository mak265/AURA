CREATE TABLE IF NOT EXISTS premium_codes (
  id SERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL DEFAULT '',
  premium_days INTEGER NOT NULL CHECK (premium_days BETWEEN 1 AND 365),
  max_claims INTEGER NOT NULL CHECK (max_claims BETWEEN 1 AND 100000),
  claimed_count INTEGER NOT NULL DEFAULT 0 CHECK (claimed_count BETWEEN 0 AND max_claims),
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS premium_code_claims (
  code_id INTEGER NOT NULL REFERENCES premium_codes(id),
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (code_id, user_id)
);

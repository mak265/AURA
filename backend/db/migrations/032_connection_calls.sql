CREATE TABLE IF NOT EXISTS connection_calls (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  match_id INTEGER NOT NULL UNIQUE REFERENCES matches(id) ON DELETE CASCADE,
  caller_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('ringing', 'active')),
  expires_at TIMESTAMPTZ NOT NULL,
  caller_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  recipient_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS connection_call_signals (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  call_id INTEGER NOT NULL REFERENCES connection_calls(id) ON DELETE CASCADE,
  sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  payload JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS connection_call_signals_call_idx ON connection_call_signals(call_id, id);

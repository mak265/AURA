CREATE TABLE IF NOT EXISTS native_push_devices (
  platform TEXT NOT NULL CHECK (platform IN ('android', 'ios')),
  token TEXT NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  auth_version INTEGER NOT NULL,
  sound BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (platform, token)
);
CREATE INDEX IF NOT EXISTS native_push_devices_user ON native_push_devices(user_id);

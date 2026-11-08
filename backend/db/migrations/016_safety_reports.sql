CREATE TABLE IF NOT EXISTS safety_reports (
 id BIGSERIAL PRIMARY KEY,
 reporter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 kind TEXT NOT NULL CHECK(kind IN ('user','post','bug')),
 target_id INTEGER,
 reported_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
 reason TEXT NOT NULL,
 details TEXT NOT NULL DEFAULT '',
 context_path TEXT,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','reviewing','resolved','dismissed')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS safety_reports_reporter_idx ON safety_reports(reporter_id,created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS safety_reports_pending_target_idx ON safety_reports(reporter_id,kind,target_id) WHERE kind IN ('user','post') AND status IN ('pending','reviewing');

ALTER TABLE safety_reports ADD COLUMN IF NOT EXISTS evidence_reviewer_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
CREATE TABLE IF NOT EXISTS report_message_evidence (
 id BIGSERIAL PRIMARY KEY,
 report_id BIGINT NOT NULL REFERENCES safety_reports(id) ON DELETE CASCADE,
 source TEXT NOT NULL CHECK(source IN ('match','soul')),
 message_id INTEGER NOT NULL,
 sender_id INTEGER NOT NULL,
 content TEXT NOT NULL DEFAULT '',
 kind TEXT NOT NULL DEFAULT 'text',
 attachment BYTEA,
 attachment_mime TEXT,
 duration_seconds REAL,
 media_omitted BOOLEAN NOT NULL DEFAULT FALSE,
 message_created_at TIMESTAMPTZ NOT NULL,
 captured_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 expires_at TIMESTAMPTZ NOT NULL,
 UNIQUE(report_id,source,message_id)
);
CREATE INDEX IF NOT EXISTS report_evidence_expiry_idx ON report_message_evidence(expires_at);

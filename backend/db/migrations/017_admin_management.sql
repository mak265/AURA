ALTER TABLE users ADD COLUMN IF NOT EXISTS management_role TEXT NOT NULL DEFAULT 'user' CHECK(management_role IN ('user','staff','admin','superadmin'));
ALTER TABLE users ADD COLUMN IF NOT EXISTS banned_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS ban_reason TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS admin_restricted_until TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS admin_restriction_reason TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS active_seconds BIGINT NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS usage_last_heartbeat TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS active_since TIMESTAMPTZ;
ALTER TABLE safety_reports ADD COLUMN IF NOT EXISTS conversation_id INTEGER REFERENCES matches(id) ON DELETE SET NULL;
ALTER TABLE safety_reports ADD COLUMN IF NOT EXISTS soul_session_id INTEGER REFERENCES aura_sessions(id) ON DELETE SET NULL;
ALTER TABLE safety_reports ADD COLUMN IF NOT EXISTS management_notes TEXT NOT NULL DEFAULT '';
ALTER TABLE safety_reports ADD COLUMN IF NOT EXISTS assigned_to INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE safety_reports ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
CREATE TABLE IF NOT EXISTS account_warnings (
 id BIGSERIAL PRIMARY KEY,
 user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 issued_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
 reason TEXT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 acknowledged_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS management_audit (
 id BIGSERIAL PRIMARY KEY,
 actor_id INTEGER,
 actor_email TEXT NOT NULL,
 action TEXT NOT NULL,
 target_type TEXT NOT NULL,
 target_id INTEGER,
 reason TEXT,
 changes JSONB NOT NULL DEFAULT '{}'::jsonb,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS management_audit_created_idx ON management_audit(created_at DESC);
CREATE OR REPLACE FUNCTION forbid_audit_edit() RETURNS TRIGGER AS $$ BEGIN RAISE EXCEPTION 'Audit history is append-only'; END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS management_audit_immutable ON management_audit;
CREATE TRIGGER management_audit_immutable BEFORE UPDATE OR DELETE ON management_audit FOR EACH ROW EXECUTE FUNCTION forbid_audit_edit();
CREATE TABLE IF NOT EXISTS daily_app_usage (
 user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 usage_date DATE NOT NULL,
 seconds BIGINT NOT NULL DEFAULT 0,
 PRIMARY KEY(user_id,usage_date)
);
ALTER TABLE posts ADD COLUMN IF NOT EXISTS moderation_hidden_at TIMESTAMPTZ;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS moderation_reason TEXT;

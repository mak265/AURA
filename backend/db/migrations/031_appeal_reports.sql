ALTER TABLE safety_reports DROP CONSTRAINT IF EXISTS safety_reports_kind_check;
ALTER TABLE safety_reports ADD CONSTRAINT safety_reports_kind_check
  CHECK (kind IN ('user', 'post', 'bug', 'appeal'));

UPDATE safety_reports SET kind = 'appeal'
WHERE kind = 'bug' AND reason = 'moderation_appeal';

CREATE INDEX IF NOT EXISTS safety_reports_appeal_notice_idx
  ON safety_reports (reporter_id, target_id, id DESC) WHERE kind = 'appeal';

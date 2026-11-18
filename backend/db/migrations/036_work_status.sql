ALTER TABLE users ADD COLUMN IF NOT EXISTS work_status TEXT
  CHECK (work_status IN ('student', 'working'));

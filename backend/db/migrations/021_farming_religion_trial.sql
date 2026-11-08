ALTER TABLE farming_usage ADD COLUMN IF NOT EXISTS religion_uses INTEGER NOT NULL DEFAULT 0 CHECK (religion_uses >= 0);

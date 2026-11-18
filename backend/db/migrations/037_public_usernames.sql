ALTER TABLE users ADD COLUMN IF NOT EXISTS username TEXT;

UPDATE users SET username = 'aura_' || id WHERE username IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS users_username_unique ON users (username);

CREATE OR REPLACE FUNCTION assign_aura_username() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.username := COALESCE(NEW.username, 'aura_' || NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS assign_aura_username_trigger ON users;
CREATE TRIGGER assign_aura_username_trigger BEFORE INSERT ON users
FOR EACH ROW EXECUTE FUNCTION assign_aura_username();

ALTER TABLE users ALTER COLUMN username SET NOT NULL;

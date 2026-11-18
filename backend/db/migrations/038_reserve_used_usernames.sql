CREATE TABLE IF NOT EXISTS username_reservations (
  username TEXT PRIMARY KEY,
  owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL
);

INSERT INTO username_reservations (username, owner_id)
SELECT LOWER(username), id FROM users
ON CONFLICT (username) DO NOTHING;

CREATE OR REPLACE FUNCTION reserve_aura_username() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO username_reservations (username, owner_id)
  VALUES (LOWER(NEW.username), NEW.id)
  ON CONFLICT (username) DO UPDATE SET owner_id = EXCLUDED.owner_id
  WHERE username_reservations.owner_id = EXCLUDED.owner_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Username already reserved' USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS reserve_aura_username_trigger ON users;
CREATE TRIGGER reserve_aura_username_trigger AFTER INSERT OR UPDATE OF username ON users
FOR EACH ROW EXECUTE FUNCTION reserve_aura_username();

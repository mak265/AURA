ALTER TABLE messages ADD COLUMN IF NOT EXISTS client_message_id UUID;
CREATE UNIQUE INDEX IF NOT EXISTS messages_client_message_id_idx
  ON messages (match_id, sender_id, client_message_id);

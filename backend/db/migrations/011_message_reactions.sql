CREATE TABLE IF NOT EXISTS message_reactions (
 message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
 user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 reaction TEXT NOT NULL CHECK (reaction IN ('like','love','care','haha','wow','sad','angry')),
 PRIMARY KEY(message_id,user_id)
);

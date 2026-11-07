CREATE TABLE IF NOT EXISTS glimpse_views (
 glimpse_id INTEGER NOT NULL REFERENCES glimpses(id) ON DELETE CASCADE,
 user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 viewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 reaction TEXT CHECK(reaction IN ('like','love','care','haha','wow','sad','angry')),
 PRIMARY KEY(glimpse_id,user_id)
);

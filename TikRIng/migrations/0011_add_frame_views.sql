CREATE TABLE IF NOT EXISTS frame_views (
  frame_id TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(frame_id, actor_type, actor_id),
  FOREIGN KEY (frame_id) REFERENCES frames(id)
);

CREATE INDEX IF NOT EXISTS idx_frame_views_frame_id ON frame_views(frame_id);
CREATE INDEX IF NOT EXISTS idx_frame_views_actor ON frame_views(actor_type, actor_id);
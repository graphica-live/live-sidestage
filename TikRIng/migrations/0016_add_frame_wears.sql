CREATE TABLE IF NOT EXISTS frame_wears (
  frame_id TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(frame_id, actor_type, actor_id),
  FOREIGN KEY (frame_id) REFERENCES frames(id)
);

CREATE INDEX IF NOT EXISTS idx_frame_wears_frame_id ON frame_wears(frame_id);
CREATE INDEX IF NOT EXISTS idx_frame_wears_actor ON frame_wears(actor_type, actor_id);

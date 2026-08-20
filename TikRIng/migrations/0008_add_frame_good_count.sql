ALTER TABLE frames ADD COLUMN good_count INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS frame_goods (
  frame_id TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(frame_id, actor_type, actor_id),
  FOREIGN KEY (frame_id) REFERENCES frames(id)
);

CREATE INDEX IF NOT EXISTS idx_frame_goods_frame_id ON frame_goods(frame_id);
CREATE INDEX IF NOT EXISTS idx_frame_goods_actor ON frame_goods(actor_type, actor_id);
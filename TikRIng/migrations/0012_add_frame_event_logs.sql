CREATE TABLE IF NOT EXISTS frame_view_events (
  id TEXT PRIMARY KEY,
  frame_id TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (frame_id) REFERENCES frames(id)
);

CREATE TABLE IF NOT EXISTS frame_wear_events (
  id TEXT PRIMARY KEY,
  frame_id TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (frame_id) REFERENCES frames(id)
);

CREATE INDEX IF NOT EXISTS idx_frame_view_events_frame_created_at ON frame_view_events(frame_id, created_at);
CREATE INDEX IF NOT EXISTS idx_frame_view_events_created_at ON frame_view_events(created_at);
CREATE INDEX IF NOT EXISTS idx_frame_view_events_actor_created_at ON frame_view_events(actor_type, actor_id, created_at);

CREATE INDEX IF NOT EXISTS idx_frame_wear_events_frame_created_at ON frame_wear_events(frame_id, created_at);
CREATE INDEX IF NOT EXISTS idx_frame_wear_events_created_at ON frame_wear_events(created_at);
CREATE INDEX IF NOT EXISTS idx_frame_wear_events_actor_created_at ON frame_wear_events(actor_type, actor_id, created_at);
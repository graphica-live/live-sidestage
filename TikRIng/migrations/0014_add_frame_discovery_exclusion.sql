ALTER TABLE frames ADD COLUMN exclude_from_rankings INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_frames_exclude_from_rankings
  ON frames(exclude_from_rankings);
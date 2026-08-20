WITH RECURSIVE view_uniques AS (
  SELECT frame_id, COUNT(*) AS unique_count
  FROM frame_views
  GROUP BY frame_id
),
legacy_counts AS (
  SELECT
    f.id AS frame_id,
    CASE
      WHEN COALESCE(f.view_count, 0) - COALESCE(v.unique_count, 0) > 0
        THEN COALESCE(f.view_count, 0) - COALESCE(v.unique_count, 0)
      ELSE 0
    END AS legacy_count
  FROM frames f
  LEFT JOIN view_uniques v ON v.frame_id = f.id
),
seq(frame_id, n, max_n) AS (
  SELECT frame_id, 1, legacy_count
  FROM legacy_counts
  WHERE legacy_count > 0

  UNION ALL

  SELECT frame_id, n + 1, max_n
  FROM seq
  WHERE n < max_n
)
INSERT INTO frame_view_events (id, frame_id, actor_type, actor_id, created_at)
SELECT
  lower(hex(randomblob(16))) AS id,
  frame_id,
  'legacy' AS actor_type,
  'legacy-' || frame_id || '-' || n AS actor_id,
  CAST(strftime('%s', '2026-03-31 15:00:00') AS INTEGER) * 1000 AS created_at
FROM seq;
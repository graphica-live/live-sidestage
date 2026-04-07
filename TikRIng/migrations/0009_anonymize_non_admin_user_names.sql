WITH RECURSIVE user_chars AS (
  SELECT
    id,
    1 AS pos,
    0 AS hash
  FROM users
  WHERE LOWER(COALESCE(email, '')) <> 'joe.graphica@gmail.com'

  UNION ALL

  SELECT
    id,
    pos + 1,
    ((hash * 31) + unicode(substr(id, pos, 1))) % 10000
  FROM user_chars
  WHERE pos <= length(id)
),
resolved_names AS (
  SELECT
    id,
    'User' || printf('%04d', hash) AS anonymous_name
  FROM user_chars
  WHERE pos = length(id) + 1
)
UPDATE users
SET
  display_name = (
    SELECT anonymous_name
    FROM resolved_names
    WHERE resolved_names.id = users.id
  ),
  custom_display_name = (
    SELECT anonymous_name
    FROM resolved_names
    WHERE resolved_names.id = users.id
  )
WHERE id IN (
  SELECT id
  FROM resolved_names
);
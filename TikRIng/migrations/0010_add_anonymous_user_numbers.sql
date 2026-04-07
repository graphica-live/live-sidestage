CREATE TABLE IF NOT EXISTS anonymous_user_numbers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL UNIQUE
);

INSERT INTO anonymous_user_numbers (user_id)
SELECT users.id
FROM users
WHERE LOWER(COALESCE(users.email, '')) <> 'joe.graphica@gmail.com'
  AND NOT EXISTS (
    SELECT 1
    FROM anonymous_user_numbers
    WHERE anonymous_user_numbers.user_id = users.id
  )
ORDER BY users.created_at ASC, users.id ASC;

UPDATE users
SET
  display_name = (
    SELECT 'User' || printf('%06d', anonymous_user_numbers.id)
    FROM anonymous_user_numbers
    WHERE anonymous_user_numbers.user_id = users.id
  ),
  custom_display_name = (
    SELECT 'User' || printf('%06d', anonymous_user_numbers.id)
    FROM anonymous_user_numbers
    WHERE anonymous_user_numbers.user_id = users.id
  )
WHERE LOWER(COALESCE(users.email, '')) <> 'joe.graphica@gmail.com';
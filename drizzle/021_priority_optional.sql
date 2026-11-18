-- 021_priority_optional: priority becomes optional. Unset = empty (NULL);
-- p0 is the most urgent, p3 the least. Existing tasks are backfilled to p3
-- (the least urgent), and the default for a new task is empty.

ALTER TABLE tasks ALTER COLUMN priority DROP NOT NULL;

ALTER TABLE tasks ALTER COLUMN priority SET DEFAULT NULL;

UPDATE tasks SET priority = 3 WHERE priority IS DISTINCT FROM 3;

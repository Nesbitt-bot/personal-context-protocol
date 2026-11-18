-- 018_task_attributes: let the sync plugins set session/task attributes the
-- sprint board needs on upload. `sessions.agent_name` and `sessions.device_id`
-- record which agent on which machine hosted the session; `tasks.external_key`
-- gives a plugin a stable key to find-or-create a task by. Additive and idempotent.

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS agent_name text;

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS device_id text;

CREATE INDEX IF NOT EXISTS sessions_device_id_idx ON sessions(device_id);

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS external_key text;

CREATE UNIQUE INDEX IF NOT EXISTS tasks_external_key_idx ON tasks(external_key);

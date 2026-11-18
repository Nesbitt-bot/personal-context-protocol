-- 017_tasks: the Asana-like sprint board. A "task" is a unit of work inside a
-- category (folder/topic). Projects stay pure repo tags (migration 013); tasks
-- link to them many-to-many with one primary. Sessions attach to a single task.
-- Additive and idempotent.

CREATE TABLE IF NOT EXISTS task_boards (
  id text PRIMARY KEY,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tasks (
  id text PRIMARY KEY,
  parent_id text REFERENCES tasks(id) ON DELETE CASCADE,
  topic_id text REFERENCES topics(id) ON DELETE SET NULL,
  title text NOT NULL,
  description text,
  completed boolean NOT NULL DEFAULT false,
  completed_at timestamptz,
  priority integer NOT NULL DEFAULT 0,
  expected_turns integer,
  due_at timestamptz,
  position double precision NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tasks_topic_id_idx ON tasks(topic_id);
CREATE INDEX IF NOT EXISTS tasks_parent_id_idx ON tasks(parent_id);

CREATE TABLE IF NOT EXISTS task_projects (
  task_id text NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (task_id, project_id)
);

CREATE INDEX IF NOT EXISTS task_projects_project_id_idx ON task_projects(project_id);

CREATE TABLE IF NOT EXISTS task_resources (
  id text PRIMARY KEY,
  task_id text NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  title text NOT NULL,
  url text NOT NULL,
  kind text NOT NULL DEFAULT 'doc' CHECK (kind IN ('doc', 'remote', 'local')),
  source text NOT NULL DEFAULT 'human' CHECK (source IN ('agent', 'human')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS task_resources_task_id_idx ON task_resources(task_id);

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS task_id text REFERENCES tasks(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS sessions_task_id_idx ON sessions(task_id);

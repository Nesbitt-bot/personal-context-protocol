-- 013_projects: cross-machine projects (one per OpenCode session-manager
-- canonical project), per-machine workspaces, explicit name aliases, the
-- session project link and task context, per-field sync clocks, the sync
-- conflict log and pending AI merge tasks. Additive and idempotent.

CREATE TABLE IF NOT EXISTS projects (
  id text PRIMARY KEY,
  canonical_key text NOT NULL UNIQUE,
  display_name text NOT NULL,
  description text,
  git_remotes_json jsonb NOT NULL DEFAULT '[]',
  owner_user_id text REFERENCES users(id) ON DELETE SET NULL,
  sync_clock_json jsonb NOT NULL DEFAULT '{}',
  archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS projects_owner_user_id_idx ON projects(owner_user_id);

CREATE TABLE IF NOT EXISTS project_aliases (
  alias_key text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source text NOT NULL DEFAULT 'manual',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS project_aliases_project_id_idx ON project_aliases(project_id);

CREATE TABLE IF NOT EXISTS project_workspaces (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  device_id text NOT NULL,
  device_label text,
  device_kind text NOT NULL CHECK (device_kind IN ('openclaw-container', 'linux', 'linux-remote', 'windows', 'macos')),
  directory text NOT NULL,
  default_branch text,
  last_seen_at timestamptz,
  sync_clock_json jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, device_id, directory)
);

CREATE INDEX IF NOT EXISTS project_workspaces_device_directory_idx ON project_workspaces(device_id, directory);

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS project_id text REFERENCES projects(id) ON DELETE SET NULL;

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS context_title text;

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS context_summary text;

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS sync_clock_json jsonb NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS sessions_project_id_idx ON sessions(project_id);

ALTER TABLE messages ADD COLUMN IF NOT EXISTS external_message_id text;

CREATE UNIQUE INDEX IF NOT EXISTS messages_session_external_message_idx ON messages(session_id, external_message_id) WHERE external_message_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS sync_conflicts (
  id text PRIMARY KEY,
  entity_type text NOT NULL CHECK (entity_type IN ('session', 'project')),
  entity_id text NOT NULL,
  field text NOT NULL,
  reason text NOT NULL,
  kept_value_json jsonb,
  kept_at timestamptz,
  kept_device text,
  lost_value_json jsonb,
  lost_at timestamptz,
  lost_device text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'dismissed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by text
);

CREATE INDEX IF NOT EXISTS sync_conflicts_entity_idx ON sync_conflicts(entity_type, entity_id);

CREATE INDEX IF NOT EXISTS sync_conflicts_status_idx ON sync_conflicts(status);

CREATE TABLE IF NOT EXISTS merge_tasks (
  id text PRIMARY KEY,
  conflict_id text REFERENCES sync_conflicts(id) ON DELETE SET NULL,
  entity_type text NOT NULL CHECK (entity_type IN ('session', 'project')),
  entity_id text NOT NULL,
  field text NOT NULL,
  versions_json jsonb NOT NULL,
  instructions text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'cancelled')),
  requested_by text NOT NULL,
  result_value_json jsonb,
  completed_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS merge_tasks_status_idx ON merge_tasks(status, created_at);

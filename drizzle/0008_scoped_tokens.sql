-- 008_scoped_tokens: unified scoped token layer for the global token manager.
-- scope: 'global' (full), 'folder' (bounded to folder_id), 'session' (bounded to session_id).
-- permissions_json carries fine-grained flags (create_folders, delete_folders,
-- create_sessions, delete_sessions, mint_tokens, rename_sessions, read_all).

CREATE TABLE IF NOT EXISTS scoped_tokens (
  id text PRIMARY KEY,
  token_hash text NOT NULL,
  salt text NOT NULL,
  token_prefix text,
  name text NOT NULL,
  scope text NOT NULL CHECK (scope IN ('global', 'folder', 'session')),
  folder_id text REFERENCES topics(id),
  session_id text REFERENCES sessions(id),
  permissions_json jsonb DEFAULT '{}',
  revoked boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  last_used_at timestamptz
);

CREATE INDEX IF NOT EXISTS scoped_tokens_prefix_idx ON scoped_tokens(token_prefix);
CREATE INDEX IF NOT EXISTS scoped_tokens_folder_idx ON scoped_tokens(folder_id);
CREATE INDEX IF NOT EXISTS scoped_tokens_session_idx ON scoped_tokens(session_id);

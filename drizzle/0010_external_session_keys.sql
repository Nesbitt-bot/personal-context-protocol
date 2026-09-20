-- 010_external_session_keys: stable source identities for idempotent imports.

ALTER TABLE topics ADD COLUMN IF NOT EXISTS external_key text;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS external_key text;

CREATE UNIQUE INDEX IF NOT EXISTS topics_external_key_idx
  ON topics(external_key) WHERE external_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS sessions_external_key_idx
  ON sessions(external_key) WHERE external_key IS NOT NULL;

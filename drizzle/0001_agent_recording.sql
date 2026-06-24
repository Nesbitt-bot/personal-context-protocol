-- Migration: 002_agent_recording
-- Description: Agent recording-URL model — durable session compactions and a
-- defensive token-expiration column. Idempotent and data-preserving: existing
-- session tokens keep a NULL expires_at, which is treated as "never expire".

-- compactions: additional durable summaries; never replaces raw messages.
CREATE TABLE IF NOT EXISTS compactions (
  id text PRIMARY KEY,
  session_id text NOT NULL REFERENCES sessions(id),
  summary text NOT NULL,
  timeline_json jsonb,
  decisions_json jsonb,
  requirements_json jsonb,
  open_questions_json jsonb,
  artifacts_json jsonb,
  warnings_json jsonb,
  provider text,
  base_model text,
  created_at timestamptz NOT NULL DEFAULT now(),
  metadata_json jsonb DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS compactions_session_id_idx ON compactions(session_id);

-- Token expiration. The initial schema already includes expires_at; this guards
-- databases created from an older revision. NULL means "never expire".
ALTER TABLE session_tokens ADD COLUMN IF NOT EXISTS expires_at timestamptz;

INSERT INTO schema_migrations (version, checksum)
VALUES ('002_agent_recording', 'compactions_and_token_expiration')
ON CONFLICT (version) DO NOTHING;

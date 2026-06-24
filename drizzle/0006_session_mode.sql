-- Migration: 007_session_mode
-- Description: Per-session recording mode the agent is told to honor.
--   'wild'  (default) — the agent may redact secrets/credentials it judges unsafe
--   'exact'           — record verbatim (including credentials) for task migration
-- Idempotent and data-preserving: existing sessions default to 'wild'.

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'wild';

INSERT INTO schema_migrations (version, checksum)
VALUES ('007_session_mode', 'session_recording_mode')
ON CONFLICT (version) DO NOTHING;

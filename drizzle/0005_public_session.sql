-- Migration: 006_public_session
-- Description: Optional public read-only sharing of a session. When `public` is
-- true, the session and its messages can be viewed without the admin UI token.
-- Idempotent and data-preserving: existing sessions default to private (false).

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS public boolean NOT NULL DEFAULT false;

INSERT INTO schema_migrations (version, checksum)
VALUES ('006_public_session', 'session_public_sharing')
ON CONFLICT (version) DO NOTHING;

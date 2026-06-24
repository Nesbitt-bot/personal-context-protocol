-- Migration: 003_admin_token_source
-- Description: Track admin credential provenance so deploy-generated tokens can
-- be rotated on each deploy while user-set and PCP_ADMIN_TOKEN credentials are
-- preserved. Idempotent and lockout-safe: the column is added nullable and
-- pre-existing credentials are marked 'user' so an upgrade never rotates a token
-- an admin already relies on.

ALTER TABLE ui_auth ADD COLUMN IF NOT EXISTS source text;
UPDATE ui_auth SET source = 'user' WHERE source IS NULL;

INSERT INTO schema_migrations (version, checksum)
VALUES ('003_admin_token_source', 'ui_auth_source_provenance')
ON CONFLICT (version) DO NOTHING;

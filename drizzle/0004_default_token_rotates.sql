-- Migration: 005_default_token_rotates
-- Description: Correct the 003 backfill. Migration 003 marked every pre-existing
-- admin credential as source='user', which preserved it forever and stopped
-- per-deploy rotation. The intended default is to rotate the deploy-generated
-- token on each deploy; only a token set in Settings (tagged 'user' AFTER this
-- migration) is preserved. This resets the mis-marked rows to 'deploy'.
--
-- One-time: the data-modifying CTE inserts the migration record and only runs
-- the UPDATE when the record was newly inserted, so it never re-clobbers a
-- genuine Settings-set token created after this migration applies.

WITH applied AS (
  INSERT INTO schema_migrations (version, checksum)
  VALUES ('005_default_token_rotates', 'reset_legacy_user_source')
  ON CONFLICT (version) DO NOTHING
  RETURNING version
)
UPDATE ui_auth SET source = 'deploy', updated_at = now()
WHERE source = 'user' AND EXISTS (SELECT 1 FROM applied);

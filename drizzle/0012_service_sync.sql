-- 012_service_sync: service credentials for channel plugins, server-side turn
-- grants (looked up by OpenClaw session key) and the synced-turn idempotency
-- ledger. Idempotent.

CREATE TABLE IF NOT EXISTS service_credentials (
  id text PRIMARY KEY,
  name text NOT NULL,
  token_hash text NOT NULL,
  salt text NOT NULL,
  token_prefix text NOT NULL,
  principal_prefixes_json jsonb NOT NULL DEFAULT '[]',
  revoked boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  last_used_at timestamptz
);

CREATE INDEX IF NOT EXISTS service_credentials_prefix_idx ON service_credentials(token_prefix);

CREATE TABLE IF NOT EXISTS turn_grants (
  id text PRIMARY KEY,
  credential_id text NOT NULL REFERENCES service_credentials(id) ON DELETE CASCADE,
  session_key text NOT NULL,
  principal text NOT NULL,
  home_session_id text NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  readable_session_ids_json jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);

CREATE INDEX IF NOT EXISTS turn_grants_lookup_idx ON turn_grants(credential_id, session_key, expires_at);

CREATE INDEX IF NOT EXISTS turn_grants_home_session_idx ON turn_grants(home_session_id);

CREATE TABLE IF NOT EXISTS synced_turns (
  session_id text NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  external_key text NOT NULL,
  first_ordinal integer NOT NULL,
  message_count integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, external_key)
);

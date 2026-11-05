-- 014_broker: credential kinds and delegates, broker turn grants and the
-- AstrBot stamp replay ledger. Additive and idempotent.

ALTER TABLE service_credentials ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'channel' CHECK (kind IN ('channel', 'ingress', 'broker'));

ALTER TABLE service_credentials ADD COLUMN IF NOT EXISTS delegate_credential_id text REFERENCES service_credentials(id) ON DELETE SET NULL;

ALTER TABLE turn_grants ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'service' CHECK (origin IN ('service', 'broker'));

ALTER TABLE turn_grants ADD COLUMN IF NOT EXISTS agent text;

ALTER TABLE turn_grants ADD COLUMN IF NOT EXISTS delegate_credential_id text REFERENCES service_credentials(id) ON DELETE SET NULL;

ALTER TABLE turn_grants ADD COLUMN IF NOT EXISTS external_key text;

ALTER TABLE turn_grants ADD COLUMN IF NOT EXISTS broker_credential_id text REFERENCES service_credentials(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS broker_replay (
    credential_id text NOT NULL REFERENCES service_credentials(id) ON DELETE CASCADE,
    nonce text NOT NULL,
    seen_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (credential_id, nonce)
  );

CREATE INDEX IF NOT EXISTS broker_replay_seen_at_idx ON broker_replay(seen_at);

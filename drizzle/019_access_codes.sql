-- 019_access_codes: temporary bind/sync links. A code in the URL grants
-- append/read access to one session for a sliding 1h idle window, hard-capped
-- at 24h from creation. Only the hash is stored; the raw code is returned once.

CREATE TABLE IF NOT EXISTS access_codes (
  id text PRIMARY KEY,
  code_hash text NOT NULL,
  salt text NOT NULL,
  code_prefix text NOT NULL,
  session_id text NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked boolean NOT NULL DEFAULT false
);

CREATE UNIQUE INDEX IF NOT EXISTS access_codes_code_hash_idx ON access_codes(code_hash);

CREATE INDEX IF NOT EXISTS access_codes_prefix_idx ON access_codes(code_prefix);

CREATE INDEX IF NOT EXISTS access_codes_session_id_idx ON access_codes(session_id);

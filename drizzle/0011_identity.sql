-- 011_identity: Casdoor OIDC users, linked platform identities, single-use claim
-- codes, browser login sessions and per-session ownership. Idempotent.

CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  oidc_issuer text NOT NULL,
  oidc_sub text NOT NULL,
  display_name text NOT NULL,
  email text,
  groups_json jsonb NOT NULL DEFAULT '[]',
  is_admin boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz,
  UNIQUE (oidc_issuer, oidc_sub)
);

CREATE TABLE IF NOT EXISTS identities (
  principal text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  link_method text NOT NULL CHECK (link_method IN ('claim', 'admin')),
  linked_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS identities_user_id_idx ON identities(user_id);

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS owner_user_id text REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS principal text;

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS class text NOT NULL DEFAULT 'unattributed' CHECK (class IN ('trusted', 'unattributed', 'group'));

CREATE INDEX IF NOT EXISTS sessions_owner_user_id_idx ON sessions(owner_user_id);

CREATE INDEX IF NOT EXISTS sessions_principal_idx ON sessions(principal);

CREATE TABLE IF NOT EXISTS claims (
  id text PRIMARY KEY,
  code_hash text NOT NULL UNIQUE,
  session_id text NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  principal text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  redeemed_by text REFERENCES users(id) ON DELETE SET NULL,
  redeemed_at timestamptz
);

CREATE INDEX IF NOT EXISTS claims_session_id_idx ON claims(session_id);

CREATE TABLE IF NOT EXISTS claim_attempts (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  succeeded boolean NOT NULL,
  attempted_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS claim_attempts_user_time_idx ON claim_attempts(user_id, attempted_at);

CREATE TABLE IF NOT EXISTS web_sessions (
  id_hash text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  last_seen_at timestamptz
);

CREATE INDEX IF NOT EXISTS web_sessions_user_id_idx ON web_sessions(user_id);

CREATE INDEX IF NOT EXISTS web_sessions_expires_at_idx ON web_sessions(expires_at);

CREATE TABLE IF NOT EXISTS oidc_login_states (
  id_hash text PRIMARY KEY,
  state text NOT NULL,
  nonce text NOT NULL,
  code_verifier text NOT NULL,
  return_to text NOT NULL DEFAULT '/dashboard',
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS oidc_login_states_expires_at_idx ON oidc_login_states(expires_at);

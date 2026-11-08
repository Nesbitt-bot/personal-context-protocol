import { db } from '@/lib/db';
import { sql } from 'drizzle-orm';
import { APP_VERSION } from '@/lib/version';

const appVersionSql = APP_VERSION.replace(/'/g, "''");

/**
 * Migration 011 (identity): Casdoor users, linked platform identities, claim
 * codes, browser login sessions and per-session ownership. Kept as its own
 * exported list so tests can check that `scripts/deploy-init.js` and
 * `drizzle/0011_identity.sql` carry the same statements.
 */
export const IDENTITY_SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS users (
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
  )`,
  `CREATE TABLE IF NOT EXISTS identities (
    principal text PRIMARY KEY,
    user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    link_method text NOT NULL CHECK (link_method IN ('claim', 'admin')),
    linked_at timestamptz NOT NULL DEFAULT now()
  )`,
  'CREATE INDEX IF NOT EXISTS identities_user_id_idx ON identities(user_id)',
  'ALTER TABLE sessions ADD COLUMN IF NOT EXISTS owner_user_id text REFERENCES users(id) ON DELETE SET NULL',
  'ALTER TABLE sessions ADD COLUMN IF NOT EXISTS principal text',
  "ALTER TABLE sessions ADD COLUMN IF NOT EXISTS class text NOT NULL DEFAULT 'unattributed' CHECK (class IN ('trusted', 'unattributed', 'group'))",
  'CREATE INDEX IF NOT EXISTS sessions_owner_user_id_idx ON sessions(owner_user_id)',
  'CREATE INDEX IF NOT EXISTS sessions_principal_idx ON sessions(principal)',
  `CREATE TABLE IF NOT EXISTS claims (
    id text PRIMARY KEY,
    code_hash text NOT NULL UNIQUE,
    session_id text NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    principal text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    redeemed_by text REFERENCES users(id) ON DELETE SET NULL,
    redeemed_at timestamptz
  )`,
  'CREATE INDEX IF NOT EXISTS claims_session_id_idx ON claims(session_id)',
  `CREATE TABLE IF NOT EXISTS claim_attempts (
    id text PRIMARY KEY,
    user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    succeeded boolean NOT NULL,
    attempted_at timestamptz NOT NULL DEFAULT now()
  )`,
  'CREATE INDEX IF NOT EXISTS claim_attempts_user_time_idx ON claim_attempts(user_id, attempted_at)',
  `CREATE TABLE IF NOT EXISTS web_sessions (
    id_hash text PRIMARY KEY,
    user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    csrf_hash text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    last_seen_at timestamptz
  )`,
  'CREATE INDEX IF NOT EXISTS web_sessions_user_id_idx ON web_sessions(user_id)',
  'CREATE INDEX IF NOT EXISTS web_sessions_expires_at_idx ON web_sessions(expires_at)',
  `CREATE TABLE IF NOT EXISTS oidc_login_states (
    id_hash text PRIMARY KEY,
    state text NOT NULL,
    nonce text NOT NULL,
    code_verifier text NOT NULL,
    return_to text NOT NULL DEFAULT '/dashboard',
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS oidc_login_states_expires_at_idx ON oidc_login_states(expires_at)',
];

/**
 * Migration 012 (service sync): hashed service credentials for channel
 * plugins, server-side turn grants looked up by OpenClaw session key, and an
 * idempotency ledger for synced turns.
 */
export const SERVICE_SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS service_credentials (
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
  )`,
  'CREATE INDEX IF NOT EXISTS service_credentials_prefix_idx ON service_credentials(token_prefix)',
  `CREATE TABLE IF NOT EXISTS turn_grants (
    id text PRIMARY KEY,
    credential_id text NOT NULL REFERENCES service_credentials(id) ON DELETE CASCADE,
    session_key text NOT NULL,
    principal text NOT NULL,
    home_session_id text NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    readable_session_ids_json jsonb NOT NULL DEFAULT '[]',
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    revoked_at timestamptz
  )`,
  'CREATE INDEX IF NOT EXISTS turn_grants_lookup_idx ON turn_grants(credential_id, session_key, expires_at)',
  'CREATE INDEX IF NOT EXISTS turn_grants_home_session_idx ON turn_grants(home_session_id)',
  `CREATE TABLE IF NOT EXISTS synced_turns (
    session_id text NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    external_key text NOT NULL,
    first_ordinal integer NOT NULL,
    message_count integer NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (session_id, external_key)
  )`,
];

/**
 * Migration 013 (projects): cross-machine projects mapped one-to-one to the
 * OpenCode session-manager's canonical project identity, their per-machine
 * workspaces, explicit name aliases, the per-session project link and task
 * context, per-field sync clocks, the conflict log and pending AI merge
 * tasks. Additive only: new tables, nullable or defaulted columns, indexes.
 */
export const PROJECT_SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS projects (
    id text PRIMARY KEY,
    canonical_key text NOT NULL UNIQUE,
    display_name text NOT NULL,
    description text,
    git_remotes_json jsonb NOT NULL DEFAULT '[]',
    owner_user_id text REFERENCES users(id) ON DELETE SET NULL,
    sync_clock_json jsonb NOT NULL DEFAULT '{}',
    archived boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
  'CREATE INDEX IF NOT EXISTS projects_owner_user_id_idx ON projects(owner_user_id)',
  `CREATE TABLE IF NOT EXISTS project_aliases (
    alias_key text PRIMARY KEY,
    project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    source text NOT NULL DEFAULT 'manual',
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  'CREATE INDEX IF NOT EXISTS project_aliases_project_id_idx ON project_aliases(project_id)',
  `CREATE TABLE IF NOT EXISTS project_workspaces (
    id text PRIMARY KEY,
    project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    device_id text NOT NULL,
    device_label text,
    device_kind text NOT NULL CHECK (device_kind IN ('openclaw-container', 'linux', 'linux-remote', 'windows', 'macos')),
    directory text NOT NULL,
    default_branch text,
    last_seen_at timestamptz,
    sync_clock_json jsonb NOT NULL DEFAULT '{}',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (project_id, device_id, directory)
  )`,
  'CREATE INDEX IF NOT EXISTS project_workspaces_device_directory_idx ON project_workspaces(device_id, directory)',
  'ALTER TABLE sessions ADD COLUMN IF NOT EXISTS project_id text REFERENCES projects(id) ON DELETE SET NULL',
  'ALTER TABLE sessions ADD COLUMN IF NOT EXISTS context_title text',
  'ALTER TABLE sessions ADD COLUMN IF NOT EXISTS context_summary text',
  "ALTER TABLE sessions ADD COLUMN IF NOT EXISTS sync_clock_json jsonb NOT NULL DEFAULT '{}'",
  'CREATE INDEX IF NOT EXISTS sessions_project_id_idx ON sessions(project_id)',
  'ALTER TABLE messages ADD COLUMN IF NOT EXISTS external_message_id text',
  'CREATE UNIQUE INDEX IF NOT EXISTS messages_session_external_message_idx ON messages(session_id, external_message_id) WHERE external_message_id IS NOT NULL',
  `CREATE TABLE IF NOT EXISTS sync_conflicts (
    id text PRIMARY KEY,
    entity_type text NOT NULL CHECK (entity_type IN ('session', 'project')),
    entity_id text NOT NULL,
    field text NOT NULL,
    reason text NOT NULL,
    kept_value_json jsonb,
    kept_at timestamptz,
    kept_device text,
    lost_value_json jsonb,
    lost_at timestamptz,
    lost_device text,
    status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'dismissed')),
    created_at timestamptz NOT NULL DEFAULT now(),
    resolved_at timestamptz,
    resolved_by text
  )`,
  'CREATE INDEX IF NOT EXISTS sync_conflicts_entity_idx ON sync_conflicts(entity_type, entity_id)',
  'CREATE INDEX IF NOT EXISTS sync_conflicts_status_idx ON sync_conflicts(status)',
  `CREATE TABLE IF NOT EXISTS merge_tasks (
    id text PRIMARY KEY,
    conflict_id text REFERENCES sync_conflicts(id) ON DELETE SET NULL,
    entity_type text NOT NULL CHECK (entity_type IN ('session', 'project')),
    entity_id text NOT NULL,
    field text NOT NULL,
    versions_json jsonb NOT NULL,
    instructions text,
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'cancelled')),
    requested_by text NOT NULL,
    result_value_json jsonb,
    completed_by text,
    created_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz
  )`,
  'CREATE INDEX IF NOT EXISTS merge_tasks_status_idx ON merge_tasks(status, created_at)',
];

/**
 * Migration 014 (broker): credential kinds (channel plugins, the AstrBot
 * ingress credential, the loopback broker) and the broker's delegate (the
 * OpenClaw plugin credential allowed to read broker turn grants); broker turn
 * grants (origin, agent, delegate, turn external key); the stamp replay
 * ledger. Additive only.
 */
export const BROKER_SCHEMA_STATEMENTS = [
  "ALTER TABLE service_credentials ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'channel' CHECK (kind IN ('channel', 'ingress', 'broker'))",
  'ALTER TABLE service_credentials ADD COLUMN IF NOT EXISTS delegate_credential_id text REFERENCES service_credentials(id) ON DELETE SET NULL',
  "ALTER TABLE turn_grants ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'service' CHECK (origin IN ('service', 'broker'))",
  'ALTER TABLE turn_grants ADD COLUMN IF NOT EXISTS agent text',
  'ALTER TABLE turn_grants ADD COLUMN IF NOT EXISTS delegate_credential_id text REFERENCES service_credentials(id) ON DELETE SET NULL',
  'ALTER TABLE turn_grants ADD COLUMN IF NOT EXISTS external_key text',
  'ALTER TABLE turn_grants ADD COLUMN IF NOT EXISTS broker_credential_id text REFERENCES service_credentials(id) ON DELETE SET NULL',
  `CREATE TABLE IF NOT EXISTS broker_replay (
      credential_id text NOT NULL REFERENCES service_credentials(id) ON DELETE CASCADE,
      nonce text NOT NULL,
      seen_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (credential_id, nonce)
    )`,
  'CREATE INDEX IF NOT EXISTS broker_replay_seen_at_idx ON broker_replay(seen_at)',
];

export const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS app_instance (
    id text PRIMARY KEY DEFAULT 'instance_1',
    created_at timestamptz NOT NULL DEFAULT now(),
    initialized_at timestamptz,
    version text NOT NULL DEFAULT '${appVersionSql}'
  )`,
  `CREATE TABLE IF NOT EXISTS ui_auth (
    id text PRIMARY KEY DEFAULT 'ui_1',
    token_hash text NOT NULL,
    salt text NOT NULL,
    source text NOT NULL DEFAULT 'deploy',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    last_used_at timestamptz
  )`,
  `CREATE TABLE IF NOT EXISTS topics (
    id text PRIMARY KEY,
    external_key text UNIQUE,
    title text NOT NULL,
    description text,
    archived boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    id text PRIMARY KEY,
    external_key text UNIQUE,
    topic_id text REFERENCES topics(id),
    title text NOT NULL,
    mode text NOT NULL DEFAULT 'wild',
    public boolean NOT NULL DEFAULT false,
    archived boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    last_message_at timestamptz
  )`,
  `CREATE TABLE IF NOT EXISTS session_tokens (
    id text PRIMARY KEY,
    session_id text NOT NULL REFERENCES sessions(id),
    token_hash text NOT NULL,
    salt text NOT NULL,
    name text NOT NULL,
    can_rename_session boolean NOT NULL DEFAULT false,
    revoked boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz,
    last_used_at timestamptz,
    token_prefix text
  )`,
  `CREATE TABLE IF NOT EXISTS messages (
    id text PRIMARY KEY,
    session_id text NOT NULL REFERENCES sessions(id),
    topic_id text REFERENCES topics(id),
    ordinal integer NOT NULL,
    role text NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'tool', 'correction')),
    content text NOT NULL,
    content_type text NOT NULL DEFAULT 'markdown' CHECK (content_type IN ('text', 'markdown', 'json')),
    provider text,
    base_model text,
    provider_timestamp timestamptz,
    observed_at timestamptz NOT NULL,
    source_json jsonb,
    metadata_json jsonb DEFAULT '{}',
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (session_id, ordinal)
  )`,
  `CREATE TABLE IF NOT EXISTS compactions (
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
  )`,
  `CREATE TABLE IF NOT EXISTS events (
    id text PRIMARY KEY,
    session_id text REFERENCES sessions(id),
    topic_id text REFERENCES topics(id),
    action text NOT NULL,
    actor text NOT NULL,
    details_json jsonb DEFAULT '{}',
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  // Defensive upgrade for deployments initialized before token expiration existed.
  'ALTER TABLE session_tokens ADD COLUMN IF NOT EXISTS expires_at timestamptz',
  // Admin credential provenance. Added nullable so pre-existing credentials can
  // be marked 'user' (never auto-rotated) instead of being treated as a
  // deploy-generated token that the next deploy would replace.
  'ALTER TABLE ui_auth ADD COLUMN IF NOT EXISTS source text',
  "UPDATE ui_auth SET source = 'user' WHERE source IS NULL",
  // Allow uncategorized sessions (and their messages) to have no topic.
  'ALTER TABLE sessions ALTER COLUMN topic_id DROP NOT NULL',
  'ALTER TABLE messages ALTER COLUMN topic_id DROP NOT NULL',
  // Public read-only sharing of a session.
  'ALTER TABLE sessions ADD COLUMN IF NOT EXISTS public boolean NOT NULL DEFAULT false',
  // Recording mode the agent is told to honor (wild = may redact, exact = verbatim).
  "ALTER TABLE sessions ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'wild'",
  'ALTER TABLE topics ADD COLUMN IF NOT EXISTS external_key text',
  'ALTER TABLE sessions ADD COLUMN IF NOT EXISTS external_key text',
  `CREATE TABLE IF NOT EXISTS schema_migrations (
    version text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now(),
    checksum text
  )`,
  'CREATE INDEX IF NOT EXISTS messages_session_id_idx ON messages(session_id)',
  'CREATE INDEX IF NOT EXISTS messages_topic_id_idx ON messages(topic_id)',
  'CREATE INDEX IF NOT EXISTS sessions_topic_id_idx ON sessions(topic_id)',
  'CREATE INDEX IF NOT EXISTS session_tokens_hash_idx ON session_tokens(token_prefix)',
  'CREATE INDEX IF NOT EXISTS session_tokens_session_id_idx ON session_tokens(session_id)',
  'CREATE INDEX IF NOT EXISTS events_session_id_idx ON events(session_id)',
  'CREATE INDEX IF NOT EXISTS events_created_at_idx ON events(created_at)',
  'CREATE INDEX IF NOT EXISTS compactions_session_id_idx ON compactions(session_id)',
  'CREATE UNIQUE INDEX IF NOT EXISTS topics_external_key_idx ON topics(external_key) WHERE external_key IS NOT NULL',
  'CREATE UNIQUE INDEX IF NOT EXISTS sessions_external_key_idx ON sessions(external_key) WHERE external_key IS NOT NULL',
  `CREATE TABLE IF NOT EXISTS scoped_tokens (
    id text PRIMARY KEY,
    token_hash text NOT NULL,
    salt text NOT NULL,
    token_prefix text,
    name text NOT NULL,
    scope text NOT NULL CHECK (scope IN ('global', 'folder', 'session')),
    folder_id text REFERENCES topics(id),
    session_id text REFERENCES sessions(id),
    permissions_json jsonb DEFAULT '{}',
    revoked boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz,
    last_used_at timestamptz
  )`,
  'CREATE INDEX IF NOT EXISTS scoped_tokens_prefix_idx ON scoped_tokens(token_prefix)',
  'CREATE INDEX IF NOT EXISTS scoped_tokens_folder_idx ON scoped_tokens(folder_id)',
  'CREATE INDEX IF NOT EXISTS scoped_tokens_session_idx ON scoped_tokens(session_id)',
  `CREATE TABLE IF NOT EXISTS session_links (
    id text PRIMARY KEY,
    session_a text NOT NULL REFERENCES sessions(id),
    session_b text NOT NULL REFERENCES sessions(id),
    label text,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (session_a, session_b)
  )`,
  'CREATE INDEX IF NOT EXISTS session_links_a_idx ON session_links(session_a)',
  'CREATE INDEX IF NOT EXISTS session_links_b_idx ON session_links(session_b)',
  ...IDENTITY_SCHEMA_STATEMENTS,
  ...SERVICE_SCHEMA_STATEMENTS,
  ...PROJECT_SCHEMA_STATEMENTS,
  ...BROKER_SCHEMA_STATEMENTS,
    `CREATE TABLE IF NOT EXISTS message_sync_keys (
    session_id text NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    external_id text NOT NULL,
    message_id text NOT NULL UNIQUE REFERENCES messages(id) ON DELETE CASCADE,
    PRIMARY KEY (session_id, external_id)
)`,
    `CREATE TABLE IF NOT EXISTS attachments (
  id text PRIMARY KEY,
  session_id text NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  message_id text NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  external_key text NOT NULL,
  blob_sha256 text NOT NULL,
  upload_sha256 text NOT NULL,
  size_bytes integer NOT NULL,
  mime_type text NOT NULL,
  filename text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(session_id, external_key)
)`,
    `CREATE INDEX IF NOT EXISTS attachments_message_idx ON attachments(message_id)`,
    `CREATE INDEX IF NOT EXISTS attachments_blob_idx ON attachments(blob_sha256)`,

];

/**
 * Creates the Neon/Postgres schema needed before setup can insert the first app
 * instance and UI token. Each statement is idempotent so setup/status can call it
 * whenever credentials are available.
 */
export async function ensureDatabaseSchema() {
  // Statements are idempotent; once per process is enough after a success.
  if (!schemaReady) {
    schemaReady = applySchema().catch((error) => {
      schemaReady = null;
      throw error;
    });
  }
  return schemaReady;
}

let schemaReady: Promise<void> | null = null;

async function applySchema() {
  for (const statement of SCHEMA_STATEMENTS) {
    await db.execute(sql.raw(statement));
  }

  await db.execute(sql`
    INSERT INTO schema_migrations (version, checksum)
    VALUES ('001_initial', 'initial_schema')
    ON CONFLICT (version) DO NOTHING
  `);

  await db.execute(sql`
    INSERT INTO schema_migrations (version, checksum)
    VALUES ('002_agent_recording', 'compactions_and_token_expiration')
    ON CONFLICT (version) DO NOTHING
  `);

  await db.execute(sql`
    INSERT INTO schema_migrations (version, checksum)
    VALUES ('003_admin_token_source', 'ui_auth_source_provenance')
    ON CONFLICT (version) DO NOTHING
  `);

  await db.execute(sql`
    INSERT INTO schema_migrations (version, checksum)
    VALUES ('004_optional_topic', 'nullable_session_and_message_topic')
    ON CONFLICT (version) DO NOTHING
  `);

  // One-time correction (migration 005): migration 003 over-marked pre-existing
  // credentials as 'user' (preserved forever). Reset them to 'deploy' so the
  // default per-deploy rotation applies; only Settings-set tokens (tagged 'user'
  // after this point) are preserved. Self-guarded — runs once per database.
  await db.execute(sql`
    WITH applied AS (
      INSERT INTO schema_migrations (version, checksum)
      VALUES ('005_default_token_rotates', 'reset_legacy_user_source')
      ON CONFLICT (version) DO NOTHING
      RETURNING version
    )
    UPDATE ui_auth SET source = 'deploy', updated_at = now()
    WHERE source = 'user' AND EXISTS (SELECT 1 FROM applied)
  `);

  await db.execute(sql`
    INSERT INTO schema_migrations (version, checksum)
    VALUES ('006_public_session', 'session_public_sharing')
    ON CONFLICT (version) DO NOTHING
  `);

  await db.execute(sql`
    INSERT INTO schema_migrations (version, checksum)
    VALUES ('007_session_mode', 'session_recording_mode')
    ON CONFLICT (version) DO NOTHING
  `);

  await db.execute(sql`
    INSERT INTO schema_migrations (version, checksum)
    VALUES ('008_scoped_tokens', 'unified_scoped_token_layer')
    ON CONFLICT (version) DO NOTHING
  `);

  await db.execute(sql`
    INSERT INTO schema_migrations (version, checksum)
    VALUES ('009_session_links', 'session_to_session_links')
    ON CONFLICT (version) DO NOTHING
  `);

  await db.execute(sql`
    INSERT INTO schema_migrations (version, checksum)
    VALUES ('010_external_session_keys', 'stable_external_topic_and_session_keys')
    ON CONFLICT (version) DO NOTHING
  `);

  await db.execute(sql`
    INSERT INTO schema_migrations (version, checksum)
    VALUES ('011_identity', 'oidc_users_identities_claims_session_ownership')
    ON CONFLICT (version) DO NOTHING
  `);

  await db.execute(sql`
    INSERT INTO schema_migrations (version, checksum)
    VALUES ('012_service_sync', 'service_credentials_turn_grants_synced_turns')
    ON CONFLICT (version) DO NOTHING
  `);

  await db.execute(sql`
    INSERT INTO schema_migrations (version, checksum)
    VALUES ('013_projects', 'projects_workspaces_aliases_sync_conflicts_merge_tasks')
    ON CONFLICT (version) DO NOTHING
  `);

  await db.execute(sql`
    INSERT INTO schema_migrations (version, checksum)
    VALUES ('016_message_sync_keys', 'legacy_identity_ledger_v1'), ('015_attachments', 'session_scoped_sanitized_media_v1'), ('014_broker', 'credential_kinds_broker_grants_replay_ledger')
    ON CONFLICT (version) DO NOTHING
  `);
}

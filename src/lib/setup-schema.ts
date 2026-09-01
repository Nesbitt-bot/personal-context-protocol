import { db } from '@/lib/db';
import { sql } from 'drizzle-orm';
import { APP_VERSION } from '@/lib/version';

const appVersionSql = APP_VERSION.replace(/'/g, "''");

const SCHEMA_STATEMENTS = [
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
    title text NOT NULL,
    description text,
    archived boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    id text PRIMARY KEY,
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
];

/**
 * Creates the Neon/Postgres schema needed before setup can insert the first app
 * instance and UI token. Each statement is idempotent so setup/status can call it
 * whenever credentials are available.
 */
export async function ensureDatabaseSchema() {
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
}

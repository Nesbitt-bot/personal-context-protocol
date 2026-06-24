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
    topic_id text NOT NULL REFERENCES topics(id),
    title text NOT NULL,
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
    topic_id text NOT NULL REFERENCES topics(id),
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
}

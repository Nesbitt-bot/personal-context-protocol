const crypto = require('crypto');
const { promisify } = require('util');
const postgres = require('postgres');
const { readProjectVersion } = require('./project-version');

const scryptAsync = promisify(crypto.scrypt);
const PROJECT = 'personal-context-protocol';
const VERSION = readProjectVersion();
const MIN_ADMIN_TOKEN_LENGTH = 32;

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function generateSalt() {
  return crypto.randomBytes(16).toString('hex');
}

async function hashToken(token, salt) {
  const hash = await scryptAsync(token, salt, 32);
  return `scrypt:${hash.toString('hex')}`;
}

function validateAdminToken(token) {
  return token.trim().length >= MIN_ADMIN_TOKEN_LENGTH;
}

function logHeader(title) {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`  ${PROJECT} v${VERSION} - ${title}`);
  console.log(`${'='.repeat(70)}\n`);
}

function logGeneratedAdminToken(token, reason) {
  logHeader('generated deployment admin token');
  console.log(`Reason: ${reason}`);
  console.log(`Admin token: ${token}`);
  console.log('Log in with this token, then change it immediately in Settings before using the dashboard.');
  console.log('After rotation, the real admin credential will not be printed in logs.');
  console.log(`\n${'='.repeat(70)}\n`);
}

function schemaStatements(version) {
  const escapedVersion = version.replace(/'/g, "''");
  return [
    `CREATE TABLE IF NOT EXISTS app_instance (
      id text PRIMARY KEY DEFAULT 'instance_1',
      created_at timestamptz NOT NULL DEFAULT now(),
      initialized_at timestamptz,
      version text NOT NULL DEFAULT '${escapedVersion}'
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
    `CREATE TABLE IF NOT EXISTS events (
      id text PRIMARY KEY,
      session_id text REFERENCES sessions(id),
      topic_id text REFERENCES topics(id),
      action text NOT NULL,
      actor text NOT NULL,
      details_json jsonb DEFAULT '{}',
      created_at timestamptz NOT NULL DEFAULT now()
    )`,
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
  ];
}

async function storeAdminToken(sql, token) {
  const salt = generateSalt();
  const tokenHash = await hashToken(token.trim(), salt);

  await sql`
    INSERT INTO ui_auth (id, token_hash, salt, created_at, updated_at)
    VALUES ('ui_1', ${tokenHash}, ${salt}, now(), now())
    ON CONFLICT (id) DO UPDATE SET
      token_hash = EXCLUDED.token_hash,
      salt = EXCLUDED.salt,
      updated_at = now()
  `;
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.log(`${PROJECT} v${VERSION} deploy initialization skipped: DATABASE_URL is not configured.`);
    return;
  }

  const configuredAdminToken = (process.env.PCP_ADMIN_TOKEN || '').trim();
  if (configuredAdminToken && !validateAdminToken(configuredAdminToken)) {
    console.error(`${PROJECT} v${VERSION} deploy initialization failed: PCP_ADMIN_TOKEN must be at least ${MIN_ADMIN_TOKEN_LENGTH} characters.`);
    process.exit(1);
  }

  const sql = postgres(databaseUrl, { connect_timeout: 10, max: 1 });
  try {
    for (const statement of schemaStatements(VERSION)) {
      await sql.unsafe(statement);
    }

    await sql`
      INSERT INTO schema_migrations (version, checksum)
      VALUES ('001_initial', 'initial_schema')
      ON CONFLICT (version) DO NOTHING
    `;

    const existingCredential = await sql`SELECT id FROM ui_auth WHERE id = 'ui_1' LIMIT 1`;
    if (configuredAdminToken) {
      await storeAdminToken(sql, configuredAdminToken);
      console.log(`${PROJECT} v${VERSION} deploy initialization: database ready; admin token loaded from PCP_ADMIN_TOKEN.`);
    } else if (existingCredential.length === 0) {
      const generatedToken = generateToken();
      await storeAdminToken(sql, generatedToken);
      logGeneratedAdminToken(generatedToken, 'PCP_ADMIN_TOKEN was not configured and the database did not have an admin credential.');
    } else {
      console.log(`${PROJECT} v${VERSION} deploy initialization: database ready; existing admin credential preserved.`);
    }

    await sql`
      INSERT INTO app_instance (id, initialized_at, version)
      VALUES ('instance_1', now(), ${VERSION})
      ON CONFLICT (id) DO UPDATE SET
        initialized_at = COALESCE(app_instance.initialized_at, EXCLUDED.initialized_at),
        version = EXCLUDED.version
    `;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : 'unknown error';
  console.error(`${PROJECT} v${VERSION} deploy initialization failed: database bootstrap / build-start initialization - ${message}`);
  process.exit(1);
});

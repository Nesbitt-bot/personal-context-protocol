# PCP Migrations Guide

## Overview

PCP uses Drizzle ORM for database migrations. All migrations are applied automatically on first run.

## Migration structure

Migrations are stored in `drizzle/` directory:
- `0000_initial.sql` - Initial schema creation
- `0001_*.sql` - Subsequent migrations

## Generating migrations

After schema changes:

```bash
npm run db:generate
```

This creates a new migration file in `drizzle/` with:
- Schema changes
- Data preservation (no DROP statements)
- Idempotent operations where possible

## Applying migrations

### Automatic (recommended)

The app checks migration status on startup and applies pending migrations automatically.

### Manual

```bash
npm run db:migrate
```

### Local development

```bash
# Set up local database
export DATABASE_URL=postgresql://localhost:5432/pcp_dev
npm run db:push  # Quick schema sync for dev
# or
npm run db:migrate  # Apply migrations
```

## Migration principles

### 1. No destructive changes

**Wrong:**
```sql
DROP TABLE messages;
```

**Correct:**
```sql
-- Add new column instead
ALTER TABLE messages ADD COLUMN metadata_json JSONB DEFAULT '{}';
```

### 2. Preserve data

Migrations should never delete existing data. If a column is no longer needed, mark it deprecated but don't remove it.

### 3. Idempotent where possible

Use `IF EXISTS`, `IF NOT EXISTS`, or check conditions before applying changes.

### 4. Test migrations

Always test migrations on a fresh database or copy of production data before deploying.

## Current migrations

### 0000_initial

Initial schema creation:
- `app_instance` table
- `ui_auth` table  
- `topics` table
- `sessions` table
- `session_tokens` table
- `messages` table
- `events` table
- `schema_migrations` table
- All indexes

### 0001_agent_recording

Agent recording-URL model (idempotent, data-preserving):
- `compactions` table for durable session summaries (additional records, never
  replacing raw messages)
- Defensive `ALTER TABLE session_tokens ADD COLUMN IF NOT EXISTS expires_at`
  (NULL means never expire; pre-existing tokens keep NULL)

The same statements run through the idempotent `ensureDatabaseSchema()` bootstrap
so fresh deploys and existing databases converge to the same schema.

### 0002_admin_token_source

Admin credential provenance (idempotent, lockout-safe):
- `ALTER TABLE ui_auth ADD COLUMN IF NOT EXISTS source text` (nullable)
- `UPDATE ui_auth SET source = 'user' WHERE source IS NULL` so a pre-existing
  credential is treated as user-managed and is never auto-rotated by a deploy

`source` is `deploy` (auto-generated, rotated each deploy), `env`
(`PCP_ADMIN_TOKEN`), or `user` (set in Settings). New installs default the
column to `deploy` and deploy initialization sets it explicitly.

### 0003_optional_topic

Uncategorized sessions (idempotent, data-preserving):
- `ALTER TABLE sessions ALTER COLUMN topic_id DROP NOT NULL`
- `ALTER TABLE messages ALTER COLUMN topic_id DROP NOT NULL`

A session (and its denormalized messages) may now have no topic. The foreign key
remains; NULL is simply allowed. Existing rows keep their `topic_id`.

### 0004_default_token_rotates

Corrects the 003 backfill. Migration 003 marked pre-existing admin credentials
`source = 'user'`, which preserved them forever and stopped per-deploy rotation.
The intended default is to rotate the deploy-generated token each deploy; only a
token set in Settings (tagged `user` after this migration) is preserved. A
one-time, self-guarded data-modifying CTE resets the mis-marked rows to
`deploy`:

```sql
WITH applied AS (
  INSERT INTO schema_migrations (version, checksum)
  VALUES ('005_default_token_rotates', 'reset_legacy_user_source')
  ON CONFLICT (version) DO NOTHING
  RETURNING version
)
UPDATE ui_auth SET source = 'deploy', updated_at = now()
WHERE source = 'user' AND EXISTS (SELECT 1 FROM applied);
```

Because the UPDATE runs only when the migration record is newly inserted, it
never re-clobbers a genuine Settings-set token created after it applies.

### 0005_public_session

Public read-only sharing (idempotent, data-preserving):
- `ALTER TABLE sessions ADD COLUMN IF NOT EXISTS public boolean NOT NULL DEFAULT false`

Existing sessions default to private. When `public` is true the session is
readable without the admin token via `GET /api/v1/public/sessions/:id`.

### 0006_session_mode

Per-session recording mode (idempotent, data-preserving):
- `ALTER TABLE sessions ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'wild'`

`wild` (default) lets the agent redact secrets it judges unsafe; `exact` asks for
verbatim recording. Existing sessions default to `wild`.

## Checking migration status

```bash
# Check if migrations are applied
npm run db:studio

# Or query directly
SELECT * FROM schema_migrations ORDER BY applied_at;
```

## Rollback (if needed)

Drizzle doesn't support automatic rollbacks. Manual approach:

1. Identify problematic migration
2. Write reverse migration manually
3. Apply reverse migration
4. Document the issue

**Prevention**: Test migrations thoroughly before deployment.

## Version tracking

Schema version is stored in `app_instance.version` and updated when migrations are applied.

Current version: `0.1.12`

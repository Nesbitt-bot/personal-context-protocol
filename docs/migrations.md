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

Current version: `0.1.0`

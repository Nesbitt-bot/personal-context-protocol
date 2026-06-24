# PCP Data Model

## Overview

Personal Context Protocol uses PostgreSQL via Neon. This document describes the schema, relationships, and constraints.

## Design principles

1. **Immutable messages**: Messages are never updated or deleted
2. **Scoped tokens**: Each session token is bound to exactly one session
3. **Audit trail**: Every action is logged as an event
4. **Stable IDs**: IDs use `prefix_timestamp_id` format for readability
5. **Soft deletes**: Archive/revoke flags instead of hard deletes

## Tables

### app_instance

Single-row table tracking the application instance.

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT | Always `instance_1` |
| `created_at` | TIMESTAMPTZ | Instance creation time |
| `initialized_at` | TIMESTAMPTZ | When setup was completed |
| `version` | TEXT | Schema version |

**Constraints**:
- Primary key: `id`
- Always exactly one row

**Example**:
```json
{
  "id": "instance_1",
  "created_at": "2026-06-22T22:45:00Z",
  "initialized_at": "2026-06-22T22:50:00Z",
  "version": "0.1.3"
}
```

### ui_auth

Stores the UI admin token hash.

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT | Always `ui_1` |
| `token_hash` | TEXT | Salted hash of UI token |
| `salt` | TEXT | Salt for hashing |
| `created_at` | TIMESTAMPTZ | Token creation time |
| `updated_at` | TIMESTAMPTZ | Last rotation time |
| `last_used_at` | TIMESTAMPTZ | Last successful auth |

**Constraints**:
- Primary key: `id`
- Always exactly one row

**Note**: The raw UI token is shown only during setup, never stored.

### topics

Human-managed topics/categories for organizing sessions.

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT | `topic_<timestamp>_<id>` |
| `title` | TEXT | Human-readable title |
| `description` | TEXT | Optional description |
| `archived` | BOOLEAN | Soft delete flag |
| `created_at` | TIMESTAMPTZ | Creation time |
| `updated_at` | TIMESTAMPTZ | Last update time |

**Constraints**:
- Primary key: `id`
- Unique: `title` (where `archived = false`)
- Index: `archived`

**AI access**: AI tokens CANNOT create, rename, delete, or archive topics.

### sessions

AI recording sessions within topics.

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT | `ses_<timestamp>_<id>` |
| `topic_id` | TEXT | Parent topic (foreign key) |
| `title` | TEXT | Session title (may be suggested by AI) |
| `archived` | BOOLEAN | Soft delete flag |
| `created_at` | TIMESTAMPTZ | Creation time |
| `updated_at` | TIMESTAMPTZ | Last update time |
| `last_message_at` | TIMESTAMPTZ | Last message timestamp |

**Constraints**:
- Primary key: `id`
- Foreign key: `topic_id → topics.id`
- Index: `topic_id`
- Index: `archived`

**AI access**: AI can only view/append to sessions for which it has a valid token.

### session_tokens

Scoped tokens for AI agents.

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT | `tok_<timestamp>_<id>` |
| `session_id` | TEXT | Bound session (foreign key) |
| `token_hash` | TEXT | Salted hash of token |
| `salt` | TEXT | Salt for hashing |
| `name` | TEXT | Human-readable name (e.g., "Claude session") |
| `can_rename_session` | BOOLEAN | Allow session title suggestions |
| `revoked` | BOOLEAN | Soft revoke flag |
| `created_at` | TIMESTAMPTZ | Creation time |
| `expires_at` | TIMESTAMPTZ | Expiry; NULL means never expire |
| `last_used_at` | TIMESTAMPTZ | Last successful use |
| `token_prefix` | TEXT | First 16 chars for fast lookup |

**Expiration**: Tokens may be created with `expires_in` of `1h`, `24h`, `7d`
(default), `30d`, or `never`. `never` stores a NULL `expires_at`; tokens created
before expiration existed also have NULL and are treated as never-expiring.
Expired tokens are rejected at authentication time. Status is derived as
`active`, `expired`, or `revoked`.

**Constraints**:
- Primary key: `id`
- Foreign key: `session_id → sessions.id`
- Index: `session_id`
- Index: `token_hash` (for lookup)
- Index: `revoked`

**Capabilities**:
- Always: append messages to bound session
- If `can_rename_session = true`: suggest session title
- Never: access other sessions, manage topics, delete messages

**Note**: Raw token is shown only at creation, never stored.

### messages

Immutable conversation messages.

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT | `msg_<timestamp>_<id>` |
| `session_id` | TEXT | Parent session (foreign key) |
| `topic_id` | TEXT | Denormalized topic (foreign key) |
| `ordinal` | INTEGER | Order within session (1, 2, 3...) |
| `role` | TEXT | `user`, `assistant`, `system`, `tool`, `correction` |
| `content` | TEXT | Message content (markdown/text) |
| `content_type` | TEXT | `text`, `markdown`, `json` |
| `provider` | TEXT | AI provider (e.g., "anthropic", "openai") |
| `base_model` | TEXT | Model name (e.g., "claude-3-5-sonnet") |
| `provider_timestamp` | TIMESTAMPTZ | Provider's timestamp (if available) |
| `observed_at` | TIMESTAMPTZ | When recorded locally |
| `source_json` | JSONB | Raw provider response (optional) |
| `metadata_json` | JSONB | Extra metadata |
| `created_at` | TIMESTAMPTZ | Insertion time |

**Constraints**:
- Primary key: `id`
- Foreign key: `session_id → sessions.id`
- Foreign key: `topic_id → topics.id`
- Unique: `(session_id, ordinal)`
- Index: `session_id`
- Index: `topic_id`
- Index: `role`

**Immutability**: Messages are NEVER updated or deleted. Corrections are new messages.

**Content**:
- Store pure text/markdown only
- If provider timestamp unavailable, use `observed_at` and `"unknown"` for provider/model
- Always populate `observed_at`

**Roles**:
- `user`: Human message
- `assistant`: AI message
- `system`: System instructions
- `tool`: Tool response
- `correction`: Correction to previous message

### compactions

Durable session summaries stored alongside raw messages, for when full message
upload is impossible. Compactions are **additional** records and never replace
messages.

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT | `cmp_<timestamp>_<id>` |
| `session_id` | TEXT | Parent session (foreign key) |
| `summary` | TEXT | Required summary text |
| `timeline_json` | JSONB | Optional timeline |
| `decisions_json` | JSONB | Optional decisions |
| `requirements_json` | JSONB | Optional requirements |
| `open_questions_json` | JSONB | Optional open questions |
| `artifacts_json` | JSONB | Optional artifacts |
| `warnings_json` | JSONB | Optional warnings |
| `provider` | TEXT | AI provider |
| `base_model` | TEXT | Model name |
| `created_at` | TIMESTAMPTZ | Insertion time |
| `metadata_json` | JSONB | Extra metadata |

**Constraints**:
- Primary key: `id`
- Foreign key: `session_id → sessions.id`
- Index: `session_id`

### events

Audit trail for all actions.

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT | `evt_<timestamp>_<id>` |
| `session_id` | TEXT | Related session (nullable) |
| `topic_id` | TEXT | Related topic (nullable) |
| `action` | TEXT | Action type |
| `actor` | TEXT | Who performed action (`human`, `ai:<session_id>`) |
| `details_json` | JSONB | Action details |
| `created_at` | TIMESTAMPTZ | When action occurred |

**Constraints**:
- Primary key: `id`
- Index: `session_id`
- Index: `topic_id`
- Index: `action`
- Index: `created_at`

**Actions**:
- `session.created`
- `session.renamed`
- `session.archived`
- `token.created`
- `token.revoked`
- `message.appended`
- `compaction.recorded`
- `topic.created`
- `topic.renamed`
- `topic.archived`
- `user.authenticated`

### schema_migrations

Track applied migrations.

| Column | Type | Description |
|--------|------|-------------|
| `version` | TEXT | Migration version (e.g., "001_initial") |
| `applied_at` | TIMESTAMPTZ | When applied |
| `checksum` | TEXT | File checksum for validation |

**Constraints**:
- Primary key: `version`

## ID format

All IDs use `prefix_<timestamp>_<random>` format:

| Prefix | Table |
|--------|-------|
| `instance_` | app_instance |
| `ui_` | ui_auth |
| `topic_` | topics |
| `ses_` | sessions |
| `tok_` | session_tokens |
| `msg_` | messages |
| `cmp_` | compactions |
| `evt_` | events |

**Example**: `topic_1719099900_a3f2b1c4`

This format:
- Is human-readable
- Sorts chronologically
- Doesn't reveal database internals (unlike sequential integers)
- Is unique across tables

## Relationships

```
app_instance (1) ──┐
ui_auth (1)        │
                   │
topics (N) ───┐    │
              │    │
              │    │
              └─┐  │
                │  │
sessions (N) ───┼──┘
                │
                ├── session_tokens (N)
                │
                ├── messages (N)
                │
                └── events (N)
```

## Indexes

### Performance-critical indexes

1. `messages(session_id, ordinal)` - Sequential message retrieval
2. `session_tokens(token_hash)` - Token validation (lookup by hash)
3. `sessions(topic_id, created_at DESC)` - Topic session listing
4. `events(session_id, created_at DESC)` - Event timeline

### Composite indexes

- `messages(topic_id, created_at DESC)` - Topic-level message search
- `session_tokens(session_id, revoked)` - Session token lookup

## Migrations

See [`docs/migrations.md`](migrations.md).

**Rules**:
- Never drop tables or columns in v0.1
- Never delete data
- Always backward-compatible
- Test on fresh DB before deployment

## Security considerations

### Token storage

- Never store raw tokens
- Always store salted hashes (Argon2 or bcrypt)
- Use per-token random salts
- Never log or return tokens after creation

### Message content

- Store as plain text/markdown
- No encryption in v0.1
- Provider secrets never enter database
- User data is trusted (single-user app)

### Access control

- Session tokens are scoped by foreign key
- Token validation checks session match
- Topic routes reject AI tokens (403)

## Example queries

### Get all messages for a session (chronological)

```sql
SELECT * 
FROM messages 
WHERE session_id = 'ses_1719099900_xxx'
ORDER BY ordinal ASC;
```

### Get session with topic info (admin view)

```sql
SELECT s.*, t.title as topic_title
FROM sessions s
JOIN topics t ON s.topic_id = t.id
WHERE s.id = 'ses_1719099900_xxx';
```

### Validate session token

```sql
SELECT id, session_id, can_rename_session
FROM session_tokens
WHERE token_hash = $1 AND revoked = false;
```

### Get recent events

```sql
SELECT * 
FROM events 
WHERE session_id = $1
ORDER BY created_at DESC
LIMIT 50;
```

## Version history

### v0.1.0 (initial)

- All tables listed above
- Soft deletes for topics, sessions, tokens
- Immutable messages
- Audit events
- Migration tracking

### v0.1.3 (agent recording URL)

- Added `compactions` table for durable session summaries
- Session access tokens gained expiration choices (`expires_at`, NULL = never)
- Agent recording-URL + token model with public protocol discovery

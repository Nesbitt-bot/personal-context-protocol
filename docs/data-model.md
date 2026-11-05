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
  "version": "0.1.15"
}
```

### ui_auth

Stores the UI admin token hash.

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT | Always `ui_1` |
| `token_hash` | TEXT | Salted hash of UI token |
| `salt` | TEXT | Salt for hashing |
| `source` | TEXT | Credential owner: `deploy`, `env`, or `user` |
| `created_at` | TIMESTAMPTZ | Token creation time |
| `updated_at` | TIMESTAMPTZ | Last rotation time |
| `last_used_at` | TIMESTAMPTZ | Last successful auth |

**Constraints**:
- Primary key: `id`
- Always exactly one row

**Source / rotation**: `deploy` tokens are auto-generated and rotated on every
deploy (the previous one stops working); `env` tokens come from
`PCP_ADMIN_TOKEN` and are reconciled each deploy; `user` tokens are set in
Settings and never auto-rotated. Precedence is environment > user > deploy.
The default for any credential not explicitly set in Settings (including
pre-existing ones) is `deploy`, so it rotates each deploy until the admin sets
their own token or `PCP_ADMIN_TOKEN`.

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

AI recording sessions, optionally within a topic.

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT | `ses_<timestamp>_<id>` |
| `topic_id` | TEXT | Parent topic (foreign key, **nullable**: NULL = uncategorized) |
| `title` | TEXT | Session title (may be suggested by AI) |
| `mode` | TEXT | Recording mode the agent is told to honor: `wild` (default) or `exact` |
| `public` | BOOLEAN | When true, a read-only view is available without the admin token |
| `archived` | BOOLEAN | Soft delete flag |
| `created_at` | TIMESTAMPTZ | Creation time |
| `updated_at` | TIMESTAMPTZ | Last update time |
| `last_message_at` | TIMESTAMPTZ | Last message timestamp |
| `owner_user_id` | TEXT | Owning Casdoor user (`users.id`, nullable, `ON DELETE SET NULL`); NULL = unowned (admin-only) |
| `principal` | TEXT | Platform identity the session belongs to, e.g. `telegram:8627151333` (nullable) |
| `class` | TEXT | `trusted` \| `unattributed` (default) \| `group` (admin-only, never claimable) |
| `project_id` | TEXT | Project this session belongs to (`projects.id`, nullable, `ON DELETE SET NULL`) |
| `context_title` | TEXT | Per-task context title within the project (nullable) |
| `context_summary` | TEXT | Per-task context summary (nullable) |
| `sync_clock_json` | JSONB | Per-field `{ at, device }` clocks of the sync conflict policy (default `{}`) |

**Constraints**:
- Primary key: `id`
- Foreign key: `topic_id → topics.id` (nullable)
- Foreign key: `owner_user_id → users.id` (nullable)
- Index: `owner_user_id`, `principal`
- Index: `topic_id`
- Index: `archived`

**Uncategorized**: a session may have no topic (`topic_id` NULL). The UI groups
these under "Uncategorized". Title uniqueness is scoped to the group — sessions
under the same topic, or all topic-less sessions.

**Public sharing**: when `public` is true, anyone can read the session and its
messages via `GET /api/v1/public/sessions/:id` and the `/s/:id` page, without the
admin UI token. Private (default) sessions return 404 from that endpoint so their
existence is not leaked. Tokens are never exposed on the public surface.

**Recording mode**: `wild` (default) tells the agent it may redact secrets it
judges unsafe; `exact` tells it to record verbatim (including credentials) for
faithful task migration. The mode is surfaced to the agent in the protocol
descriptor (`recording_mode` + `recording_guidance`) and the generated
instruction. It is guidance to the agent, not a server-side filter.

**AI access**: AI can only view/append to sessions for which it has a valid token.

### projects, project_aliases, project_workspaces

Cross-machine projects (migration 013, see [projects.md](projects.md)).

`projects`: `id` (`prj_...`), `canonical_key` (unique; `git:<host/owner/repo>`
or `name:<basename>`, lower-case), `display_name`, `description`,
`git_remotes_json` (normalized `host/owner/repo` list, only ever extended),
`owner_user_id` (nullable = admin-only, like sessions), `sync_clock_json`,
`archived`, `created_at`, `updated_at`.

`project_aliases`: `alias_key` (primary key, e.g. `name:old-folder`) →
`project_id`, `source`, `created_at`. An alias resolves to exactly one project.

`project_workspaces`: `id` (`pws_...`), `project_id`, `device_id` (plugin
device id, e.g. `win-1a2b3c4d`, `openclaw-gateway`), `device_label`,
`device_kind` (`openclaw-container` \| `linux` \| `linux-remote` \| `windows`
\| `macos`), `directory` (absolute, normalized: forward slashes, upper-case
drive letter, no trailing slash), `default_branch`, `last_seen_at`,
`sync_clock_json`, timestamps. Unique `(project_id, device_id, directory)`;
index `(device_id, directory)`.

### sync_conflicts, merge_tasks

`sync_conflicts`: the losing version of a reviewable field when two machines
edited it concurrently: `entity_type` (`session` \| `project`), `entity_id`,
`field`, `reason` (`concurrent_edit` \| `stale_write` \| `timestamp_tie` \|
`clock_skew`), `kept_value_json` / `kept_at` / `kept_device`,
`lost_value_json` / `lost_at` / `lost_device`, `status` (`open` \| `resolved`
\| `dismissed`), `resolved_at`, `resolved_by`.

`merge_tasks`: pending "AI merge suggestion" requests: `conflict_id`, entity,
`field`, `versions_json` (both versions), `instructions`, `status` (`pending`
\| `completed` \| `cancelled`), `requested_by`, `result_value_json`,
`completed_by`, timestamps. PCP stores them; an agent resolves them.

`messages.external_message_id` (nullable, unique per session when set) is the
plugin's message id used by the append-only multi-machine merge.

### users

Casdoor users who have signed in at least once (migration 011).

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT | `usr_<timestamp>_<id>` |
| `oidc_issuer` | TEXT | Issuer that authenticated the user |
| `oidc_sub` | TEXT | OIDC subject (Casdoor user id); unique with `oidc_issuer` |
| `display_name` | TEXT | From the ID token at the last login |
| `email` | TEXT | From the ID token (nullable) |
| `groups_json` | JSONB | Groups snapshot from the last login |
| `is_admin` | BOOLEAN | Admin group present at the last login |
| `created_at` / `last_login_at` | TIMESTAMPTZ | |

### identities

Platform principals linked to a user. A principal links to at most one user.

| Column | Type | Description |
|--------|------|-------------|
| `principal` | TEXT | Primary key, e.g. `telegram:8627151333`, `openclaw-weixin:<id>`, `astrbot:qq:<id>` |
| `user_id` | TEXT | `users.id` (`ON DELETE CASCADE`) |
| `link_method` | TEXT | `claim` or `admin` |
| `linked_at` | TIMESTAMPTZ | |

### claims

Single-use claim codes. Only the SHA-256 of the code is stored.

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT | `clm_<timestamp>_<id>` |
| `code_hash` | TEXT | SHA-256 of the normalized code (unique) |
| `session_id` | TEXT | Session the claim hands over (`ON DELETE CASCADE`) |
| `principal` | TEXT | Principal the claim links |
| `created_at` / `expires_at` | TIMESTAMPTZ | `expires_at` = issue + 15 minutes |
| `redeemed_by` / `redeemed_at` | TEXT / TIMESTAMPTZ | Set once on redemption |

`claim_attempts` (`user_id`, `succeeded`, `attempted_at`) backs the per-user
redemption rate limit.

### web_sessions and oidc_login_states

Browser sign-in state. `web_sessions` stores the SHA-256 of the session cookie
value and of its CSRF token, the user, and `expires_at` (12 hours).
`oidc_login_states` holds in-flight authorization requests (`state`, `nonce`,
PKCE `code_verifier`, `return_to`) for 10 minutes, keyed by the SHA-256 of the
`__Host-pcp_oidc` cookie value, and is deleted when the callback consumes it.

### service_credentials, turn_grants, synced_turns

Migration 012. `service_credentials` stores plugin credentials (salted hash,
16-character lookup prefix, `principal_prefixes_json`, revoked/expiry).
`turn_grants` stores one live grant per (credential, `session_key`):
`principal`, `home_session_id`, `readable_session_ids_json`, `expires_at`,
`revoked_at`. `synced_turns` is the idempotency ledger (primary key
`session_id`, `external_key`) for `POST /service/sync`. Grants and ledger rows
cascade when their session is deleted.

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
| `topic_id` | TEXT | Denormalized topic (foreign key, nullable; NULL for uncategorized sessions) |
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

**Immutability**: Messages are append-only **for AI tokens** — an agent can only
append; it can never update or delete, and AI corrections are new messages. A
**human admin** (UI token) may edit or delete a message to fix a wrongly-recorded
or wrongly-imported entry (`PATCH`/`POST .../messages/delete`), which is audited
(`message.edited`, `message.deleted`). Deletes are hard deletes; ordinal gaps are
fine because new appends use `max(ordinal) + 1`.

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
- `message.edited`
- `message.deleted`
- `compaction.recorded`
- `token.revoked`
- `token.renamed`
- `session.shared`
- `session.unshared`
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

- Web UI access is decided per session from `owner_user_id`, `principal`
  (via `identities`) and `class`; admins see everything
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

### v0.1.4 (admin token rotation)

- Added `ui_auth.source` (`deploy` | `env` | `user`) for per-deploy rotation

### v0.1.5 (uncategorized sessions)

- `sessions.topic_id` and `messages.topic_id` made nullable (NULL = no topic)
- ChatGPT-style nav: collapsible topic groups with nested sessions

### v0.1.6 (token rotation default fix)

- Corrected the 003 backfill: credentials not set in Settings default to
  `deploy` and rotate each deploy (migration 005)

### v0.1.7 (public sharing + token revocation)

- Added `sessions.public` for read-only public sharing (migration 006)
- Token revocation API + dashboard modal; recording URL built from the page origin

### v0.1.8 (human fallback import)

- `POST /api/v1/sessions/:id/import` records a pasted agent fallback block,
  skipping messages already present (dedup by role + content)

### v0.1.9 (recording modes + token rename)

- Added `sessions.mode` (`wild` default / `exact`, migration 007) surfaced to the
  agent; token rename via PATCH; auto-distinct token names on creation

### v0.1.10 (message correction)

- Human admin may edit/delete messages (AI stays append-only); audited
  `message.edited` / `message.deleted`

### v0.1.15 (compaction rendering + mixed ingest + hardening)

- Compactions rendered as first-class content; `<PCP_INGEST>` / mixed ingest
  records messages + a compaction; shared config validator; API doc-drift test

### v0.2.0 (identity: Casdoor OIDC, ownership, claims)

- `users`, `identities`, `claims`, `claim_attempts`, `web_sessions`,
  `oidc_login_states`; `sessions.owner_user_id`, `sessions.principal`,
  `sessions.class` (migration 011)

### v0.2.1 (service sync)

- `service_credentials`, `turn_grants`, `synced_turns` (migration 012)

### v0.2.2 (projects)

- `projects`, `project_aliases`, `project_workspaces`, `sync_conflicts`,
  `merge_tasks`; `sessions.project_id`, `context_title`, `context_summary`,
  `sync_clock_json`; `messages.external_message_id` (migration 013)

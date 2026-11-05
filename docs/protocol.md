# API Reference

Base path: `/api/v1`

Agent and manager endpoints use:

```http
Authorization: Bearer <token>
```

Human (web UI) endpoints — everything under "Admin" / "Sessions" / "Topics"
below — authenticate with the Casdoor OIDC browser session instead (see
[Human sign-in](#human-sign-in-oidc)). Since v0.2.0 the legacy single admin
token is accepted as a Bearer header on those routes **only** when the
deployment sets `PCP_BREAK_GLASS_ADMIN_LOGIN=1`; otherwise it is rejected with
`401 BREAK_GLASS_DISABLED`. Per-session recording tokens and scoped manager
tokens are unchanged and never accepted on web UI routes.

Web UI authorization:

- Members of the admin group (`PCP_OIDC_ADMIN_GROUP`) and the break-glass
  admin see and manage every session.
- Other signed-in members see only sessions they own or whose `principal` is
  linked to them. Unowned sessions and `class: "group"` sessions are
  admin-only. Another user's session returns `403 FORBIDDEN`.
- Topic management, permanent deletion, message edit/delete, scoped tokens,
  export, global events, diagnostics, claim issuing and admin-token rotation
  are admin-only.
- Cookie-authenticated `POST`/`PATCH`/`DELETE` requests must send the CSRF
  token from the `__Host-pcp_csrf` cookie in the `X-PCP-CSRF` header, or get
  `403 CSRF_REJECTED`.

## Error Shape

```json
{
  "error": "Unable to append messages: AI session recording / append message transaction - session lookup failed",
  "code": "INTERNAL_ERROR"
}
```

Every error must include consequence, module/process, and cause.

## Public And Setup

### GET `/health`

Returns service status.

### GET `/setup/status`

Ensures the database schema exists when `DATABASE_URL` is configured, then returns whether the app has been initialized. In normal Vercel and Docker deployments this is already true because deploy initialization runs during build or container start.

### POST `/setup/init`

Fallback initializer for cases where deploy initialization did not run. It ensures the database schema exists, initializes the app, and returns the UI token once. If `PCP_ADMIN_TOKEN` is configured, setup stores that token hash and returns no plaintext token. If `PCP_ADMIN_TOKEN` is not configured, setup generates a temporary first-login token, returns it once, and prints it once in server logs so zero-config deployments can still log in. If the app is initialized but the `ui_auth` credential row is missing, setup creates and returns one replacement token.

Response:

```json
{
  "success": true,
  "initialized": true,
  "ui_token": "<shown once or null when PCP_ADMIN_TOKEN is configured>",
  "env_admin_token_configured": false,
  "message": "No PCP_ADMIN_TOKEN was configured, so PCP generated a first-login admin token. It is shown once here and printed once in deployment logs. Log in with it, then change it immediately in Settings so the real credential is never visible in logs."
}
```

## Human sign-in (OIDC)

`/auth/login`, `/auth/callback` and `/auth/logout` live at the site root (not
under `/api/v1`); `/auth/config` and `/auth/me` are under `/api/v1`.

### GET `/auth/login?next=/path`

Starts the Casdoor authorization-code flow with `state`, `nonce` and PKCE
(S256), stores them server-side under a short-lived `__Host-pcp_oidc` cookie
and redirects (303) to Casdoor. `next` must be a same-origin path. When any
`PCP_OIDC_*` variable is missing, login is disabled and this redirects to
`/login?auth_error=OIDC_DISABLED` (fail closed).

### GET `/auth/callback`

The `PCP_OIDC_REDIRECT_URI` target. Consumes the login state once, checks
`state`, exchanges the code with the PKCE verifier, and verifies the ID token
(JWKS signature with asymmetric algorithms only, issuer, audience, expiry,
nonce). Users without `PCP_OIDC_REQUIRED_GROUP` in the `groups` claim are
redirected to `/login?auth_error=GROUP_REQUIRED` and no user or session is
created. On success a new session is issued (`__Host-pcp_session`: HttpOnly,
Secure, SameSite=Lax; `__Host-pcp_csrf`: readable CSRF token), any previous
session cookie is revoked, and the browser is redirected to `next`.

### POST `/auth/logout`

Revokes the server-side session (CSRF-checked) and clears the cookies.

### GET `/auth/config`

Public, secret-free: `{ "oidc_enabled", "oidc_error", "break_glass_enabled" }`
for the login page. `oidc_error` names missing variables, never values.

### GET `/auth/me`

The signed-in user: `{ "user_id", "display_name", "is_admin", "method" }`
where `method` is `oidc` or `break_glass`. `401` when anonymous.

## Identity claims

### POST `/sessions/:id/claims` (admin)

Issues a single-use claim code for the session and a platform principal.
Body `{ "principal": "telegram:8627151333" }` (defaults to the session's own
principal). Group sessions return `409 GROUP_SESSION`. The plaintext code is
returned once (only its SHA-256 is stored) and expires after 15 minutes:

```json
{ "success": true, "claim_id": "clm_...", "code": "ABCDE-FGHJK-MNPQR-STVWX",
  "claim_url": "https://pcp.example.com/claim?code=...", "expires_at": "..." }
```

### POST `/claims/redeem`

Signed-in Casdoor users only (CSRF-checked). Body `{ "code": "..." }`. Links
the claim's principal to the caller (`identities`), makes the caller the
session owner, and marks the claim redeemed. Later sessions with that principal
become visible to (and, when a principal is attached, owned by) the same user.
Errors: `400 CLAIM_INVALID`, `409 CLAIM_ALREADY_REDEEMED`, `410 CLAIM_EXPIRED`,
`409 PRINCIPAL_LINKED_ELSEWHERE`, `409 SESSION_OWNED`, `429 RATE_LIMITED`
(10 failed attempts per user per 15 minutes). The `/claim` page wraps this.

### GET `/identities`

Linked principals: all for admins, the caller's own otherwise.

### DELETE `/identities` (admin)

Body `{ "principal": "telegram:..." }`. Unlinks a principal; existing session
owners are kept.

## Service sync (channel plugins)

Authenticated with `Authorization: Bearer pcps_...` service credentials only.
Full semantics in [service-sync.md](service-sync.md).

### GET|POST|DELETE `/service-credentials` (admin, web UI)

List, mint (`{ name, principal_prefixes, expires_in? }`, token shown once) or
revoke (`{ id }`) service credentials.

### POST|DELETE `/service/grants`

Create the turn grant for `{ session_key, principal, chat, group_id?, ttl_seconds?, issue_claim? }`
or end it (`{ session_key }`). Returns `{ grant_id, session_id, readable_session_ids, expires_at, linked, claim }`.
`403 PRINCIPAL_NOT_ALLOWED` when the credential may not assert that principal.

### POST `/service/sync`

`{ session_key, external_key, messages }`: append one turn to the grant's home
session, idempotent by `external_key` (`duplicate: true` on replay).

### POST `/service/recall`

`{ session_key, session_id?, limit? }`: recent messages from the grant's
readable sessions. A session outside the grant is `403`.

### POST `/service/search`

`{ session_key, query, limit? }`: substring search within the grant's readable
sessions. Without a live grant every service read/write is `403 GRANT_REQUIRED`.

## Break-glass admin token

### GET `/auth/check`

Returns `401 BREAK_GLASS_DISABLED` unless `PCP_BREAK_GLASS_ADMIN_LOGIN=1`.
When enabled, validates a UI/admin bearer token before opening the dashboard. If `PCP_ADMIN_TOKEN` is configured, the deployment token is reconciled into `ui_auth` before validation. Missing generated credentials return `SETUP_REQUIRED`; configured-but-unusable deployment credentials return `INVALID_ADMIN_TOKEN` or `ADMIN_CREDENTIAL_NOT_INITIALIZED` with a deployment guide URL.

### PATCH `/auth/token`

Updates the UI/admin token after the caller authenticates with the current valid UI token. This endpoint is disabled while `PCP_ADMIN_TOKEN` is configured because the environment variable owns the credential.

## Admin Topics

### GET `/topics`

Lists topics with session counts.

### POST `/topics`

Creates a topic. `title` is optional and free-text: omit it (or send `{}`) and
the server generates a unique default name (`New Topic`, `New Topic 2`, ...).
Duplicate titles are auto-suffixed instead of rejected.

## Scoped Manager

The scoped manager API is intended for trusted sync workers using a scoped
token. A global token with `read_all`, `create_sessions`, and `mint_tokens` can
create and retrieve sessions without using the UI credential.

### POST `/manager/sessions`

Creates a session, or returns the existing session when `external_key` already
exists. This makes retries from a session synchronizer idempotent. Existing
clients may omit `external_key` and retain the original create-only behavior.

Body additions:

```json
{
  "title": "Codex task",
  "mode": "exact",
  "external_key": "win-384de1b4:codex:0199abcd"
}
```

`external_key` is the caller's own stable identity for the source transcript,
conventionally `<device-id>:<source-kind>:<native-session-id>`. It is treated as
opaque, must be 1–200 characters, and must not contain control characters; an
invalid value returns `VALIDATION_ERROR`.

The response includes `created`, `session_id`, `recording_url`, and an
`access_token` when the scoped token has `mint_tokens`. `created` is `false`
when an existing session was returned, which is what makes a retried push
idempotent.

### GET `/manager/sessions/by-key/:key`

Resolves an external session key and returns its current append cursor, so a
sync worker can resume an upload instead of re-sending messages PCP already
holds:

```json
{
  "found": true,
  "external_key": "win-384de1b4:codex:0199abcd",
  "session_id": "ses_…",
  "title": "Codex task",
  "mode": "exact",
  "message_count": 12,
  "last_ordinal": 12
}
```

A key that falls outside the token's folder or session scope returns `found:
false` rather than `403`, so the boundary cannot be used to probe for sessions
the token may not read. As with every agent-facing route, no topic id is
returned.

### GET `/manager/tree`

Returns the scoped folder/session tree.

### POST `/manager/search`

Searches message content within the scoped token boundary. The body accepts
`query`, optional `limit`, and optional `session_id`.

### POST `/manager/sessions/:id/tokens`

Mints a session recording token for an existing session when the scoped token
has `mint_tokens` and covers the target session.

### GET|POST|DELETE `/manager/sessions/:id/links`

Reads or changes labelled relationships between sessions. Links are useful for
representing rewrite branches and source-to-import relationships without
changing the append-only message history.

Body:

```json
{
  "title": "Research",
  "description": "optional"
}
```

### POST `/topics/:id/rename`

Renames a topic.

Body:

```json
{
  "title": "new-title"
}
```

### POST `/topics/:id/archive`

Archives or restores a topic. Body (optional): `{ "archived": false }` to
restore from trash. When omitted, the topic is archived (`archived: true`).

### DELETE `/topics/:id`

Permanently deletes a topic from trash. Sessions under it move to Uncategorized.

### DELETE `/sessions/:id`

Permanently deletes a session and all its child data (messages, tokens,
compactions, events).

### POST `/trash/empty`

Permanently deletes ALL archived sessions and topics. Returns
`{ sessions_deleted, topics_deleted }`.

## Admin Sessions

### GET `/sessions`

Lists the sessions visible to the caller (all of them for admins), including
uncategorized ones (`topic_id: null`). Each row includes `owner_user_id`,
`principal` and `class`. Used by the dashboard to group sessions by topic.

### POST `/sessions`

Creates a session owned by the signed-in user (`class: "trusted"`). `topic_id`
is optional — omit it for an **uncategorized** (no-topic) session; only admins
may file a session under a topic. `title` is optional and auto-suffixed for uniqueness within
the topic group (or the uncategorized group).

Body (all fields optional):

```json
{
  "title": "Conversation title",
  "topic_id": "topic_123"
}
```

### GET `/topics/:topicId/sessions`

Lists sessions inside a topic.

### POST `/topics/:topicId/sessions`

Creates a session inside a topic. `title` is optional: omit it for a unique
default name (`New Session`, `New Session 2`, ...) within the topic. Duplicate
titles are auto-suffixed.

Body:

```json
{
  "title": "Conversation title"
}
```

### GET `/sessions/:id`

Returns session details with topic title.

### PATCH `/sessions/:id`

Updates session metadata.

Body:

```json
{
  "title": "New title",
  "topic_id": "topic_123",
  "archived": false
}
```

Admins may also set `principal` (e.g. `"telegram:123"`, `null` clears it) and
`class` (`trusted` | `unattributed` | `group`); attaching a principal that is
already linked to a user makes that user the owner of an unowned session.
Non-admins may not change `topic_id`, `principal` or `class`.

At least one field is required. `topic_id: null` moves the session to
Uncategorized (no topic). `public: true` enables a read-only public view;
`public: false` makes it private again. `archived: true` removes the session
from the active list; `archived: false` restores it.

### POST `/sessions/:id/import`

Human fallback import (UI token). When an agent cannot upload from its sandbox,
the admin pastes the agent's fallback block here. Accepts the same forgiving
formats as agent ingest — a `{ "messages": [...] }` block, an agent wrapper
object that contains a `messages` array, `<PCP_APPEND>`/`<PCP_COMPACT>`,
ChatML-like arrays, or a plain transcript. Messages already present (matched by
role + content) are skipped, so re-pasting merges cleanly.

Body: `{ "payload": "<pasted text>" }` (or the raw pasted text). Response:
`{ success, imported_as: "messages"|"compact", imported, skipped }`.

### GET `/sessions/:id/review`

Returns messages for review.

### PATCH `/sessions/:id/messages/:messageId`

Admin message correction (UI token). Edits a wrongly-recorded/imported message:
`{ "content": "..." }`. The append-only rule applies to AI tokens only; this
human-admin path is audited (`message.edited`).

### POST `/sessions/:id/messages/delete`

Admin bulk delete (UI token). Removes wrongly-recorded/imported messages:
`{ "message_ids": ["msg_...", ...] }` (one or many). Only ids belonging to the
session are deleted; audited (`message.deleted`).

### GET `/sessions/:id/events`

Returns audit events for a session.

### GET `/sessions/:id/compactions`

Returns the durable compaction summaries for a session (additional records that
never replace raw messages). The workspace renders these as readable,
system-prompt-style cards. If a session has compactions but no messages, the
messages pane shows "No raw messages recorded. This session has compact
summaries."

### POST `/sessions/:id/archive`

Archives a session.

## Projects (web UI)

Projects group sessions by the piece of work they belong to, across machines
(see [projects.md](projects.md)). Signed-in users only (Casdoor session or
break-glass admin). Admins see every project; other users see projects they
own or that contain a session visible to them, and inside a project only those
sessions. Every write below is admin-only and CSRF-checked.

### GET `/projects`

`{ projects: [{ id, canonical_key, display_name, description, git_remotes,
session_count, workspace_count, device_kinds, last_activity_at, ... }],
unassigned_sessions }`.

### POST `/projects` (admin)

Same body as `POST /manager/projects`; finds or creates by canonical key.

### GET `/projects/:id`

`{ project (with aliases), workspaces, sessions, conflicts }`. `conflicts` (open
sync conflicts of the project and its sessions) is filled for admins only.
`403` when the project is not visible to the caller, `404` when unknown.

### PATCH `/projects/:id` (admin)

`{ display_name?, description?, add_git_remotes?, add_aliases? }`. Name and
description are applied as a write from device `web` that has seen the current
values (so they never silently drop a concurrent plugin edit); remotes and
aliases are only added. An alias owned by another project is reported in
`extended.alias_conflicts`, never reassigned.

### POST `/projects/:id/workspaces` (admin)

Add a workspace by hand; body as `POST /manager/projects/:id/workspaces`.

### PATCH `/sessions/:id/context` (admin)

`{ project_id?, context_title?, context_summary? }`: move a session into a
project (`null` removes it) and edit its task context, as a `web` write under
the conflict policy.

### GET `/conflicts?status=open|resolved|dismissed` (admin)

Sync conflicts: `{ id, entity_type, entity_id, field, reason, kept: { value,
at, device }, lost: { value, at, device }, status }`.

### PATCH `/conflicts/:id` (admin)

`{ status: "resolved" | "dismissed" }` for an open conflict ("keep latest" or
"not important"); `404` once it is no longer open.

### POST `/conflicts/:id/merge-request` (admin)

The **AI merge suggestion** action: stores a pending merge task holding both
versions and merge instructions, for an agent to resolve later through
`/manager/merge-tasks`. PCP never calls a model. Idempotent per conflict
(`created: false` returns the pending task).

## Projects for agents and plugins (scoped manager)

`Authorization: Bearer <scoped token>`, **global scope only** (folder and
session tokens get `403`). Reads need `read_all` or `manage_projects`; writes
need `manage_projects`. Web sessions, service credentials, session recording
tokens and the admin token are not accepted. `manage_projects` is a new flag
(v0.2.2): tokens minted before it existed do not get it implicitly; mint one
with `scripts/pcp-operator.js scoped-token create --permission manage_projects`
or in the token manager.

### GET|POST `/manager/projects`

`GET` lists projects with their workspaces. `POST` finds or creates a project
(idempotent) and adds new remotes and aliases:

```json
{
  "canonical_key": "git:github.com/owner/repo",
  "display_name": "repo",
  "git_remotes": ["git@github.com:owner/repo.git"],
  "aliases": ["name:old-folder-name"],
  "workspace": { "device_id": "win-1a2b3c4d", "device_kind": "windows", "directory": "D:\\work\\repo", "default_branch": "main", "seen_at": "2026-11-05T10:00:00Z" }
}
```

`canonical_key` defaults to `git:<first remote>` or `name:<display_name>`.
Lookup is by canonical key, then the alias table, then any matching remote
(case-insensitive). Response: `{ project, created, remotes_added,
aliases_added, alias_conflicts, workspace }` (`201` when created).

### GET `/manager/projects/resolve?remote=&directory=&device_id=&name=`

Resolve a checkout: by remote, then a registered workspace directory (on
`device_id` when given; directories are normalized, `d:\x\` = `D:/x`), then
name or alias. `{ found: false }` or `{ found: true, matched_by: "remote" |
"workspace" | "name", project, workspaces }`.

### POST `/manager/projects/:id/workspaces`

Register or refresh this machine's checkout: `{ device_id, device_label?,
device_kind, directory, default_branch?, seen_at? }`. `device_kind` is one of
`openclaw-container`, `linux`, `linux-remote`, `windows`, `macos`; the
directory must be absolute. Unique per (project, device, directory).
`last_seen_at` only moves forward; `default_branch` and `device_label` are
last-writer-wins by `seen_at`.

### PATCH `/manager/sessions/by-key/:key/context`

Attach the session with this external key to a project and/or set its task
context:

```json
{
  "project_id": "prj_...",
  "context_title": "Deploy the page with GitHub Actions",
  "context_summary": "...",
  "updated_at": "2026-11-05T10:00:00Z",
  "device_id": "win-1a2b3c4d",
  "base_updated_at": { "context_summary": "2026-11-04T09:00:00Z" }
}
```

`updated_at` is the plugin's own modification time; `base_updated_at` (per
field, optional) is the field clock the writer last saw. Response `{
session_id, applied, kept, unchanged, conflicts, clock_skew }`.

### POST `/manager/sessions/by-key/:key/merge-messages`

`{ device_id, messages: [{ external_id, role, content, provider?, base_model?,
provider_timestamp? }] }` (1-50): append-only merge by message id. Response `{
session_id, appended, duplicates, first_ordinal }`.

### GET `/manager/merge-tasks?status=pending`

Pending AI merge tasks: `{ id, entity_type, entity_id, field, versions: [{
label, value, at, device }], instructions, status }`. Needs `manage_projects`.

### POST `/manager/merge-tasks/:id/complete`

`{ value }`: the agent's merged value. Applied as a fresh write that has seen
the current value (so it is not itself a conflict), the task is completed and
its conflict resolved. `409` when the task is no longer pending.

## Sync conflict policy

Applies whenever the same session or project field is written from more than
one machine (plugins, the web UI as device `web`, AI merges as
`ai-merge:<actor>`). Every write carries `updated_at` (plugin time) and
`device_id`; PCP keeps a per-field clock `{ at, device }` in
`sync_clock_json`.

1. **Last writer wins by plugin timestamp.** A write applies when its time is
   later than the field's clock. Exact ties go to the lexically greater
   `device_id`, so every replica decides the same way.
2. **Clock-skew guard.** A timestamp in the future is clamped to PCP's receive
   time before comparing, so a machine with a fast clock cannot win every later
   edit. More than 5 minutes ahead is also flagged (`clock_skew: true`, and a
   resulting conflict has reason `clock_skew`).
3. **Same value** only advances the clock, so a later stale write with a
   different value still loses.
4. **Reviewable fields** (`context_title`, `context_summary`, project
   `display_name`, `description`): the latest value is kept, and when the
   losing value came from another device that the winner had not seen (no
   matching `base_updated_at`), the losing version is stored in
   `sync_conflicts` (`reason`: `concurrent_edit`, `stale_write`,
   `timestamp_tie` or `clock_skew`) with status `open`, flagged for review on
   the project page. A device editing its own value, or a writer that
   fast-forwards from the current clock, is not a conflict.
5. **Plain fields** (`project_id`, workspace `default_branch` and
   `device_label`) are last-writer-wins without a conflict record; workspace
   `last_seen_at` takes the maximum; remotes and aliases are a union.
6. **Message streams** are append-only: messages with an `external_id` PCP
   already holds for the session are skipped, the rest are appended after the
   existing ordinals in (`provider_timestamp`, `external_id`) order. Nothing is
   overwritten or reordered; for a chronological view sort by
   (`provider_timestamp`, `ordinal`).
7. **AI merge suggestion.** For an open conflict an admin can request a merge
   (`POST /conflicts/:id/merge-request`): PCP stores a pending task with both
   versions; an agent lists it (`GET /manager/merge-tasks`) and posts the merged
   value (`POST /manager/merge-tasks/:id/complete`). PCP never calls a model.
   Alternatively "Keep latest" resolves and "Dismiss" dismisses the conflict.

## Tokens

### GET `/sessions/:sessionId/tokens`

Lists token metadata for the session (never the secret): name, status
(`active`, `expired`, `revoked`), `expires_at`, and `last_used_at`.

### DELETE `/sessions/:sessionId/tokens`

Permanently deletes a token from the database after a 3-second undo window.
Body: `{ "token_id": "tok_..." }`.

### PATCH `/sessions/:sessionId/tokens`

Renames a token. Body: `{ "token_id": "tok_...", "name": "New name" }`. Body: `{ "token_id": "tok_...", "name":
"New name" }` to rename (names are kept distinct within the session), or
`{ "token_id": "tok_...", "revoke": true }` to revoke. A revoked token is
rejected on every subsequent request.

### POST `/sessions/:sessionId/tokens`

Creates a session access token and returns it once, together with the recording
URL and a ready-to-paste agent instruction.

Body (all fields optional):

```json
{
  "name": "Claude session",
  "can_rename_session": false,
  "expires_in": "7d"
}
```

- `name` defaults to `<session title> access token`.
- `expires_in` is one of `1h`, `24h`, `7d`, `30d`, `never`. Default is `7d`.
  `never` stores a NULL `expires_at`; expired tokens are rejected at auth time.

Response (token shown only here):

```json
{
  "success": true,
  "access_token": "<raw token, shown once>",
  "recording_url": "https://<domain>/r/<sessionId>",
  "instruction": "You are recording this conversation to Personal Context Protocol. ...",
  "expires_in": "7d",
  "expires_at": "2026-06-30T00:00:00.000Z",
  "status": "active"
}
```

## Agent Recording (URL + token)

An external AI agent needs only two things: a **recording URL** and an **access
token**. The URL carries all non-secret session information and is the entry
point for discovering upload routes; the token is the only credential. Agent
routes return a structured envelope:

```json
{
  "ok": false,
  "code": "TOKEN_EXPIRED",
  "retryable": false,
  "message": "The session token expired.",
  "next_steps": ["Ask the user to generate a new access token."]
}
```

### GET `/r/:sessionId` (public)

Recording URL entry point. By default it returns a **self-contained markdown
instruction document** (`text/markdown`): consent framing, the upload and
read-back routes with exact `curl` examples, the canonical transcript format,
limits, and mode guidance. This is why the human prompt can be just "URL +
token" — the agent fetches the URL and reads everything else there.

Content negotiation: `?format=json` (or `Accept: application/json`) returns the
structured protocol descriptor instead; `?format=md` forces markdown. No token
required for either form (only non-secret session information is exposed).

### GET `/r/:sessionId/transcript` (access token)

Session read-back as a raw markdown transcript (`### @role` sections),
authenticated with `Authorization: Bearer <access-token>`. This is the
cross-device sync pull: an agent on a new device fetches this single URL and
receives the recorded conversation in the same human-readable format it records
in. The document is itself re-importable (paste or POST it to `ingest`). Also
advertised as `read_transcript` in the protocol descriptor.

### GET `/api/v1/agent/resolve?url=<recording-url>` (public)

Resolves a recording URL to its protocol descriptor.

### GET `/api/v1/agent/sessions/:sessionId/protocol` (public)

Returns the protocol descriptor: `auth`, `routes` (`read_messages`,
`read_transcript`, `record_messages`, `record_compact`, `ingest_any`),
`instructions_url` + `transcript_url` + `preferred_upload_format`,
`allowed_actions` (note
`manage_topics: false`), `limits` (`max_messages_per_request: 50`,
`max_content_chars: 100000`), `existing_message_count`, a `hint`, and
`recording_mode` + `recording_guidance`. The mode is `wild` (the agent may
redact unsafe secrets) or `exact` (record verbatim, including credentials, for
task migration). Fetch `read_messages` to discover the full conversation history,
then record ALL messages — not only the current exchange.

### POST `/api/v1/agent/sessions/:sessionId/messages`

Append-only message recording. Same body as the legacy message route; requires
`Authorization: Bearer <access-token>`.

### POST `/api/v1/agent/sessions/:sessionId/compact`

Stores a durable session summary when full message upload is impossible.
Compactions are additional records and never replace raw messages.

Body (`summary` required):

```json
{ "summary": "...", "decisions": ["..."], "open_questions": ["..."] }
```

### POST `/api/v1/agent/sessions/:sessionId/ingest`

Forgiving ingestion; the **primary upload route**. The preferred body is a raw
markdown transcript — `### @user` / `### @assistant` section headings with the
message text below each, optionally wrapped in
`<PCP_TRANSCRIPT>...</PCP_TRANSCRIPT>` — sent as `text/markdown` or
`text/plain`. No JSON escaping is required and the payload stays human-readable
end to end. A content line that itself starts with `### @` is escaped as
`\### @`.

A `title="…"` attribute on the `<PCP_TRANSCRIPT>` tag (or a top-level
`suggested_session_title` / `session_title` field in JSON payloads) suggests
the session title; it is normalized, de-duplicated within the topic, and
applied when the token has `can_rename_session` (the default for new tokens).
A restricted token's suggestion is dropped silently rather than failing the
ingest.

Also accepted (backward compatible): raw JSON with top-level `messages` or
`summary`, `{ messages, compaction }` (mixed), `<PCP_INGEST>...</PCP_INGEST>`,
`<PCP_APPEND>...</PCP_APPEND>`, `<PCP_COMPACT>...</PCP_COMPACT>`, ChatML-like
arrays, or loose `User:` / `Assistant:` transcript lines. Messages already
present are skipped. On failure it returns structured retry guidance
(`code: "UNPARSEABLE_PAYLOAD"`), not a vague error. Response:

```json
{
  "ok": true,
  "session_id": "ses_...",
  "imported": { "messages": 12, "compactions": 0, "events": 1, "duplicates_skipped": 0 },
  "notice": "Imported message-level content."
}
```

### POST `/api/v1/agent/sessions/:sessionId/ingest-dry-run`

Validates a fallback payload **without storing** anything. Returns
`{ ok, valid, would_import: { messages, compactions }, warnings }` when valid, or
a structured `{ ok: false, valid: false, code: "INVALID_INGEST_SCHEMA",
retryable, message, next_steps }` when invalid (for example, a message missing
`content`).

### GET `/api/v1/agent/sessions/:sessionId/review`

Scoped message read (access token). Returns all messages already recorded in
this session so the agent knows the full conversation history and can pick up
from the next ordinal. This is the `read_messages` route from the protocol
descriptor.

## AI Message Append (legacy)

### POST `/sessions/:sessionId/messages`

Appends messages to the session bound to the bearer token. Retained for
back-compat; new agents should use `/api/v1/agent/sessions/:sessionId/messages`.

Body:

```json
{
  "messages": [
    {
      "role": "user",
      "content": "Hello",
      "provider": "unknown",
      "base_model": "unknown"
    },
    {
      "role": "assistant",
      "content": "Hi.",
      "provider": "anthropic",
      "base_model": "claude"
    }
  ],
  "suggested_session_title": "Greeting"
}
```

Rules:

- `messages` must contain 1 to 50 messages.
- `role` must be `user`, `assistant`, `system`, `tool`, or `correction`.
- `content` is required.
- Topic fields are not accepted.
- `suggested_session_title` requires a token with rename permission; the server
  normalizes it and auto-suffixes duplicates within the topic.

## Public

### GET `/public/sessions/:id` (public)

Read-only view of a session and its messages when the session is marked
`public`. No admin token required. A private or missing session returns 404 so a
private session's existence is not leaked. Tokens are never exposed. The `/s/:id`
page renders this.

## Agent Schemas (public)

These endpoints return machine-readable JSON schemas so an agent can generate
correct payloads without guessing or searching the web. The name "Personal
Context Protocol" has been reused by unrelated projects — use ONLY these
definitions, not web search results.

### GET `/agent/schema/message`

Returns the JSON schema for the `POST record_messages` payload.

### GET `/agent/schema/compact`

Returns the JSON schema for the `POST record_compact` payload.

### GET `/agent/schema/ingest`

The canonical fallback schema (public, no token). Returns `{ ok, schema_version,
schema_name, accepted_content_types, accepted_wrappers, preferred_format,
transcript_example, limits, modes, ingest_example,
compact_example }`. `modes` defines `wild` (redaction allowed) and `strict`
(exact preservation requested). This is the single source of truth shared with
the generated copy-paste fallback prompts — agents should use ONLY these
definitions, not web search results for "Personal Context Protocol".

## Recording URL origin

The browser UI builds the recording URL from `window.location.origin` (where the
admin opened the app), so it always matches the deployment. Server-side,
`PCP_APP_URL` is used only when it is a valid absolute `http(s)` URL; an
unexpanded template such as the literal `${VERCEL_URL}` is ignored in favor of
the request origin. `PCP_APP_URL` is about constructing absolute URLs, not CORS.

## Export

### GET `/export`

Exports app data as JSON for the UI token holder.

The export omits plaintext tokens.

## Diagnostics

### GET `/diagnostics`

What this deployment actually is, for the UI token holder. `/health` reports
only that the process is up; a deployment can be healthy, authenticate, serve
its data, and still be missing an entire feature line because it was built from
a branch that never received it — from outside, that is indistinguishable from
a bug, because the routes simply `404`.

```json
{
  "build": { "version": "0.1.24", "commit": "d351bf85", "branch": "main",
             "runtime": "node v20.11.0", "environment": "production" },
  "database": { "ok": true, "latencyMs": 24, "error": null },
  "counts": { "topics": 6, "sessions": 15, "messages": 258, "events": 312, "active_tokens": 3 },
  "migrations": [{ "version": "001_initial", "appliedAt": "..." }],
  "config": [{ "key": "PCP_INSTANCE_SECRET", "severity": "error", "problem": "is not set" }],
  "features": [{ "id": "scoped-tokens", "label": "Scoped tokens and manager API",
                 "migration": "008_scoped_tokens", "present": true,
                 "routes": ["/api/v1/tokens"], "description": "..." }]
}
```

Feature presence is decided by the migrations the database reports, not by the
version number: two branches can share a version and differ completely in
content, which is precisely what makes a version alone untrustworthy here.

Each probe is isolated, so a database that is down still yields a report saying
so rather than a `500` that says nothing.

### GET `/events`

The instance-wide activity log for the UI token holder. Every write path
already records an event — `session.created`, `message.appended`,
`token.created`, `token.deleted`, `topic.created`, `session.renamed`,
`compaction.recorded` — but nothing read them back, so the table grew and
answered no questions.

Query parameters: `limit` (1–200, default 50), `action`, `actor`, `session_id`.
Session titles are resolved in one extra query, since an id alone does not say
which conversation a line is about.

This is deliberately not a request log: on serverless each instance would keep
its own in-memory buffer and show a partial picture, whereas these events are
in Postgres and every reader sees the same history.

# Personal Context Protocol — Documentation

PCP is a Vercel + Neon Postgres web app for scoped AI session recording.
Humans create topics and sessions; AI agents record messages into assigned
sessions using only a recording URL + access token.

---

## Quick Deploy

See [Deployment: Vercel + Neon](deployment-vercel-neon.md) or
[Deployment: Docker Compose](deployment-docker-compose.md).

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | Neon/Postgres connection string |
| `PCP_INSTANCE_SECRET` | Yes | Random secret, 32+ characters |
| `PCP_APP_URL` | Yes | Your app's public URL (`https://<app>.vercel.app`) |
| `PCP_ADMIN_TOKEN` | No | 32+ character admin/reset token. Leave unset for zero-config first login |

See [Admin Token Recovery](deployment-vercel-neon.md#admin-token-recovery)
for lost-token recovery and the three credential sources (deploy / env / user).

---

## Admin UI Instructions

1. **Login** at `/login` with the UI token generated during deploy initialization.
2. **Dashboard** (`/dashboard`) — every session has a URL (`?session=<id>`). The
   left nav shows topics as collapsible groups and sessions nested underneath.
   Create topics/sessions one-click; right-click or long-press to manage them.
3. **Session workspace** — header shows session title, recording mode toggle
   (Wild/Exact), the public/private toggle, and action buttons (Edit, Token,
   Import Token, Export Token, Tokens manager, Public toggle, Remove).
4. **Trash** — archiving moves a topic/session to the Trash section. Restore
   or permanently delete from Trash. Empty Trash bulk-deletes all archived items.
5. **Settings** (`/settings`) — set your own admin token (stops per-deploy rotation).
   Rotation is disabled while `PCP_ADMIN_TOKEN` is configured.

---

## Agent API Instructions

Agents need only a **Recording URL** and an **Access Token** — no app URL,
session ID, topic ID, API route, or payload schema needed separately.

### Discovery

Fetch the recording URL (or the protocol endpoint) to learn upload routes:
```bash
curl "https://<domain>/r/<sessionId>"
```
The response includes `routes`, `schemas` (JSON schema URLs), `allowed_actions`,
`limits`, `recording_mode` + `guidance`, and `existing_message_count`.

### Recording

Authenticate every write with:
```http
Authorization: Bearer <access-token>
```

| Route | Method | Description |
|---|---|---|
| `read_messages` | GET | Read all already-recorded messages (scoped to token) |
| `record_messages` | POST | Append messages (1–50 per request) |
| `record_compact` | POST | Store a durable summary (never replaces raw messages) |
| `ingest_any` | POST | Forgiving parser: JSON, `<PCP_INGEST>`, `<PCP_COMPACT>`, ChatML, transcript |

### JSON Schemas

Machine-readable payload specs at:
- `GET /api/v1/agent/schema/message`
- `GET /api/v1/agent/schema/compact`
- `GET /api/v1/agent/schema/ingest`

Use **only** these definitions. Do not search the web for "Personal Context
Protocol" — the name has been reused by unrelated projects and web results are wrong.

### Token Modes

The workspace offers three token-creation modes:
- **Token (blue)** — standard recording instruction
- **Import (violet)** — agent recalls ALL past conversation from its own context
  and uploads to PCP, then records follow-ups
- **Export (amber)** — agent reads ALL PCP history first, then records new
  context, chat history, and media URLs going forward

Full agent instructions: [docs/agent-instructions.md](agent-instructions.md)
Full API reference: [docs/protocol.md](protocol.md)

---

## Migrate and Updates

- [Migrations Guide](migrations.md) — how schema migrations are applied
- [Data Model](data-model.md) — all tables, columns, constraints, relations
- [Version History](versions/v0.1.14.md) — per-release change notes

Migrations are idempotent and data-preserving. The deploy initialization script
(`scripts/deploy-init.js`) and the runtime bootstrap (`ensureDatabaseSchema`)
both apply the full schema, so fresh installs and upgrades converge.

---

## Export / Import Data

### Export

`GET /api/v1/export` (UI token) exports topics, sessions, messages, tokens
(hashes only), compactions, events, and the app instance as JSON.

### Import

`POST /api/v1/sessions/:id/import` (UI token) accepts a pasted agent fallback
block — agent-wrapper JSON, `{ messages }`, `<PCP_INGEST>`, `<PCP_COMPACT>`,
ChatML arrays, or a raw transcript. Already-recorded messages are skipped
(role + content dedup), so re-pasting always merges cleanly.

The session workspace has an **Import panel** (terminal-style paste box) below
the messages for this fallback path.

---

## TODO and Versions

- [TODO](TODO.md) — owner-visible future work
- [Per-release notes](versions/) — detailed change notes by version (see
  `docs/versions/v0.1.14.md` for the latest)

---

## Legacy Documentation

- [Protocol Spec](protocol.md) — full API reference (all endpoints)
- [Data Model](data-model.md) — database schema reference
- [Security Model](security.md)
- [Logging](logging.md) — diagnostic message format
- [Migrations Guide](migrations.md) — Drizzle migration workflow

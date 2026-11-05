# Service sync API (channel plugins)

Phase 2 of the identity/context-sync design. Channel plugins (the future
`thirdparty/openclaw-pcp` and `thirdparty/astrbot_plugin_pcp_relay`) talk to
PCP with a **service credential** and **server-side turn grants**. No
credential or grant ever appears in a prompt, chat or tool argument: the
plugin holds its own credential, and a grant is PCP-side state looked up by
the OpenClaw session key.

## Service credentials

- Minted by an admin: `POST /api/v1/service-credentials`
  `{ "name": "openclaw-pcp", "principal_prefixes": ["telegram:", "openclaw-weixin:"], "expires_in": "never" }`.
  The `pcps_…` token is returned once; only a salted scrypt hash is stored.
- `principal_prefixes` bounds which platform identities the credential may
  assert (`astrbot:` for the AstrBot ingress, for example). Asserting any
  other principal is `403 PRINCIPAL_NOT_ALLOWED`.
- Service credentials are accepted only by `/api/v1/service/*`. They are
  never admin, never a web UI login and never an agent recording token.
  `GET /api/v1/service-credentials` lists them (no hashes);
  `DELETE /api/v1/service-credentials` `{ "id" }` revokes one immediately.

## Turn grants

`POST /api/v1/service/grants` at the start of a turn:

```json
{ "session_key": "agent:main:direct:owner", "principal": "telegram:8627151333",
  "chat": "direct", "ttl_seconds": 600, "issue_claim": false }
```

The principal must come from the platform (trusted peer / OneBot event),
never from message text. PCP then:

1. finds or creates the **home session**: one per direct-chat principal
   (`pcp:dm:<principal>`, class `trusted`) or per group
   (`pcp:group:<platform>:group:<group_id>`, class `group`; `group_id` is
   required for `chat: "group"`);
2. if the principal is linked to a user, makes that user the owner of an
   unowned home session (later sessions are owned automatically);
3. stores the **readable set**:
   - linked direct chat: the user's non-group, non-archived sessions (owned or
     principal-linked), as that user would see them without admin rights;
   - unlinked direct chat: the home session only;
   - group chat: the group's home session only;
4. replaces any previous live grant for the same credential and session key.

TTL defaults to 600 s (30–3600). With `issue_claim: true`, an unlinked direct
chat also gets a single-use claim code and `/claim?code=` URL for the plugin
(not the model) to append to its reply. `DELETE /api/v1/service/grants`
`{ "session_key" }` ends the grant early.

Response: `{ grant_id, session_id, readable_session_ids, expires_at, linked, claim }`.

## Sync, recall, search

All need a live grant for `session_key` issued to the same credential, or
return `403 GRANT_REQUIRED` (expired, ended, replaced, or another credential's).

- `POST /api/v1/service/sync`
  `{ "session_key", "external_key": "turn-123", "messages": [{ "role", "content", ... }] }`
  appends the turn to the grant's **home session only**, idempotently: the
  same `external_key` again returns `duplicate: true` and records nothing.
- `POST /api/v1/service/recall` `{ "session_key", "session_id"?, "limit"? }`
  returns recent messages from the readable set (or one readable session;
  any other session is `403`).
- `POST /api/v1/service/search` `{ "session_key", "query", "limit"? }`
  case-insensitive substring search over the readable set.

Grant creation, recall and search are audited in `events`
(`grant.created`, `grant.recall`, `grant.search`, `turn.synced`).

## Not in this phase

No broker process, no AstrBot HMAC/replay checks, no OpenClaw/AstrBot plugins
and no broker-to-OpenClaw call yet. Those are phases 2b–4 of the design.

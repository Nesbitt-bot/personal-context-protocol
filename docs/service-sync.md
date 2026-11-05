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

### Kinds (v0.3.0)

`channel` (the default; what the admin API mints) is the only kind accepted
by `/api/v1/service/*`. `ingress` (AstrBot, exactly `astrbot:`) and `broker`
(the loopback broker) are minted with `scripts/pcp-operator.js` and accepted
only by the broker routes; see [broker.md](broker.md). The `astrbot:` prefix
is reserved: a channel credential can never assert it.

## Turn grants

`POST /api/v1/service/grants` at the start of a turn:

```json
{ "session_key": "agent:main:direct:owner", "principal": "telegram:100000001",
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
Broker turn keys (`pcp:<grant id>`) resolve to that broker grant for the
broker's delegate credential only, read-only.

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

## Operator CLI (no browser)

`scripts/pcp-operator.js` mints, lists and revokes service credentials and
scoped tokens directly in the database, for the host operator when no admin
can sign in through Casdoor. It uses the same token format and salted scrypt
hash as the admin routes (checked by `tests/operator-cli.test.ts`) and writes
an `events` row with actor `operator` for every create and revoke. It never
prints a token to a terminal: `--token-out FILE` creates a new mode-600 file,
and `--token-out -` writes only the token to a pipe. Scoped tokens get exactly
the `--permission` flags named (there is no full-permission default; expiry
defaults to 30 days). The production image does not contain `scripts/`, so
feed the script on stdin:

```sh
umask 077
docker exec -i -w /app <app-container> node - service-credential create \
  --name openclaw-pcp --prefix telegram: --prefix openclaw-weixin: --token-out - \
  < scripts/pcp-operator.js > /private/path/pcp-service.token
docker exec -i -w /app <app-container> node - scoped-token create --name session-import \
  --permission read_all --permission create_sessions --permission mint_tokens --token-out - \
  < scripts/pcp-operator.js > /private/path/session-import.token
docker exec -i -w /app <app-container> node - service-credential list < scripts/pcp-operator.js
docker exec -i -w /app <app-container> node - service-credential revoke --id svc_... < scripts/pcp-operator.js
docker exec -i -w /app <app-container> node - scoped-token revoke --id stk_... < scripts/pcp-operator.js
```

## Not in this phase

No broker process, no AstrBot HMAC/replay checks, no AstrBot plugin and no
broker-to-OpenClaw call yet; those are phases 2b–4 of the design. The OpenClaw
plugin (Phase 3) is `thirdparty/openclaw-pcp`.

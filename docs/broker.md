# PCP broker (AstrBot path)

Design Phase 4. AstrBot (QQ, WeChat official accounts, ...) reaches OpenClaw
only through PCP, and the sender's identity comes from the platform event,
never from message text.

Group messages include the platform-derived sender principal in stored text,
so recalled history retains speaker attribution after the turn grant expires.
Display names are escaped and marked untrusted; only the signed sender ID
determines identity and permissions. The relay handles LLM-triggering messages,
not passive group traffic or non-message platform notices.

Historical AstrBot context must be backfilled separately: the relay sends only
the latest event. Import private conversation and LivingMemory records into the
existing linked DM session, preserve source IDs and timestamps where known,
and keep group history in its own group session. Back up first, use stable
external message IDs for retries, and verify OpenClaw recall after importing.

```
QQ ─▶ AstrBot (wake, mention, rate limit, profile routing unchanged)
   ─▶ thirdparty/astrbot_plugin_pcp_relay   provider type pcp_relay
        stamp {platform, chat, group_id, sender_id, message_id, ts, nonce}
        HMAC-SHA256(signing key, body) + ingress credential
   ─▶ broker/server.js   127.0.0.1:3101, loopback only, never tunnelled
   ─▶ PCP  POST /api/v1/service/broker/turns
        ingress credential + signature + replay window + nonce  → else 401
        principal astrbot:<platform>:<sender_id> → linked user
        session: DM → the sender's own; group → the group's
        broker turn grant (server side), agent policy, bounded context
        records the user message
   ─▶ OpenClaw POST /v1/chat/completions      (gateway token: broker only)
        model openclaw/<agent>, x-openclaw-session-key: agent:<agent>:pcp:<grant id>
        system: "Verified sender (PCP-attested) …" + context; user: latest message
        openclaw-pcp tools: own credential + that key → PCP checks delegate
   ─▶ PCP  POST /api/v1/service/broker/turns/complete   (records reply, ends grant)
   ─▶ reply ─▶ AstrBot ─▶ QQ
```

## Credentials

| Name (convention) | Kind | Asserts | Accepted by | Held by |
|---|---|---|---|---|
| `astrbot-ingress` | `ingress` | `astrbot:` only | broker routes, via the broker, with a valid signature | AstrBot plugin (token + signing key) |
| `pcp-broker` | `broker` | nothing | broker routes only | broker (secret file) |
| `openclaw-pcp` | `channel` | `telegram:`, `openclaw-weixin:` | `/api/v1/service/*`; reads broker grants as the broker's delegate | OpenClaw plugin |
| OpenClaw gateway token | — | operator | OpenClaw | broker (secret file); not AstrBot |

- `channel` credentials can never assert the reserved `astrbot:` prefix (the
  admin API refuses it, and it is ignored at lookup even if stored), so an
  `astrbot:` principal always comes from a signed stamp.
- `ingress` and `broker` credentials get `401` on `/api/v1/service/*`: the
  AstrBot token cannot ask for grants itself.
- The signing key is `HMAC-SHA256(PCP_INSTANCE_SECRET, "pcp-astrbot-ingress-signing:v1:" + credential id)`.
  It is never stored; `scripts/pcp-operator.js` prints it once. Rotating the
  instance secret invalidates it (mint a new ingress credential).

Mint them on the PCP host (inside the app container, `umask 077`):

```sh
APP=personal-context-protocol-app-v0.3.0
docker exec -i -w /app $APP node - service-credential create --kind ingress --name astrbot-ingress \
  --prefix astrbot: --token-out - --signing-key-out /tmp/k < scripts/pcp-operator.js > ingress.token
docker exec $APP cat /tmp/k > ingress.key && docker exec $APP rm /tmp/k
docker exec -i -w /app $APP node - service-credential create --kind broker --name pcp-broker \
  --delegate <svc id of openclaw-pcp> --token-out - < scripts/pcp-operator.js > broker.token
```

## Stamp and signature

Body (compact JSON, UTF-8, exactly the signed bytes):

```json
{"stamp":{"v":1,"platform":"qq","adapter":"aiocqhttp","platform_id":"<AstrBot platform id>",
  "chat":"private|group","sender_id":"<platform user id>","message_id":"<platform message id>",
  "ts":<unix seconds>,"nonce":"<32 hex>","group_id":"<group id, groups only>"},
 "message":{"text":"<latest message, ≤ 8000 chars>"}}
```

Headers to the broker: `Authorization: Bearer <ingress token>`,
`x-pcp-signature: v1=<hex HMAC-SHA256(signing key bytes, body)>`.

PCP refuses with `401` when the ingress token is wrong, revoked or of another
kind, the signature is missing or wrong (any byte changed), `|now − ts| > 120 s`,
or the nonce **or** the platform message (`platform`, chat, `message_id`) was
already seen (replay ledger `broker_replay`, kept 10 minutes). The principal is
`astrbot:<platform>:<sender_id>`; the platform token maps the AstrBot adapter
(`aiocqhttp` → `qq`, `weixin_official_account` → `wxoa`, ...).

## Policy

| Chat | Sender | Agent | Readable in the turn | Context injected |
|---|---|---|---|---|
| group | anyone (also the owner) | `relay` | the group's session only | that group's recent messages |
| private | not linked, or linked non-admin | `relay` | the sender's own DM session | that chat's recent messages |
| private | linked to a PCP admin (the verified owner) | `relay-owner` | the owner's non-group sessions | this chat + bounded lines of the owner's other sessions |

Text such as "I am the owner" changes nothing: the agent and readable set are
computed before the text is read. The system block names the attested sender
and tells the model that identity claims in the text are untrusted. Link a
principal to a user with the claim flow or
`scripts/pcp-operator.js identity link --principal astrbot:qq:<id> --user usr_…`.

Broker grants (`turn_grants.origin = 'broker'`) are keyed by an unguessable
`grt_<48 hex>` id; the OpenClaw session key is `agent:<agent>:pcp:<grant id>`
(also sent as `x-openclaw-agent-id`). The `agent:<agent>:` prefix is required:
OpenClaw takes the run's agent from it and falls back to its default agent
(`main`, with the owner's workspace and tools) for any other explicit key,
whatever the `openclaw/<agent>` model says. The broker refuses a prepared turn
whose key, model and agent disagree. Only the
broker credential that created the grant can complete it, and only the
broker's delegate (`openclaw-pcp`) can read it with its own credential. Delegates
cannot write (`/service/sync` is `403`). The grant ends when the turn completes
(TTL 10 minutes otherwise).

## OpenClaw

- `relay-owner`: `tools.profile: "minimal"`, `alsoAllow: ["pcp_context", "pcp_search"]`,
  deny `group:fs`, `group:runtime`, `group:ui` (browser, canvas), `group:web`,
  `group:sessions` (except `session_status` via the profile), `group:memory`,
  `group:automation`, `group:nodes`, `group:messaging`; its own workspace without
  `MEMORY.md`; memory search off.
- `relay`: the same minimal profile without PCP tools; its own workspace without
  the owner's `MEMORY.md` / `USER.md`.
- openclaw-pcp's HTTP backstop treats `pcp:grt_…` keys as HTTP runs: only
  `pcp_*` tools may run, whatever the agent config says.

## Running it

`docker-compose.yml` service `broker` (profile `broker`): same image as the
app, `node broker/server.js`, host networking (the gateway listens on host
loopback), binds `127.0.0.1:${PCP_BROKER_PORT:-3101}` and refuses any other
address. Secrets are bind-mounted read-only from `PCP_BROKER_SECRETS_DIR`
(default `/home/motuariki/Documents/DockerVolumes/pcp/broker-secrets`, mode 700):

- `broker.token` — the `pcp-broker` credential;
- `openclaw-gateway.token` — the gateway token.

`deploy/jenkins/deploy.sh` starts the broker when that directory exists.
`GET /healthz` reports `{ status, configured }`.

## Failure behaviour

| Failure | Result |
|---|---|
| PCP down or slow, broker down, broker unconfigured | no reply (AstrBot plugin stops the event), logged |
| unsigned, tampered, stale or replayed stamp; wrong credential | `401`, no reply, logged |
| no stamp (event not attributable), credentials file missing or not private | no reply, logged; the broker is not called |
| OpenClaw error or empty reply | `502`; AstrBot shows its failure message; the turn is closed as failed |

## AstrBot plugin

See `thirdparty/astrbot_plugin_pcp_relay/README.md`. The profile's provider is
`pcp_relay/broker` (provider source `pcp_relay`, type `pcp_relay`). AstrBot's
own conversation history and persona are not sent: PCP holds the history and
OpenClaw the persona.

## Tests

- `tests/broker.test.ts`: signing (shared vector with the Python plugin),
  policy, prompt blocks, session keys, credential kinds, migration 014.
- `tests/broker-server.test.ts`: the broker process with fake upstreams
  (fail closed, 401 passthrough, token separation).
- `tests/broker-db.test.ts` (throwaway PostgreSQL): unsigned/replayed/stale
  401, kind binding, owner DM → `relay-owner` recalls Telegram via the
  delegate tools, forged owner text in a group changes nothing, group cannot
  recall the owner's DM, unlinked senders, turn recording and grant end.
- `thirdparty/astrbot_plugin_pcp_relay/tests` and `thirdparty/openclaw-pcp/test`.

## Administrator recall

A signed private message linked to a PCP administrator receives global read
access to active sessions, including unowned imports and group archives.
The `relay-owner` agent may use PCP recall/search for this scope. A group turn
still reads only its own group, even when the sender is an administrator.
No caller-supplied name or admin claim changes this policy; writes remain
limited to the turn's home session.

## Execution and media (0.4.0)

The policy file `PCP_EXECUTION_POLICY_FILE` can select `astrbot-exec` for verified
admin DMs and a distinct sandboxed agent for each allowed group. The dashboard
`/adapters` edits group/sender lists; the initial list is empty. Non-PCP tools
require `/service/execution` authorization on every call. The gateway token
alone, an agent name, or text claiming ownership cannot grant execution.
Group access never expands PCP history beyond the group's session.

Signed `message.media` carries bounded image bytes. PCP strips metadata and
persists sanitized content before returning vision parts for OpenClaw. The
broker still verifies policy upstream and holds the gateway credential; there
is no direct AstrBot gateway access. See `versions/v0.4.0.md`.

In 0.4.1 selected groups use a minimal agent and grant-checked `pcp_execute`, which delegates only to the isolated container runner. The dashboard creates the corresponding group agent. Voice WAV bytes are stored while AstrBot STT text is supplied to OpenClaw.

# openclaw-pcp

OpenClaw plugin for the Personal Context Protocol (design Phase 3, native
channels: Telegram and OpenClaw-WeChat). No runtime dependencies; Node 18.19+.

## What it does

| Hook / feature | Behaviour |
|---|---|
| `before_prompt_build` | For a trusted DM, asks PCP for a turn grant (`POST /api/v1/service/grants`) and, when the grant can read other sessions, a recall. Injects at most ~1.5 KB of recent cross-session lines inside `<pcp_context>…</pcp_context>`. Hard 2 s budget (`contextTimeoutMs`); if PCP is slow or down the run continues without context. |
| `pcp_context`, `pcp_search` | Optional tools (allow them per agent with `tools.alsoAllow`). They take only `limit` / `query`; the session key comes from the tool context and the plugin's own service credential is used. PCP enforces the grant. |
| `agent_end` | Uploads the last turn (user message plus assistant text; tool calls are not copied) to `POST /api/v1/service/sync`, external key `oc:<sessionId>:<user-message-timestamp>`. The injected `<pcp_context>` block is stripped first. |
| `before_compaction` / `after_compaction` | Flushes the queue before history is rewritten, then uploads the new compaction summary (`oc-compaction:<sessionId>:<entry-id>`, role `system`). |
| `after_tool_call` | Audits each `pcp_*` call into the home session (`oc-audit:…`, role `tool`): tool, query, result count, duration. |
| `before_tool_call` | HTTP API backstop: for session keys matching `httpSessionKeyPatterns` (default `^agent:[^:]+:openai(?:[-:]|$)` and `(?:^|:)pcp:grt_`, i.e. `/v1/chat/completions` runs and PCP broker turns), every tool except `httpToolAllowlist` (default `pcp_context`, `pcp_search`) is refused. Active even if PCP is unconfigured. |
| `ownerBoundChannels` | Owner-bound channels (default none): no claim links; a DM there is the owner only if its principal is exactly a pinned `ownerPrincipals` entry. Any other DM principal on that channel is restricted to its own home session (no cross-session context, tool results filtered to the home session, even if PCP reports it linked) and a warning is logged. See below. |
| `message_sending` | Claim link: on the first reply of a new (no earlier messages), unlinked, direct session on a channel in `claimChannels` (default `telegram`), appends one single-use `…/claim?code=…` link returned by PCP. The code is never put in the prompt or transcript. Skipped for groups, unattributed sessions, linked principals, and channels whose plugin does not run `message_sending` (the bundled OpenClaw-WeChat build stubs that hook out). |

Uploads are redacted (`lib/redact.js`: PCP's export patterns plus GitHub,
OpenAI/Anthropic, Slack, Google, AWS, Telegram bot tokens, JWTs, cookies,
`pcps_` tokens, URL passwords, labelled secrets) **before** they are written to
the retry queue. The queue (`<stateDir>/queue.json`, mode 600, atomic replace)
holds at most `maxQueueItems` (500) items, retries with exponential backoff
(5 s to 1 h, 12 attempts) and drops items PCP rejects with a 4xx. PCP
deduplicates by external key, so a retried upload records nothing twice.

## PCP broker turns (AstrBot path)

Sessions keyed `pcp:grt_<48 hex>` (also as `agent:<id>:pcp:…`) are broker
turns: PCP created the grant from a signed AstrBot stamp. The plugin then
skips grants, context, sync and claims (the broker does those), and the tools
call recall/search with this plugin's credential and that key; PCP accepts it
only because this credential is the broker credential's delegate, read-only.
The HTTP backstop covers these keys too, so only `pcp_*` tools ever run.

## Trusted principal

The principal comes from the session key OpenClaw derived from the platform
peer, never from message text or tool arguments:

- `agent:<a>:direct:<peer>` (dmScope `per-peer`): if `<peer>` is a
  `session.identityLinks` name (e.g. `owner`), the linked id for the runtime
  channel (`ctx.channelId`) is used; otherwise `<channel>:<peer>`.
- `agent:<a>:<channel>[:<account>]:direct:<peer>`: `<channel>:<peer>`.
- `agent:<a>:<channel>:group:<id>`: no context, no sync, no claims; tools get
  a group grant (that group's own session only) using the trusted
  `requesterSenderId`.
- Anything else (HTTP `openai*`, `main`, cron, heartbeat): unattributed, no PCP.

Only principals with a prefix in `allowedPrefixes` (default `telegram:`,
`openclaw-weixin:`) are asserted; the service credential is bounded the same
way server-side.

## Owner-bound channels

Some channels are bound 1:1 to the owner's own account: the bundled
OpenClaw-WeChat plugin logs in as one WeChat account and every DM it gets is
from the owner, always on the `main` agent. For those, set

```json
"ownerBoundChannels": ["openclaw-weixin"],
"ownerPrincipals": ["openclaw-weixin:<owner wxid>@im.wechat"]
```

- The pin is compared exactly (case-sensitive) with the trusted principal.
  OpenClaw lowercases peer ids in session keys, so route the owner through
  `session.identityLinks` (`agent:<a>:direct:owner`), which keeps the
  platform's case, and pin the same string.
- PCP still decides what the turn reads: the pinned principal must be linked
  to the owner's PCP user (operator CLI `identity link`, since the channel
  cannot show claim links). Then its grant reads every non-group session of
  that user (Telegram, QQ via `relay-owner`, WeChat), and those channels see
  its turns. A pinned but unlinked owner logs one warning.
- Not a blanket rule: an unpinned principal on an owner-bound channel is an
  unlinked sender (home session only, no claim) and logs a warning that does
  not echo the sender id. Pins that are malformed, on another channel or
  outside `allowedPrefixes` are ignored with a warning; an owner-bound
  channel with no valid pin restricts every DM on it.
- Groups, other channels, the HTTP backstop and the service credential scope
  are unchanged.

## Configuration

```json
"plugins": {
  "allow": ["…", "openclaw-pcp"],
  "load": { "paths": ["…", "/home/node/.openclaw/extensions/openclaw-pcp"] },
  "entries": {
    "openclaw-pcp": {
      "enabled": true,
      "config": {
        "baseUrl": "http://127.0.0.1:3000",
        "tokenFile": "/home/node/.openclaw/credentials/pcp-service.token",
        "stateDir": "/home/node/.openclaw/pcp-sync"
      }
    }
  }
}
```

and `"tools": { "alsoAllow": ["pcp_context", "pcp_search"] }` on the agents
that should have the tools. `baseUrl` must be https or loopback http.

The token file holds a PCP service credential (`pcps_…`). Mint one on the PCP
host without a browser:

```sh
docker exec -i -w /app <pcp-app-container> node - service-credential create \
  --name openclaw-pcp --prefix telegram: --prefix openclaw-weixin: --token-out - \
  < scripts/pcp-operator.js > pcp-service.token   # umask 077 first
```

Revoke with `service-credential revoke --id <svc_…>` (or
`DELETE /api/v1/service-credentials` as an admin).

## Tests

```sh
cd thirdparty/openclaw-pcp && npm test   # node:test, no install needed
```

## Known limits

- The HTTP backstop keys off the session key. A caller that holds the gateway
  token and sends an explicit `x-openclaw-session-key` can pick another key;
  the gateway token is operator-level, so this is a backstop, not a boundary.
- Agents with file or exec tools in the same gateway can read the token file.
  Keep the credential platform-scoped (it is never admin).
- Cross-channel recall needs the principals linked to a PCP user (claim flow,
  or the operator CLI for owner-bound channels). Until then each principal
  only reads its own DM session.

## Historical backfill

Live `agent_end` sync records new turns; installation does not scan old session
files. Use `scripts/backfill.mjs` to replay operator-selected snapshots through
the installed plugin's `agent_end`, redaction, durable queue, grants and sync
client. No model is run and no channel reply is sent.

Create a private JSON array manifest with one entry per immutable snapshot:

```json
[{"file":"/private/transcript.jsonl","source_sha256":"<snapshot-sha256>",
  "sessionId":"<original-session-id>",
  "sessionKey":"agent:main:telegram:direct:<verified-peer-id>",
  "channel":"telegram","userMessageIds":["<original-user-message-id>"]}]
```

Verify the peer using the session's transport metadata; quoted names in chat
text are not identity evidence. Select only turns from that peer and chat.
The manifest must not relabel group history as a private conversation. Each
selected user message includes its assistant continuation, stopping at the
next user message. Tool results and thinking are excluded as in normal sync.

Run inside the gateway with its existing credential and private configuration:

```sh
node /path/to/openclaw-pcp/scripts/backfill.mjs /private/manifest.json /private/openclaw.json /private/backfill-state
# Review counts, then apply:
node /path/to/openclaw-pcp/scripts/backfill.mjs /private/manifest.json /private/openclaw.json /private/backfill-state --apply
```

Use a dedicated state directory, separate from the gateway's live queue.
Snapshot hashes are verified; original session IDs and user timestamps retain
the normal `oc:<session>:<timestamp>` idempotency keys. Rerunning the same
manifest resumes safely and does not duplicate existing turns. Logs report
counts, never conversation content. Queue failures stop replay for inspection.
Verify remote message counts and search from an authorized channel afterward.

PCP v0.3.2 gives verified admin DMs read access to all active sessions; other
users and groups retain their existing restrictions. Admin status is resolved
by PCP from the linked identity, never from a display name or tool argument.

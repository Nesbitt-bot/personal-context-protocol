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
| `before_tool_call` | HTTP API backstop: for session keys matching `httpSessionKeyPatterns` (default `^agent:[^:]+:openai(?:[-:]|$)`, i.e. `/v1/chat/completions` runs), every tool except `httpToolAllowlist` (default `pcp_context`, `pcp_search`) is refused. Active even if PCP is unconfigured. |
| `message_sending` | Claim link: on the first reply of a new (no earlier messages), unlinked, direct session on a channel in `claimChannels` (default `telegram`), appends one single-use `…/claim?code=…` link returned by PCP. The code is never put in the prompt or transcript. Skipped for groups, unattributed sessions, linked principals, and channels whose plugin does not run `message_sending` (the bundled OpenClaw-WeChat build stubs that hook out). |

Uploads are redacted (`lib/redact.js`: PCP's export patterns plus GitHub,
OpenAI/Anthropic, Slack, Google, AWS, Telegram bot tokens, JWTs, cookies,
`pcps_` tokens, URL passwords, labelled secrets) **before** they are written to
the retry queue. The queue (`<stateDir>/queue.json`, mode 600, atomic replace)
holds at most `maxQueueItems` (500) items, retries with exponential backoff
(5 s to 1 h, 12 attempts) and drops items PCP rejects with a 4xx. PCP
deduplicates by external key, so a retried upload records nothing twice.

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
- Cross-channel recall needs the principals linked to a PCP user (claim flow).
  Until then each principal only reads its own DM session.

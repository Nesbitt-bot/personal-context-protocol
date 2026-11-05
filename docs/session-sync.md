# Session sync M0

PCP and the OpenCode session-manager plugin use a stable external session key
to make retries safe:

```text
<device-id>:<source-kind>:<native-session-id>
```

For example:

```text
win-384de1b4:codex:0199abcd-…
```

The key is stored on `sessions.external_key`. It is deliberately separate from
the PCP UUID and from OpenCode's local session id, so a session can be copied
between devices without changing its origin identity.

## Configure the plugin

In the OpenCode plugin dashboard, open **Session Manager** and set:

- **PCP base URL** — the public PCP origin, for example `https://pcp.example.com`
- **PCP scoped token** — a global token with `read_all`, `create_sessions`, and
  `mint_tokens`

The values are stored in `~/.config/opencode/pcp.json`. The token is never
included in status output.

## Push workflow

1. Run `session_scan` to refresh the local source index.
2. Use `pcp_sync` with `dryRun: true` to inspect the pending list.
3. Run `pcp_sync` or `pcp_push` for one session.

The plugin creates or reuses the PCP session using `external_key`, then appends
only the turns after its local PCP cursor. Source growth is therefore append
only. The local cursor is persisted in `session-index.json` under `entry.pcp`.

PCP also makes the append itself idempotent: a message whose role, content
and `provider_timestamp` already exist in the session is not stored again
(the response marks it `duplicate`), under a per-session lock. A push that
replays from a stale local cursor (crash after a successful append, a lost
index, a second device) therefore records nothing twice, as long as the
messages carry their timestamps. Messages without a timestamp have no
identity to compare and are stored as sent.

The existing OpenCode import cursor (`entry.imported`) remains independent from
the PCP cursor. A session can be imported locally, pushed remotely, or both.

## Compatibility boundary

The current milestone syncs external Claude Code, Codex, and dsh transcripts
into PCP. Pulling PCP sessions back into a new OpenCode installation, rewrite
branch links, and remote task restart are the next milestones. Existing PCP
agent recording and manager APIs continue to work for clients that do not send
`external_key`.

# claude-code-pcp

Claude Code plugin that auto-syncs a session's status with Personal Context
Protocol (PCP), and guards against resuming a previously-synced session while
PCP is unreachable.

## Behavior

- On **SessionStart** the `session-start` hook derives the session's stable key
  (`<device>:claude:<sessionId>` — the session id and the directory it was
  created in never change, so this is stable even if the session is later opened
  through OpenCode).
- It fetches the remote status from `GET /api/v1/manager/sessions/by-key/<key>`.
- If PCP is **unreachable** and the session was **previously synced**, it warns
  the user and injects context telling Claude not to resume the old
  conversation (the agent might otherwise write a stale copy that conflicts with
  the remote).
- If the session was **never synced**, it allows the session to start offline.
- On success it records a local sync marker (`~/.local/state/pcp/claude-code-sync.json`)
  so the next offline resume is guarded.

> **Note on blocking.** Claude Code `SessionStart` hooks are context-only: they
> cannot hard-block a session from starting. For `SessionStart`, a
> `decision: "block"` result and a non-zero exit code are not honored (a
> non-zero exit only shows stderr to the user). This hook therefore warns the
> user via `systemMessage` and instructs Claude via
> `hookSpecificOutput.additionalContext` instead of blocking. To enforce a hard
> stop, check PCP connectivity before launching `claude` or gate the resume in
> the PCP manager itself.

## Install

Load the plugin directly from this folder for one session (development):

```bash
claude --plugin-dir /path/to/claude-code-pcp
```

For a permanent install, publish this folder through a marketplace (a directory
with a `.claude-plugin/marketplace.json` that lists this plugin) and install it
with `claude plugin install claude-code-pcp@<marketplace>`.

Alternatively, register just the hook in `settings.json` (no plugin wrapper):

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node",
            "args": ["/path/to/claude-code-pcp/hooks/session-start.mjs"]
          }
        ]
      }
    ]
  }
}
```

> Note: the plugin `name` `claude-code-pcp` starts with the `claude-` prefix that
> Claude Code reserves for its own plugins. Newer `claude plugin validate`
> versions may report it as reserved; the plugin still loads.

## Config

Create `~/.config/pcp/claude-code.json` (or use env vars):

```json
{
  "baseUrl": "https://pcp.trance-0.com",
  "tokenFile": "/home/<user>/.config/pcp-operator/session-import.token",
  "deviceId": "linux-1048b0a6"
}
```

Env overrides: `PCP_BASE_URL`, `PCP_TOKEN_FILE`, `PCP_DEVICE_ID`.

The token is a **scoped PCP token** with `read_all`, `create_sessions` and
`mint_tokens` (the same one `pcp-session-import` uses). It is a permanent,
no-expire credential used only to open the active connection; each actual sync
should mint a fresh temporary link (see the PCP dashboard key icon) so multiple
writers cannot interleave.

## Manual sync

Run the `/claude-code-pcp:pcp-sync` command to push this conversation (direct
upload or a `<PCP_TRANSCRIPT>` fallback). The command is the
`commands/pcp-sync.md` file, namespaced under the plugin name.

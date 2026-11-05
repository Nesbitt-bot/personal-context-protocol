# pcp-session-import

Uploads the coding sessions collected by the OpenCode `session-manager` plugin
(Claude Code, Codex, dsh and native OpenCode sessions, from every device) to
PCP. Plain Node 18+, no dependencies; reading a live OpenCode database needs
the `sqlite3` CLI (opened `-readonly`).

## Sources

- `--shared DIR`: the session-manager shared folder (for example a Nextcloud
  `opencode-sync` folder): `projects/*/imported/<session-id>/<device>-<hash>.json`.
- `--opencode-db FILE`: a local `opencode.db` (sessions not yet exported).

Each copy is one candidate. Copies are de-duplicated by source identity
(`<kind>:<native-id>`, e.g. the Codex rollout id). The canonical copy has the
most messages, then the latest update, then the live database. Only
non-synthetic text parts are kept, one PCP message per OpenCode message (the
same turns the plugin's `pcp_sync` pushes).

## PCP mapping

- `external_key` `<origin-device>:<kind>:<native-id>`, the plugin's convention,
  so reruns and the plugin resolve to the same PCP session.
- Title `opencode:<device>:<project> [<kind>] <title>`; `provider` is the kind.
- Mode `wild`, because content is redacted before upload. Sessions are not
  made public and get no owner, so PCP keeps them admin-only.
- Append-only: the remote `message_count` (`GET /manager/sessions/by-key`) is
  the cursor. Up-to-date sessions are skipped without calling
  `POST /manager/sessions` (each call mints a session token). A remote that is
  ahead of the local copy is reported, never rewritten.
- Messages over 100,000 characters are truncated with a note; batches hold at
  most 50 messages and about 2 MB.

## Redaction

Runs before upload. PCP's export patterns (`src/lib/ingest-export.ts`) plus
GitHub, OpenAI/Anthropic/Google, Slack, PCP service tokens, JWTs, cookies,
Basic auth, URL credentials, compound labels (`DJANGO_SECRET_KEY=`,
`access_token:`), unterminated private keys and long high-entropy strings.
Counts are reported per kind; values are never printed.

## Use

The token is a scoped PCP token with `read_all`, `create_sessions` and
`mint_tokens`, kept in a private file (mode 600) outside any repository, for
example minted with `scripts/pcp-operator.js scoped-token create`.

```sh
# Dry run (default): local counts only
node import-sessions.mjs --shared ~/Nextcloud/opencode-sync --opencode-db ~/.local/share/opencode/opencode.db
# Dry run with the remote plan (create / append / up-to-date), read-only
node import-sessions.mjs ... --base-url http://127.0.0.1:3000 --token-file ~/.config/pcp-operator/session-import.token
# Upload what PCP is missing
node import-sessions.mjs ... --base-url http://127.0.0.1:3000 --token-file ... --upload
```

## Organize into projects (PCP >= 0.2.2)

`organize-projects.mjs` reads the same sources and groups the sessions into PCP
projects that map one-to-one to the session-manager's canonical project
(git remote, else directory name; explicit aliases via `--aliases FILE`, a JSON
object `{ "name:<folder>": "git:<host/owner/repo>" }`). It finds a workspace per
machine from each session's real directory (Windows paths normalized,
placeholder and Codex throwaway worktrees skipped) and, with `--openclaw-git
DIR`, the OpenClaw container checkouts (`/home/node/.openclaw/workspace/git/<repo>`).

- Dry run (default) writes nothing. PCP's sessions come from a read-only
  export (`pcp-operator.js sessions export`, `--pcp-sessions FILE`) or from
  read-only by-key lookups (`--base-url`, `--token-file`). `--plan-out FILE`
  writes the full proposal (mode 600).
- `--apply` (with a global scoped token that has `manage_projects`) only adds
  projects, aliases, workspaces and session `project_id` / task title links
  through the manager API. No deletes, no message changes; a rerun reports 0
  changes. `--all-projects` also creates projects without PCP sessions.

Full runbook: `docs/projects.md`.

Tests: `node --test` in this directory.

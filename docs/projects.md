# Projects across machines

Since v0.2.2 PCP has first-class **projects**. A project is one piece of work
(normally one git repository) that may be checked out on several machines:
OpenClaw containers, the Linux host, other Linux machines, Windows and macOS.
A **session** holds the context of one task inside a project.

| Table | What it holds |
|---|---|
| `projects` | display name, canonical key, description, git remotes, owner, per-field sync clocks |
| `project_aliases` | explicit extra keys that resolve to a project (e.g. `name:old-folder-name`) |
| `project_workspaces` | where the project lives on each machine: device id, label, kind (`openclaw-container`, `linux`, `linux-remote`, `windows`, `macos`), absolute directory, default branch, last seen |
| `sessions.project_id`, `context_title`, `context_summary` | the project a session belongs to and what this task is about |
| `sync_conflicts`, `merge_tasks` | the losing side of concurrent edits, and pending AI merge requests |

See [data-model.md](data-model.md) for columns and
[protocol.md](protocol.md#projects-web-ui) for the APIs.

## Identity: one PCP project per session-manager project

PCP uses the same identity as the OpenCode `session-manager` plugin
(`opencode/lib/project-identity.ts` in the AGENTS.md repository), so a PCP
project corresponds to exactly one canonical session-manager project:

1. **Git remote.** Normalized to `host/owner/repo` like the plugin's
   `remoteKey` (scheme, credentials, `.git`, trailing slash dropped; host
   lower-cased). Canonical key `git:<host/owner/repo>` (lower-cased). Two
   machines that cloned one repository share the project whatever directory
   or hash they used locally.
2. **Directory name.** Without any remote: `name:<basename>` (lower-cased),
   the plugin's `idForName`.
3. **Aliases.** Anything else that should resolve to a project is an explicit
   row in `project_aliases`. PCP never folds two projects together by guessing.

Remotes and aliases are only ever added. The resolve API
(`GET /manager/projects/resolve`) tries the remote, then a registered
workspace directory (on that device), then the name or alias.

### Why the session-manager folders split

The plugin names shared folders `projects/<name>-<sha256(project id)[:10]>`
(the local placeholder worktrees use 16 hex characters). The hash is derived
from the OpenCode project id, not from the path, so the same id gives the same
folder on every device. Splits happen when the **id** differs:

- a transcript that recorded a remote (Codex) gets `sha1("git-remote:" +
  remote)`, while one from the same directory that did not (dsh, some Claude
  Code) gets `name:<basename>`. The plugin's resolver adopts a remote across
  sessions only within one indexing pass, so across devices and passes both
  ids persist: the same repository appears twice (for example `circtime` and
  `circtime` with different hashes).
- native OpenCode sessions keep OpenCode's own id (the root commit), which
  differs from the remote-derived id of imported sessions of the same repo;
  such a project can also collect sessions from other directories.
- the directory name can differ from the repository name
  (`marketing-roi-analysis` checked out from `MTA-strategy-optimizer`).

PCP resolves these by remote first. For reorganizing existing data the planner
(`thirdparty/pcp-session-import/organize-projects.mjs`) also uses evidence:
a remote recorded for the **same directory** by another session, the remote
whose plugin id equals the session's OpenCode project id, git on the host, or
the only remote ever seen for that directory name. Each name it folds in this
way is registered as an explicit alias, and `--aliases FILE` adds or overrides
mappings by hand.

## Workspaces and "how to start dev here"

Workspaces come from the plugins (`POST /manager/projects/:id/workspaces`), the
admin UI, or the reorganization. Directories are normalized (`d:\x\` and
`D:/x` are one workspace). The session-manager's placeholder worktrees under
`~/.local/share/opencode/session-manager/projects/` and Codex's throwaway
`~/.codex/worktrees/` are never workspaces.

The project page shows each workspace with a snippet: `git clone` into the
directory when it is missing, then `cd` (PowerShell `Set-Location` on
Windows), then `opencode`, whose Session Manager lists every machine's
sessions for the project. For a project with a remote and no OpenClaw
workspace yet it suggests `/home/node/.openclaw/workspace/git/<repo>` for the
OpenClaw container.

## Multi-machine sync

Plugins send every change with their own `updated_at` and `device_id`; the
policy (last writer wins, clamped future clocks, conflicts kept for review,
append-only message merge, AI merge requests) is specified in
[protocol.md](protocol.md#sync-conflict-policy).

## Reorganizing imported sessions (operator runbook)

Run on the host that has the session-manager data, after the new version is
deployed (the apply step needs migration 013). Nothing is deleted and no
message content changes; a rerun is a no-op.

```sh
cd thirdparty/pcp-session-import
# 1. Read-only export of PCP's session identities (no message content).
docker exec -i -w /app <app-container> node - sessions export < ../../scripts/pcp-operator.js > /private/path/pcp-sessions.json
# 2. Dry run: proposed projects, session mapping, workspaces per machine.
node organize-projects.mjs --shared <session-manager shared folder> --opencode-db <opencode.db> \
  --openclaw-git <host path of the OpenClaw workspace git folder> \
  --pcp-sessions /private/path/pcp-sessions.json --plan-out /private/path/plan.json
# 3. Back up the database (deploy/jenkins/backup_database.sh <backup dir>).
# 4. Mint a scoped token with manage_projects (shown once, written to a 600 file).
docker exec -i -w /app <app-container> node - scoped-token create --name organize-projects \
  --permission read_all --permission manage_projects --expires 24h --token-out - \
  < ../../scripts/pcp-operator.js > /private/path/organize.token
# 5. Apply through the manager API, then run the same command again: every count must be 0.
node organize-projects.mjs <same sources> --base-url http://127.0.0.1:<app port> \
  --token-file /private/path/organize.token --apply
# 6. Revoke the token: pcp-operator.js scoped-token revoke --id <stk_...>
```

The apply step ensures each project by canonical key with its remotes and
aliases, registers its workspaces and links each PCP session to its project
with a task title (the source title without the importer's
`opencode:<device>:<project> [kind]` label), using the session's own last
update time and origin device as the write clock.

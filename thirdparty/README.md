# thirdparty

Channel plugins and sync tools that connect other systems to PCP. They are
built, tested and deployed separately from the PCP web app and are excluded
from the Docker image (`.dockerignore`).

- `openclaw-pcp/`: OpenClaw plugin (design Phase 3, native Telegram and
  OpenClaw-WeChat). It provides turn grants and a bounded cross-session context
  summary, grant-checked `pcp_context` / `pcp_search` tools, async redacted
  turn, compaction and PCP-access sync through an on-disk retry queue, the
  HTTP-run tool backstop, claim links, and owner-bound channels (a pinned
  owner principal on a channel bound to the owner's own account, e.g.
  OpenClaw-WeChat). See `openclaw-pcp/README.md`.
- `pcp-session-import/`: rerunnable, idempotent upload of the coding sessions
  collected by the OpenCode `session-manager` plugin (Claude Code, Codex, dsh,
  OpenCode; all devices), and `organize-projects.mjs`, which groups those
  sessions into PCP projects with their workspaces per machine (PCP >= 0.2.2).
  See `pcp-session-import/README.md` and `docs/projects.md`.

- `astrbot_plugin_pcp_relay/`: AstrBot plugin (design Phase 4) that stamps the
  platform identity of QQ / WeChat official-account messages, signs it, and
  relays the latest message through the loopback PCP broker; fail closed. See
  its `README.md` and `docs/broker.md`.

Tests need no install: `bash deploy/jenkins/thirdparty_test.sh` runs every
suite (Node's built-in runner; Python `unittest`) in network-less containers,
as Jenkins does. Deploy with `deploy/plugins/sync_openclaw_pcp.sh` and
`deploy/plugins/sync_astrbot_relay.sh` (no-op unless changed).

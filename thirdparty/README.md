# thirdparty

Channel plugins and sync tools that connect other systems to PCP. They are
built, tested and deployed separately from the PCP web app and are excluded
from the Docker image (`.dockerignore`).

- `openclaw-pcp/`: OpenClaw plugin (design Phase 3, native Telegram and
  OpenClaw-WeChat). It provides turn grants and a bounded cross-session context
  summary, grant-checked `pcp_context` / `pcp_search` tools, async redacted
  turn, compaction and PCP-access sync through an on-disk retry queue, the
  HTTP-run tool backstop, and claim links. See `openclaw-pcp/README.md`.
- `pcp-session-import/`: rerunnable, idempotent upload of the coding sessions
  collected by the OpenCode `session-manager` plugin (Claude Code, Codex, dsh,
  OpenCode; all devices). See `pcp-session-import/README.md`.

Planned:

- `astrbot_plugin_pcp_relay/`: AstrBot plugin that stamps the platform identity
  of QQ / WeChat official-account messages and relays them through the PCP
  broker.

Tests use Node's built-in runner, no install needed:
`cd thirdparty/openclaw-pcp && npm test` and
`cd thirdparty/pcp-session-import && node --test`.

---
description: Sync this conversation into Personal Context Protocol
argument-hint: ""
---

Sync this conversation into the user's own self-hosted Personal Context Protocol (PCP) notebook.

The plugin's `SessionStart` hook already recorded this session's remote status. Do the following, then report the outcome honestly:

1. Read the token from `~/.config/pcp-operator/session-import.token` (never print it) and the base URL from `~/.config/pcp/claude-code.json` (`baseUrl`, default `https://pcp.trance-0.com`).
2. The session's stable key is `<deviceId>:claude:<sessionId>` (see `lib/pcp.mjs`). Look up the remote session:
   - `GET <baseUrl>/api/v1/manager/sessions/by-key/<key>` with `Authorization: Bearer <token>`.
3. If you have a web/HTTP tool, push any new messages:
   - `POST <baseUrl>/api/v1/manager/sessions` `{ external_key: "<key>", title: "<concise 3–8 word title>", agent_name: "claude", device_id: "<deviceId>" }` (idempotent; returns the session id).
   - `POST <baseUrl>/api/v1/manager/sessions/by-key/<key>/merge-messages` `{ device_id: "<deviceId>", agent_name: "claude", messages: [{ external_id, role, content, provider: "anthropic", base_model, provider_timestamp }] }`.
4. If you cannot push, output a `<PCP_TRANSCRIPT v=1 title="…">…</PCP_TRANSCRIPT>` block for the user to paste into their dashboard. That is a good outcome, not a failure.
5. Only claim the sync succeeded after a 2xx with `{ ok: true }` / `{ success: true }`.

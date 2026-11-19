# PCP for Codex

From the PCP checkout, run `codex plugin marketplace add "$PWD"` then
`codex plugin add pcp@personal-context-protocol`. Enable/trust the SessionStart
hook in Codex if prompted. Configure `~/.config/pcp/codex.json` with `baseUrl`
(the HTTPS origin of your PCP), `deviceId` (the same ID as your session importer),
and optionally `tokenFile` (defaults to `~/.config/pcp-operator/session-import.token`).
Use a private scoped token with `read_all` and `create_sessions` permissions.

The hook sends the device ID, Codex thread ID, agent name and last directory
component to your PCP. It does not read transcripts, prompts or tool output.
PCP creates a private session and its linked task; resuming an existing thread
only checks its external key. A failed registration can be retried on resume.

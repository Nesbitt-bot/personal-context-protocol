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
reuses the external key rather than creating a second task.

## Live presence

SessionStart on Linux starts a 20-second heartbeat tied to an open file descriptor
for that exact thread in the Codex host process. It cannot keep a crashed thread
alive just because the editor is still running. SessionEnd closes the lease.
Without a verifiable thread owner, the reporter does not claim a green light.
The dashboard expires leases after 65 seconds and polls every 10 seconds. Clean
exits and records that never participated are neutral. Mixed task subtrees show a green light on a red background. The dashboard
does not use message age to infer liveness. Without a matching OpenCode session-manager
push receipt, a registered session is not verified in sync and stays red.

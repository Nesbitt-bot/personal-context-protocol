# astrbot_plugin_pcp_relay

AstrBot plugin (design Phase 4): identity-stamped, fail-closed relay to
OpenClaw through the PCP broker. Standard library only; tested with AstrBot
4.29.

- `on_llm_request` builds a stamp from the platform event: platform (from the
  adapter type), private/group, group id, sender id, message id, time, nonce.
  Message text never feeds the stamp.
- Group messages retain a platform-derived sender principal and an escaped,
  explicitly untrusted display name in recorded text. Later context recall
  distinguishes members after the turn grant expires. Private message text
  is unchanged; display names never grant identity or access.
- Provider type `pcp_relay` signs `{stamp, message}` with HMAC-SHA256 and
  posts it with the AstrBot ingress credential to the loopback broker, which
  verifies nothing itself and forwards to PCP; PCP decides the agent and the
  readable context. Only the latest message is sent; AstrBot's history,
  persona prompt and tools are not used by this provider.
- Fail closed: no stamp, unusable credentials, broker/PCP down, or any `401`
  → the event is stopped and nothing is sent (logged). OpenClaw failure
  (`502`) → AstrBot's normal failure message.
- Other plugins' own LLM tasks (no platform session, e.g. summaries or group
  analyses that fall back to the profile's provider) get an error response
  and never touch the pending turn. Give such plugins an explicit provider.

## Install

1. Copy this directory (without `tests/`) to
   `data/plugins/astrbot_plugin_pcp_relay/` (or run
   `deploy/plugins/sync_astrbot_relay.sh` from the PCP repo).
2. Credentials file (mode 600, AstrBot's user):
   `data/plugin_data/astrbot_plugin_pcp_relay/credentials.json`
   `{"token": "pcps_…", "signing_key": "<64 hex>"}` from
   `pcp-operator.js service-credential create --kind ingress …` (see
   `docs/broker.md`). The file is refused if group or world can read it.
3. Provider source and provider in `cmd_config.json`:

   ```json
   {"id": "pcp_relay", "type": "pcp_relay", "provider_type": "chat_completion", "enable": true,
    "key": [""], "broker_url": "http://127.0.0.1:3101",
    "credentials_file": "/AstrBot/data/plugin_data/astrbot_plugin_pcp_relay/credentials.json", "timeout": 240}
   {"id": "pcp_relay/broker", "provider_source_id": "pcp_relay", "model": "broker", "enable": true, "modalities": ["text"]}
   ```

4. Select `pcp_relay/broker` as the profile's chat provider
   (`agent_runner.config.model.provider_id`), with no fallback providers (a
   fallback would bypass the identity check).

`broker_url` must be loopback http (or https). The OpenClaw gateway token is
never configured in AstrBot.

## Tests

`python -m unittest discover -s tests` (stubs the AstrBot API; no install).

## Execution and media update

PCP 0.4.0 authorizes execution per tool through a live broker grant and the
private dashboard-managed adapter policy. Unlisted groups remain restricted.
Image/GIF turns are bounded, signed, normalized without metadata and retained
in authorized PCP history. Native images use the durable sync queue; AstrBot
collects only platform image segments. No source URLs or credentials enter
public streams. The PCP plugin also provides `pcp_attachment` for authorized
image recall.

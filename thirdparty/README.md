# thirdparty

Channel plugins that connect chat platforms to PCP. They are built, tested and
deployed separately from the PCP web app and are excluded from the Docker image
(`.dockerignore`).

Planned contents (later phases of the identity/context-sync design):

- `openclaw-pcp/` — OpenClaw plugin: requests turn grants and context from PCP
  with its own service credential, exposes grant-checked `pcp_*` tools, and
  reports turns asynchronously.
- `astrbot_plugin_pcp_relay/` — AstrBot plugin: stamps the platform identity of
  QQ / WeChat official-account messages and relays them through the PCP broker.

Neither plugin exists yet; this directory is a placeholder.

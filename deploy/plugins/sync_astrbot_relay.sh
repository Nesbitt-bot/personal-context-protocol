#!/usr/bin/env bash
# Sync thirdparty/astrbot_plugin_pcp_relay into AstrBot, only when it changed.
#
#   changed? -> back up the installed copy -> install into
#   data/plugins/astrbot_plugin_pcp_relay -> restart AstrBot (container
#   restart, never recreate) -> plugin and pcp_relay provider loaded, IM
#   adapters loaded -> done, otherwise restore the backup and restart again.
set -Eeuo pipefail
cd "$(dirname "$0")/../.."
AB=${ASTRBOT_CONTAINER:-astrbot}
DEST=${ASTRBOT_PLUGIN_DIR:-/AstrBot/data/plugins/astrbot_plugin_pcp_relay}
SRC=thirdparty/astrbot_plugin_pcp_relay
BACKUPS=${PCP_PLUGIN_BACKUP_DIR:-/home/motuariki/Documents/DockerVolumes/pcp/plugin-backups}

say() { echo "$1"; }
fail() { echo "Plugin sync failed: PCP.Plugins/astrbot_plugin_pcp_relay — $1" >&2; exit 1; }

docker inspect "$AB" >/dev/null 2>&1 || fail "AstrBot container $AB not found"
mapfile -t FILES < <(cd "$SRC" && find . -type f ! -path './tests/*' ! -path '*/__pycache__/*' | sed 's#^\./##' | sort)
LOCAL=$(cd "$SRC" && sha256sum "${FILES[@]}")
REMOTE=$(docker exec -w "$DEST" "$AB" sha256sum "${FILES[@]}" 2>/dev/null || true)
if [[ "$LOCAL" == "$REMOTE" ]]; then
  say "Plugin current: PCP.Plugins/astrbot_plugin_pcp_relay — installed copy matches $SRC; AstrBot not restarted."
  exit 0
fi

loaded() { # loaded <since>
  local since=$1
  for _ in $(seq 1 40); do
    local logs
    logs=$(docker logs --since "$since" "$AB" 2>&1 | sed 's/\x1b\[[0-9;]*m//g')
    if { [[ "$NEEDS_PROVIDER" != 1 ]] || grep -q 'Loading model pcp_relay' <<<"$logs"; } && grep -q 'Loading IM platform adapter' <<<"$logs" \
       && ! grep -qE 'Failed to (import|load) plugin astrbot_plugin_pcp_relay|Provider adapter not found: pcp_relay|Failed to instantiate provider adapter pcp_relay' <<<"$logs"; then
      return 0
    fi
    sleep 3
  done
  return 1
}

# Require the provider line only once a pcp_relay provider is configured.
NEEDS_PROVIDER=0
docker exec "$AB" grep -q '"pcp_relay"' /AstrBot/data/cmd_config.json 2>/dev/null && NEEDS_PROVIDER=1
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
BACKUP="$BACKUPS/astrbot_plugin_pcp_relay-$STAMP"
mkdir -p "$BACKUP"; chmod 700 "$BACKUPS" "$BACKUP" 2>/dev/null || true
docker cp "$AB:$DEST/." "$BACKUP/" 2>/dev/null || say "Plugin backup note: PCP.Plugins/astrbot_plugin_pcp_relay — nothing installed yet."
tar -C "$SRC" -cf - "${FILES[@]}" | docker exec -i "$AB" sh -c "mkdir -p '$DEST' && tar -xf - -C '$DEST' && chmod -R go-w '$DEST'"
SINCE=$(date -u +%Y-%m-%dT%H:%M:%SZ)
say "Plugin installed: PCP.Plugins/astrbot_plugin_pcp_relay — restarting $AB."
docker restart "$AB" >/dev/null
if loaded "$SINCE"; then
  say "Plugin updated: PCP.Plugins/astrbot_plugin_pcp_relay — plugin, pcp_relay provider and IM adapters loaded."
  exit 0
fi
echo "Plugin update unhealthy: PCP.Plugins/astrbot_plugin_pcp_relay — restoring $BACKUP." >&2
if [[ -n "$(ls -A "$BACKUP" 2>/dev/null)" ]]; then
  docker exec "$AB" rm -rf "$DEST"
  docker exec "$AB" mkdir -p "$DEST"
  tar -C "$BACKUP" -cf - . | docker exec -i "$AB" tar -xf - -C "$DEST"
fi
docker restart "$AB" >/dev/null
fail "new plugin failed checks; previous copy restored, AstrBot restarted"

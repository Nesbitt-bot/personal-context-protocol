#!/usr/bin/env bash
# Sync thirdparty/openclaw-pcp into the OpenClaw gateway, only when it changed.
#
#   changed? -> back up the installed copy -> validate the gateway config ->
#   install -> restart the gateway -> health check -> plugin loaded ->
#   channels check (Telegram and openclaw-weixin running) -> done,
#   otherwise restore the backup and restart again.
#
# Works from the Jenkins agent (Docker CLI only). Tests are not installed.
set -Eeuo pipefail
cd "$(dirname "$0")/../.."
GW=${OPENCLAW_GATEWAY_CONTAINER:-openclaw-openclaw-gateway-1}
DEST=${OPENCLAW_PCP_PLUGIN_DIR:-/home/node/.openclaw/extensions/openclaw-pcp}
SRC=thirdparty/openclaw-pcp
BACKUPS=${PCP_PLUGIN_BACKUP_DIR:-/home/motuariki/Documents/DockerVolumes/pcp/plugin-backups}
REQUIRED_CHANNELS=${OPENCLAW_REQUIRED_CHANNELS:-telegram openclaw-weixin}

say() { echo "$1"; }
fail() { echo "Plugin sync failed: PCP.Plugins/openclaw-pcp — $1" >&2; exit 1; }

docker inspect "$GW" >/dev/null 2>&1 || fail "gateway container $GW not found"
mapfile -t FILES < <(cd "$SRC" && find . -type f ! -path './test/*' ! -name '*.test.js' | sed 's#^\./##' | sort)
LOCAL=$(cd "$SRC" && sha256sum "${FILES[@]}")
REMOTE=$(docker exec -w "$DEST" "$GW" sha256sum "${FILES[@]}" 2>/dev/null || true)
if [[ "$LOCAL" == "$REMOTE" ]]; then
  say "Plugin current: PCP.Plugins/openclaw-pcp — installed copy matches $SRC; gateway not restarted."
  exit 0
fi

wait_healthy() {
  for _ in $(seq 1 60); do
    [[ "$(docker inspect -f '{{.State.Health.Status}}' "$GW" 2>/dev/null)" == healthy ]] && \
      docker exec "$GW" node -e "fetch('http://127.0.0.1:18789/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" && return 0
    sleep 3
  done
  return 1
}
channels_ok() {
  local out
  out=$(timeout 120 docker exec "$GW" node dist/index.js channels status --json 2>/dev/null) || return 1
  for ch in $REQUIRED_CHANNELS; do
    python3 -c 'import json,sys
t=sys.stdin.read(); s=json.loads(t[t.index("{"):]); ch=sys.argv[1]
ok=(s.get("channels",{}).get(ch,{}).get("running") is True) or any(a.get("running") is True for a in s.get("channelAccounts",{}).get(ch,[]))
sys.exit(0 if ok else 1)' "$ch" <<<"$out" 2>/dev/null \
      || docker exec "$GW" node dist/index.js channels status 2>/dev/null | grep -qiE "^- ${ch}[^:]*:.*running" || return 1
  done
}
install_from() { # install_from <dir with plugin files>
  tar -C "$1" -cf - "${FILES[@]}" | docker exec -i "$GW" sh -c "mkdir -p '$DEST' && tar -xf - -C '$DEST'"
}

STAMP=$(date -u +%Y%m%dT%H%M%SZ)
BACKUP="$BACKUPS/openclaw-pcp-$STAMP"
mkdir -p "$BACKUP"
chmod 700 "$BACKUPS" "$BACKUP" 2>/dev/null || true
docker cp "$GW:$DEST/." "$BACKUP/" 2>/dev/null || say "Plugin backup note: PCP.Plugins/openclaw-pcp — nothing installed yet."
say "Plugin backup saved: PCP.Plugins/openclaw-pcp — previous copy in $BACKUP."
timeout 120 docker exec "$GW" node dist/index.js config validate >/dev/null || fail "gateway config does not validate; refusing to restart"

install_from "$SRC"
say "Plugin installed: PCP.Plugins/openclaw-pcp — restarting $GW."
docker restart "$GW" >/dev/null
if wait_healthy && channels_ok && docker logs --since 5m "$GW" 2>&1 | grep -q 'openclaw-pcp ready'; then
  say "Plugin updated: PCP.Plugins/openclaw-pcp — gateway healthy, plugin loaded, channels running: $REQUIRED_CHANNELS."
  exit 0
fi
echo "Plugin update unhealthy: PCP.Plugins/openclaw-pcp — restoring $BACKUP." >&2
if [[ -n "$(ls -A "$BACKUP" 2>/dev/null)" ]]; then
  tar -C "$BACKUP" -cf - . | docker exec -i "$GW" tar -xf - -C "$DEST"
fi
docker restart "$GW" >/dev/null
wait_healthy && channels_ok && fail "new plugin failed checks; previous copy restored and healthy"
fail "new plugin failed checks and the gateway is still unhealthy after restoring; inspect $GW now"

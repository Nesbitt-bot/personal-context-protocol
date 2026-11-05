#!/usr/bin/env bash
# Refuse to start PostgreSQL on an empty data directory by accident.
#
# PCP keeps its PostgreSQL cluster in a host bind mount
# (PCP_POSTGRES_DATA_DIR, default below). Older deployments used the Docker
# named volume PCP_LEGACY_POSTGRES_VOLUME. The postgres image initializes a
# brand-new, empty cluster whenever its data directory is empty, so a deploy
# that points at an empty or missing bind directory would silently "lose" the
# data that is still in the old volume. This check runs before `compose up db`:
#
#   bind dir has a cluster (PG_VERSION)            -> ok
#   bind dir missing                               -> refuse (compose must not create it)
#   bind dir empty, legacy volume has a cluster    -> refuse (migrate first)
#   bind dir empty, no legacy cluster              -> refuse unless
#                                                     PCP_POSTGRES_ALLOW_EMPTY_INIT=1
#   project db container running on another mount -> refuse (stop it, then copy,
#                                                     so the copy is not stale)
#
# Inspection runs in throwaway containers, so it works from the Jenkins agent
# and needs no host permissions on the uid-70 data directory.
set -Eeuo pipefail

DATA_DIR=${PCP_POSTGRES_DATA_DIR:-/home/motuariki/Documents/DockerVolumes/pcp/postgres}
LEGACY_VOLUME=${PCP_LEGACY_POSTGRES_VOLUME:-personal-context-protocol_pcp-postgres-0-1-0}
PROJECT=${COMPOSE_PROJECT_NAME:-personal-context-protocol}
PROBE_IMAGE=${PCP_STORAGE_PROBE_IMAGE:-postgres:16-alpine}

block() {
  echo "Deployment blocked: PCP.Jenkins/storage — $1" >&2
  exit 1
}

[[ "$DATA_DIR" == /* ]] || block "PCP_POSTGRES_DATA_DIR must be an absolute host path"

# 0 = has a cluster, 1 = exists but no cluster, 2 = missing / not mountable.
probe_bind() {
  local out
  if ! out=$(docker run --rm --network none --entrypoint sh \
      --mount "type=bind,source=$DATA_DIR,target=/data,readonly" "$PROBE_IMAGE" \
      -c 'if [ -s /data/PG_VERSION ]; then echo "cluster $(stat -c %u:%g /data) $(cat /data/PG_VERSION)"; else echo empty; fi' 2>/dev/null); then
    return 2
  fi
  echo "$out"
  [[ "$out" == cluster* ]] && return 0 || return 1
}

legacy_has_cluster() {
  docker volume inspect "$LEGACY_VOLUME" >/dev/null 2>&1 || return 1
  docker run --rm --network none --entrypoint sh -v "$LEGACY_VOLUME:/data:ro" "$PROBE_IMAGE" \
    -c 'test -s /data/PG_VERSION' >/dev/null 2>&1
}

# A running db container of this project that is NOT on DATA_DIR means the
# live cluster is elsewhere; recreating it now would switch to a stale copy.
RUNNING_DB=$(docker ps -q --filter "label=com.docker.compose.project=$PROJECT" --filter label=com.docker.compose.service=db)
if [[ -n "$RUNNING_DB" ]]; then
  [[ "$RUNNING_DB" != *$'\n'* ]] || block "more than one running project database"
  CURRENT_SOURCE=$(docker inspect "$RUNNING_DB" --format '{{range .Mounts}}{{if eq .Destination "/var/lib/postgresql/data"}}{{.Type}}:{{if eq .Type "volume"}}{{.Name}}{{else}}{{.Source}}{{end}}{{end}}{{end}}')
  if [[ "$CURRENT_SOURCE" != "bind:$DATA_DIR" ]]; then
    block "the running database uses $CURRENT_SOURCE, not $DATA_DIR. Stop the stack, copy the data (docs/deployment-jenkins.md, storage migration), then deploy"
  fi
fi

set +e
STATE=$(probe_bind)
CODE=$?
set -e
case $CODE in
  0)
    read -r _ OWNER PG <<<"$STATE"
    [[ "$OWNER" == "70:70" ]] || echo "Storage warning: PCP.Jenkins/storage — $DATA_DIR is owned by $OWNER, expected 70:70 (postgres in postgres:16-alpine)" >&2
    echo "Storage verified: PCP.Jenkins/storage — PostgreSQL $PG cluster present in bind mount $DATA_DIR"
    ;;
  1)
    if legacy_has_cluster; then
      block "$DATA_DIR is empty but the legacy volume $LEGACY_VOLUME still holds a cluster; copy it first (docs/deployment-jenkins.md, storage migration). Refusing to initialize an empty database"
    fi
    [[ "${PCP_POSTGRES_ALLOW_EMPTY_INIT:-}" == "1" ]] || block "$DATA_DIR is empty; set PCP_POSTGRES_ALLOW_EMPTY_INIT=1 only for a brand-new install"
    echo "Storage verified: PCP.Jenkins/storage — empty $DATA_DIR accepted for a new install (PCP_POSTGRES_ALLOW_EMPTY_INIT=1)"
    ;;
  *)
    block "$DATA_DIR does not exist or cannot be mounted; create it (owner 70:70, mode 700) or migrate the legacy volume first"
    ;;
esac

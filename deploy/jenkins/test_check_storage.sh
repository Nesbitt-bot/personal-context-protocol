#!/usr/bin/env bash
# Integration test for check_storage.sh against real Docker (throwaway volume,
# directories and containers only; never touches the PCP stack). The scratch
# directory lives under the working tree because bind sources are host paths
# and the Jenkins agent mounts its workspace at the same host path.
set -Eeuo pipefail
cd "$(dirname "$0")/../.."
IMAGE=${PCP_STORAGE_PROBE_IMAGE:-postgres:16-alpine}
ID="pcp-storage-test-$$"
SCRATCH="$PWD/.tmp-storage-test/$ID"
VOL="$ID-legacy"
FAIL=0

cleanup() {
  docker rm -f "$ID-db" >/dev/null 2>&1 || true
  docker volume rm "$VOL" >/dev/null 2>&1 || true
  if [[ -d "$PWD/.tmp-storage-test" ]]; then
    docker run --rm --network none -v "$PWD/.tmp-storage-test:/s" --entrypoint sh "$IMAGE" -c "rm -rf /s/$ID" >/dev/null 2>&1 || true
    rmdir "$PWD/.tmp-storage-test" 2>/dev/null || true
  fi
}
trap cleanup EXIT

run_check() {
  PCP_POSTGRES_DATA_DIR="$1" PCP_LEGACY_POSTGRES_VOLUME="$VOL" COMPOSE_PROJECT_NAME="$ID" \
    PCP_POSTGRES_ALLOW_EMPTY_INIT="${2:-}" bash deploy/jenkins/check_storage.sh >/dev/null 2>&1
}
expect() { # expect <ok|blocked> <name> <dir> [allow]
  local want=$1 name=$2; shift 2
  if run_check "$@"; then got=ok; else got=blocked; fi
  if [[ "$got" == "$want" ]]; then echo "ok   - $name"; else echo "FAIL - $name (wanted $want, got $got)"; FAIL=1; fi
}
seed() { # seed <dir>: create a fake cluster marker owned by 70:70
  docker run --rm --network none -v "$1:/d" --entrypoint sh "$IMAGE" -c 'echo 16 > /d/PG_VERSION && chown -R 70:70 /d && chmod 700 /d'
}

mkdir -p "$SCRATCH/empty" "$SCRATCH/full"
seed "$SCRATCH/full"

expect blocked "missing bind dir is refused" "$SCRATCH/missing"
expect blocked "relative bind path is refused" "relative/path"
expect blocked "empty bind dir without legacy volume needs explicit opt-in" "$SCRATCH/empty"
expect ok      "empty bind dir accepted with PCP_POSTGRES_ALLOW_EMPTY_INIT=1 (new install)" "$SCRATCH/empty" 1
expect ok      "bind dir holding a cluster is accepted" "$SCRATCH/full"

docker volume create "$VOL" >/dev/null
docker run --rm --network none -v "$VOL:/d" --entrypoint sh "$IMAGE" -c 'echo 16 > /d/PG_VERSION'
expect blocked "empty bind dir is refused while the legacy volume holds a cluster" "$SCRATCH/empty"
expect blocked "...even with PCP_POSTGRES_ALLOW_EMPTY_INIT=1" "$SCRATCH/empty" 1
expect ok      "migrated bind dir is accepted while the legacy volume is kept for rollback" "$SCRATCH/full"

docker run -d --name "$ID-db" --network none --label "com.docker.compose.project=$ID" --label com.docker.compose.service=db \
  -v "$VOL:/var/lib/postgresql/data" --entrypoint sleep "$IMAGE" 120 >/dev/null
expect blocked "running db on the legacy volume blocks a switch to a (stale) copy" "$SCRATCH/full"
docker rm -f "$ID-db" >/dev/null
docker run -d --name "$ID-db" --network none --label "com.docker.compose.project=$ID" --label com.docker.compose.service=db \
  --mount "type=bind,source=$SCRATCH/full,target=/var/lib/postgresql/data" --entrypoint sleep "$IMAGE" 120 >/dev/null
expect ok      "running db already on the bind dir is accepted (normal redeploy)" "$SCRATCH/full"

[[ -d "$SCRATCH/missing" ]] && { echo "FAIL - the check created the missing directory"; FAIL=1; } || echo "ok   - the check never creates the bind directory"
exit $FAIL

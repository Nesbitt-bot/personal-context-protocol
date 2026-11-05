#!/usr/bin/env bash
set -Eeuo pipefail
export BUILDX_BUILDER=pcp-jenkins
ENV_FILE=${1:?Private prepared env path required}
AVAILABLE_KB=$(awk '/MemAvailable:/ {print $2}' /proc/meminfo)
if (( AVAILABLE_KB < 12000000 )); then
  echo 'Build blocked: PCP.Jenkins/resources — less than 12 GB RAM is available for the capped worker.' >&2
  exit 1
fi
if ! docker buildx inspect pcp-jenkins >/dev/null 2>&1; then
  docker buildx create --name pcp-jenkins --driver docker-container \
    --driver-opt memory=8g,cpu-period=100000,cpu-quota=400000,default-load=true \
    --buildkitd-flags '--oci-max-parallelism=1'
fi
timeout 3m docker buildx inspect pcp-jenkins --bootstrap
VERSION=$(tr -d '\r\n' < VERSION)
TAG="v${VERSION}-jenkins.${BUILD_NUMBER:-local}"
CI_IMAGE="pcp-ci:$TAG"
# The build context excludes private env files. Runtime secrets never enter builds.
timeout 30m docker buildx build --builder pcp-jenkins --load --progress=plain \
  --target builder --build-arg APP_VERSION="$VERSION" --build-arg GIT_COMMIT="${GIT_COMMIT:-}" -t "$CI_IMAGE" .
timeout 5m docker run --rm --memory=1g --cpus=2 "$CI_IMAGE" npm run typecheck
mkdir -p reports
timeout 10m docker run --rm --memory=2g --cpus=2 \
  -v "$PWD/reports:/reports" "$CI_IMAGE" npm run test:run -- \
  --maxWorkers=2 --minWorkers=1 --reporter=default --reporter=junit --outputFile=/reports/pcp-junit.xml
timeout 20m docker compose --env-file "$ENV_FILE" -f docker-compose.yml \
  -f deploy/jenkins/compose.override.yml build app

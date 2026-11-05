#!/usr/bin/env bash
set -Eeuo pipefail
ENV_FILE=${1:?Private prepared env path required}
COMPOSE=(docker compose --env-file "$ENV_FILE" -f docker-compose.yml -f deploy/jenkins/compose.override.yml)
# The project name and the PostgreSQL bind mount are retained across versions.
# Never let PostgreSQL initialize an empty cluster by accident.
timeout 2m bash deploy/jenkins/check_storage.sh
timeout 4m "${COMPOSE[@]}" up -d --no-build --wait --wait-timeout 180 db
timeout 5m "${COMPOSE[@]}" up -d --no-build --wait --wait-timeout 180 app
APP_ID=$("${COMPOSE[@]}" ps -q app)
timeout 30s docker exec "$APP_ID" node deploy/jenkins/verify_runtime.js
# The PCP broker runs when its private secrets directory exists (broker.token,
# openclaw-gateway.token). Without it the AstrBot path stays closed.
BROKER_SECRETS_DIR=${PCP_BROKER_SECRETS_DIR:-/home/motuariki/Documents/DockerVolumes/pcp/broker-secrets}
if [[ -d "$BROKER_SECRETS_DIR" ]]; then
  timeout 3m "${COMPOSE[@]}" --profile broker up -d --no-build --wait --wait-timeout 120 broker
  echo 'Broker verified: PCP.Jenkins/broker — loopback broker healthy.'
else
  echo "Broker skipped: PCP.Jenkins/broker — $BROKER_SECRETS_DIR does not exist; the AstrBot path stays closed."
fi

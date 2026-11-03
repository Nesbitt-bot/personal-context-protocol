#!/usr/bin/env bash
set -Eeuo pipefail
ENV_FILE=${1:?Private prepared env path required}
COMPOSE=(docker compose --env-file "$ENV_FILE" -f docker-compose.yml -f deploy/jenkins/compose.override.yml)
# Existing project/volume identity is retained across container version changes.
timeout 4m "${COMPOSE[@]}" up -d --no-build --wait --wait-timeout 180 db
timeout 5m "${COMPOSE[@]}" up -d --no-build --wait --wait-timeout 180 app
APP_ID=$("${COMPOSE[@]}" ps -q app)
timeout 30s docker exec "$APP_ID" node deploy/jenkins/verify_runtime.js

#!/usr/bin/env bash
# DB-backed Vitest suites (tests/*-db.test.ts) against a throwaway, tmpfs
# PostgreSQL on a private network. Never touches the deployed database.
set -Eeuo pipefail
VERSION=$(tr -d '\r\n' < VERSION)
CI_IMAGE="pcp-ci:v${VERSION}-jenkins.${BUILD_NUMBER:-local}"
ID="pcp-dbtest-${BUILD_NUMBER:-local}-$$"
PASSWORD=$(head -c 18 /dev/urandom | base64 | tr -dc 'A-Za-z0-9')
cleanup() { docker rm -f "$ID-db" >/dev/null 2>&1 || true; docker network rm "$ID" >/dev/null 2>&1 || true; }
trap cleanup EXIT
docker network create --internal "$ID" >/dev/null
docker run -d --name "$ID-db" --network "$ID" --memory=512m --tmpfs /var/lib/postgresql/data \
  -e POSTGRES_PASSWORD="$PASSWORD" -e POSTGRES_DB=pcp_test postgres:16-alpine >/dev/null
for _ in $(seq 1 30); do docker exec "$ID-db" pg_isready -U postgres -d pcp_test >/dev/null 2>&1 && break; sleep 1; done
sleep 2
mkdir -p reports
timeout 10m docker run --rm --network "$ID" --memory=2g --cpus=2 -v "$PWD/reports:/reports" \
  -e PCP_TEST_DATABASE_URL="postgresql://postgres:$PASSWORD@$ID-db:5432/pcp_test" "$CI_IMAGE" \
  sh -c 'npx vitest run tests/*-db.test.ts --reporter=default --reporter=junit --outputFile=/reports/pcp-db-junit.xml'

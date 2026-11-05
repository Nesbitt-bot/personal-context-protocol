#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
BACKUP_DIR=${1:?Backup directory required}
DB_ID=$(docker ps -q --filter label=com.docker.compose.project=personal-context-protocol --filter label=com.docker.compose.service=db)
if [[ -z "$DB_ID" || "$DB_ID" == *$'\n'* ]]; then
  echo 'Deployment blocked: PCP.Jenkins/backup — expected exactly one running project database.' >&2
  exit 1
fi
mkdir -p "$BACKUP_DIR"
BACKUP="$BACKUP_DIR/pcp-$(date -u +%Y%m%dT%H%M%SZ)-${BUILD_NUMBER:-local}.dump"
docker exec "$DB_ID" sh -c 'pg_dump -Fc --no-owner --no-privileges -U "$POSTGRES_USER" -d "$POSTGRES_DB"' > "$BACKUP.tmp"
test -s "$BACKUP.tmp"
docker exec -i "$DB_ID" pg_restore --list < "$BACKUP.tmp" > /dev/null
mv "$BACKUP.tmp" "$BACKUP"
echo "Backup verified: PCP.Jenkins/database — PostgreSQL archive retained at $BACKUP"

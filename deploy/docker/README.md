# Local Docker test stack

A throwaway PCP + Postgres stack for verifying a change end-to-end before it is
deployed. Unit tests cannot prove that a migration applied, that a unique index
holds, or that a route is reachable; this can.

It is separate from the root `docker-compose.yml` on purpose:

- it uses its own project name (`pcp-test`) and never touches the root stack's
  named volume, so a test run cannot destroy local data;
- the database is tmpfs-backed, so every `up` starts from an empty schema and
  exercises the real bootstrap path;
- the admin token is fixed, so a test script can authenticate without scraping
  it out of the build logs.

## Run

From the repository root:

```bash
docker compose -f deploy/docker/docker-compose.test.yml up -d --build
node deploy/docker/test-session-sync.mjs
docker compose -f deploy/docker/docker-compose.test.yml down -v
```

The app listens on `http://localhost:3100` (override with `PCP_TEST_PORT`).

If the machine cannot reach Docker Hub, build against a locally cached node
image:

```bash
PCP_TEST_NODE_IMAGE=node:22.23.0-bookworm-slim \
  docker compose -f deploy/docker/docker-compose.test.yml up -d --build
```

## What the test covers

`test-session-sync.mjs` exercises the contract the OpenCode session-manager
plugin depends on:

| Check | Why it matters |
|---|---|
| Create a session with `external_key` | The entry point for a sync worker. |
| A repeat push returns the same session, `created:false` | The idempotency the whole sync design rests on — without it every retry forks a duplicate. |
| `by-key` reports the cursor, starting at 0 | Lets a worker resume instead of re-uploading. |
| The cursor advances after an append | Proves the cursor tracks what was actually stored. |
| `by-key` returns no topic id | The AI-facing invariant: topics are never exposed. |
| Empty / over-long `external_key` is rejected | A bad key must fail loudly, not become an identity. |
| An unknown key reports `found:false` | A miss is a normal answer, not an error. |
| A session with no `external_key` still creates | Existing clients keep working unchanged. |

## Verifying the schema directly

```bash
docker compose -f deploy/docker/docker-compose.test.yml exec db \
  psql -U pcp -d pcp -c "select indexname from pg_indexes where indexname like '%external_key%';"
```

Two partial unique indexes should exist. They are partial so that the many
sessions with no external key (all pre-existing rows) keep `NULL` without
colliding, while any two rows that do carry the same key are rejected.

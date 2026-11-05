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

## Browser checks (web UI)

`test-ui-browser.sh` runs `test-ui-browser.mjs` in the Playwright Docker image
against the running test stack. It seeds a signed-in admin and member straight
into the test database (random cookie values; only their SHA-256 is stored,
like a Casdoor login), some sessions and a project, and drives Chromium inside
the app container's network namespace (`http://localhost:3000`, a secure
context for the `__Host-` cookies). Nothing new is published.

```bash
docker compose -f deploy/docker/docker-compose.test.yml up -d --build
# once: playwright-core matching the image, in a volume
docker run --rm -v pcp-pw:/pw -w /pw mcr.microsoft.com/playwright:v1.58.2-noble \
  sh -c 'npm init -y && npm i playwright-core@1.58.2'
PCP_UI_OUT=/tmp/pcp-ui PCP_PLAYWRIGHT_MODULES=pcp-pw deploy/docker/test-ui-browser.sh
```

At 1280x800 and 390x844, light and dark, it checks: Sessions and Projects in
the top nav for signed-in users (Tokens and Settings for admins only, all
reachable through the phone menu); every dialog is `role="dialog"`, fully
inside the viewport, has every control hit-testable, traps Tab focus, closes on
Esc and on Close and returns focus to its opener; the signed-in home page
offers sessions instead of a login prompt; member session and project
visibility; the projects list and detail pages. Screenshots go to
`$PCP_UI_OUT`; the script exits 1 on any failed check.


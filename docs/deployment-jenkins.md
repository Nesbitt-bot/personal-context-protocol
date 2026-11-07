# Local Jenkins deployment

Jenkins deploys GitHub `Trance-0/personal-context-protocol` **main**, using
**Pipeline script from SCM**, script path `Jenkinsfile`, and the GitHub push
webhook. Runtime is the local Next.js app plus local PostgreSQL; Neon is the
read-only migration source, not the deployed runtime database.

## Controller, source and private env

- Controller: http://127.0.0.1:8081/; job: `personal-context-protocol`.
- Repository: `https://github.com/Trance-0/personal-context-protocol.git`.
- Branch: `*/main`; script path: `Jenkinsfile`; lightweight checkout disabled.
- Agent: `local-docker`; its workspace path is also mounted on the host.
- Webhook receiver: `https://jenkins.trance-0.com/github-webhook/`.
- Private agent env: `/var/lib/jenkins/secrets/pcp-deploy.env` inside
  `jenkins-local-docker`.

The original checkout at `Documents/workspace/personal-context-protocol`
tracks an older Nesbitt-bot fork. Jenkins uses Trance-0 main, which is the
source of the previously running 0.1.24 app. Deployment work is isolated on
`deploy/jenkins-neon-import` under `~/.local/state/pcp-jenkins/source` so that
older checkout and its main branch remain intact. Never configure Jenkins
with a snapshot of either local checkout.

`local.env` is a private, mode-0600 reference in both checkouts. `prod.env`
contains the supplied Neon source credentials and is also private. They are
ignored by Git and excluded from Docker contexts. Update only the local
runtime env on the agent:

```bash
docker cp local.env jenkins-local-docker:/var/lib/jenkins/secrets/pcp-deploy.env
docker exec jenkins-local-docker chmod 600 /var/lib/jenkins/secrets/pcp-deploy.env
```

Required local values: `DATABASE_URL` targeting `db:5432/pcp`,
`POSTGRES_PASSWORD` matching the existing cluster, `PCP_INSTANCE_SECRET`, and
`PCP_APP_URL`. Leave `PCP_ADMIN_TOKEN` empty to preserve the imported
Settings-managed admin credential. Setting it would replace that credential
on each startup. No Neon secret is sent to Docker builds or used at runtime.

`deploy/jenkins/prepare_env.py` copies the private source into the workspace,
validates local DB routing and required keys, and stamps version/image/commit
metadata. Jenkins deletes the workspace env in final cleanup.

## Build and deployment gates

1. Fetch GitHub main and record its commit.
2. Build the builder target with `npm run build`, then run TypeScript checks
   and all Vitest suites in bounded containers.
3. Build the production image without runtime credentials in its context.
4. Dump the existing local database and validate its archive before any
   container recreation. Backups remain under
   `/var/lib/jenkins/backups/personal-context-protocol/` inside the agent.
5. Check storage (`deploy/jenkins/check_storage.sh`), then deploy PostgreSQL
   and the app with the existing Compose project and the bind-mounted data
   directory. Require health and database checks before success.

Images are tagged `personal-context-protocol:v0.1.25-jenkins.<BUILD_NUMBER>`;
software version is read from VERSION. Containers include that version, such
as `personal-context-protocol-app-v0.1.25`. PostgreSQL keeps its upstream
`16-alpine` image. The stable project remains `personal-context-protocol`. Version changes never
create a new data directory. OCI labels and `/api/v1/health` expose build
identity.

## Tests, broker and plugin sync (v0.3.0)

After build and unit tests, Jenkins runs `deploy/jenkins/db_test.sh` (all
`tests/*-db.test.ts` against a throwaway tmpfs PostgreSQL on an internal
network), `deploy/jenkins/thirdparty_test.sh` (every `thirdparty/` suite in
network-less containers) and `deploy/jenkins/test_check_storage.sh`.

`deploy.sh` starts the loopback broker (`--profile broker`) when
`PCP_BROKER_SECRETS_DIR` exists (see [broker.md](broker.md)). Then
`deploy/plugins/sync_openclaw_pcp.sh` and `deploy/plugins/sync_astrbot_relay.sh`
compare the installed plugins with `thirdparty/`; only on a difference they
back up the installed copy under `PCP_PLUGIN_BACKUP_DIR` (default
`DockerVolumes/pcp/plugin-backups`), install, restart the gateway / AstrBot,
and require health, plugin load and (gateway) Telegram plus openclaw-weixin
running, else they restore the backup and fail the build.

## PostgreSQL storage

The cluster lives in the host directory `PCP_POSTGRES_DATA_DIR` (default
`/home/motuariki/Documents/DockerVolumes/pcp/postgres`, owner 70:70, mode
700), bind-mounted at `/var/lib/postgresql/data`. Containers can be
recreated or removed freely; the data stays on the host. Compose never creates
the directory.

`deploy/jenkins/check_storage.sh` runs before `compose up db` and refuses to
deploy when:

- the directory is missing or not an absolute path;
- the directory is empty while the legacy named volume
  (`PCP_LEGACY_POSTGRES_VOLUME`, default
  `personal-context-protocol_pcp-postgres-0-1-0`) still holds a cluster;
- the directory is empty and `PCP_POSTGRES_ALLOW_EMPTY_INIT=1` is not set
  (only for a brand-new install);
- the project's running database uses a different mount (copying while it
  runs would produce a stale copy).

`deploy/jenkins/test_check_storage.sh` exercises every case against real
Docker with throwaway volumes and directories; Jenkins runs it before deploy.

### Migrating from the named volume (done 2026-11-05)

1. `bash deploy/jenkins/backup_database.sh ~/.local/state/pcp-backups/<ts>`
   (logical dump) and record row counts.
2. Announce, then stop the app and the database (`docker stop`).
3. Tar the volume, then copy it preserving ownership:
   `docker run --rm -v <legacy>:/from:ro -v <dir>:/to postgres:16-alpine sh -c 'cp -a /from/. /to/ && chown 70:70 /to && chmod 700 /to'`.
4. Redeploy the same image with this repository's `deploy.sh` (the guard now
   passes) and compare row counts.

The legacy volume is kept untouched for rollback. To roll back: stop the
stack, check out the previous `docker-compose.yml` (named volume), and run
`deploy.sh` from that commit; or restore the logical dump into the bind
directory's cluster with `pg_restore`.

The dedicated Buildx worker is capped at 8 GiB/four CPUs with one parallel
build step. Type checks use 1 GiB/two CPUs; tests use 2 GiB/two CPUs with at
most two workers. Runtime app is capped at 1 GiB and PostgreSQL at 512 MiB.
The pipeline and network checks have timeouts. If a build fails or stays
silent for five minutes, inspect the retained log before retrying; do not
increase resource use without measuring available RAM.

## Job configuration and verification

To restore SCM configuration on the existing job:

```bash
read -r -s -p 'Jenkins admin password: ' JENKINS_PASSWORD
export JENKINS_PASSWORD
python3 deploy/jenkins/configure_job.py
unset JENKINS_PASSWORD
```

The helper keeps the job's enabled/disabled state and backs up its previous
XML under ignored `logs/`. Push authorized commits to Trance-0 main. Verify
that Jenkins reports **Started by GitHub push**, checks out that SHA, and
returns the same commit and software version at
http://localhost:3000/api/v1/health. The separate database check requires the
stored app version and admin credential to be present. Existing admin and
session tokens remain in the imported database.

## Neon import and rollback

Neon's unpooled endpoint is used for the consistent read-only dump. The source
runs PostgreSQL 17.11; the local cluster runs PostgreSQL 16. A PostgreSQL 18
client exported a transaction snapshot and restored its public schema into a
separate local staging database after omitting only the unsupported
`transaction_timeout` session default. All 11 table fingerprints matched
before switching: 495 rows, including 7 topics, 16 sessions, 258 messages and
33 session tokens. The user-managed admin credential was preserved exactly.

The import is now local `pcp`; previous local data is retained as
`pcp_local_before_20261103` in the same cluster. Fresh dumps, original source
archive, row fingerprints, restore SQL and job/env backups are private under
`~/.local/state/pcp-jenkins/<UTC timestamp>/`; `latest-run` points to that run.
The source Neon database was not changed or shut down. This is a snapshot,
not ongoing replication: quiesce source writes and perform a final refresh
before retiring the remote runtime. Public routing and client URLs are a
separate cutover step.

## Verified deployment, 2026-11-03

GitHub push `793c5cf` automatically started
[Jenkins build #2](http://127.0.0.1:8081/job/personal-context-protocol/2/), which
completed SUCCESS. Production build, TypeScript checks, all 167 Vitest tests,
database backup and runtime checks passed. The health response reported
software `0.1.25`, target `jenkins`, and the exact pushed commit. Both versioned
containers were healthy. Post-rollout fingerprints proved all 495 imported
rows retained; only app_instance.version changed to 0.1.25. Admin/session token
hashes remained identical and the previous database was retained for rollback.
Private evidence is under the `latest-run` directory described above. The
existing plaintext Settings-managed admin token is still needed for browser
login; it cannot be recovered from its stored hash and was not reset.

## 0.4.0 persistent media and adapter policy

Before deploying, create `DockerVolumes/pcp/blobs` and `DockerVolumes/pcp/adapters`
(mode 700). `adapters/execution-policy.json` is owned by dashboard uid 1000,
mode 600; initialize with `{"groups":[]}` until the execution agent is installed.
The app mounts blobs read/write and adapters read-only. Include both directories
in backups with the PostgreSQL dump. `PCP_BLOB_HOST_DIR` and
`PCP_ADAPTER_CONFIG_HOST_DIR` override the host paths. Compose refuses missing
bind paths. Optional nginx configuration is `deploy/nginx/pcp.conf`; it does
not enable public caching of private images.

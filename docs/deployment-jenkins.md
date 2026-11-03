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
5. Deploy PostgreSQL, then the app, using the existing Compose project and
   named volume. Require health and database checks before success.

Images are tagged `personal-context-protocol:v0.1.25-jenkins.<BUILD_NUMBER>`;
software version is read from VERSION. Containers include that version, such
as `personal-context-protocol-app-v0.1.25`. PostgreSQL keeps its upstream
`16-alpine` image. The stable project remains `personal-context-protocol`, and
its existing volume remains
`personal-context-protocol_pcp-postgres-0-1-0`. Version changes never create a
new data volume. OCI labels and `/api/v1/health` expose build identity.

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

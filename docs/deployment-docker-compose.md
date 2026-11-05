# Deployment: Docker Compose

Docker Compose runs the Next.js app and a local Postgres database. The app image is tagged with the project version from the root `VERSION` file.

## Requirements

- Docker Engine with Compose v2
- Node.js only if you want to run local checks outside Docker

## Versioned Image Tag

Before building, export the version from the root file:

PowerShell:

```powershell
$env:PCP_VERSION = (Get-Content VERSION).Trim()
```

Bash:

```bash
export PCP_VERSION="$(cat VERSION)"
```

The default Compose image is `personal-context-protocol:0.3.0`. When `VERSION` changes, set `PCP_VERSION` to the new value before building so each release gets a distinct image tag.

## Start Locally

PostgreSQL data lives in a host directory (bind mount), not in a Docker named
volume, so recreating or removing containers never loses it. Create the
directory once, owned by the image's `postgres` user (uid 70), and point
`PCP_POSTGRES_DATA_DIR` at it if you do not use the default path:

```bash
export PCP_POSTGRES_DATA_DIR="$HOME/pcp-data/postgres"
mkdir -p "$PCP_POSTGRES_DATA_DIR"
docker run --rm -v "$PCP_POSTGRES_DATA_DIR:/d" --entrypoint sh postgres:16-alpine -c 'chown 70:70 /d && chmod 700 /d'
npm run docker:up
```

Compose never creates the directory (`create_host_path: false`); a missing
directory fails the start instead of silently creating an empty database.

`npm run docker:up` creates or repairs `.env` with random local credentials, builds the app, starts Postgres, initializes the database after Postgres is healthy, and prints the generated first-login token once in app container logs when `PCP_ADMIN_TOKEN` is empty. Log in with that token, then change it immediately in **Settings**.

## Environment Variables

Compose provides local defaults for development. Override them when needed:

| Name | Default | Purpose |
|---|---|---|
| `PCP_VERSION` | `0.3.0` | App image tag and Docker build version |
| `PCP_POSTGRES_DATA_DIR` | `/home/motuariki/Documents/DockerVolumes/pcp/postgres` | Host directory bind-mounted as the PostgreSQL data directory (must exist, owner 70:70) |
| `PCP_PORT` | `127.0.0.1:3000` | Host address:port mapped to the app container (loopback by default; publish through a TLS reverse proxy) |
| `PCP_APP_URL` | `http://localhost:3000` | Public app URL used by clients |
| `PCP_INSTANCE_SECRET` | Local placeholder | 32+ character instance secret |
| `POSTGRES_PASSWORD` | Generated in `.env` | Local Postgres password |
| `DATABASE_URL` | Generated in `.env` | App connection string for the Compose Postgres service |
| `PCP_ADMIN_TOKEN` | Empty | Optional 32+ character break-glass admin token |
| `PCP_OIDC_*` | Empty | Casdoor sign-in; see [auth-oidc.md](auth-oidc.md). Sign-in is disabled until all six are set. |
| `PCP_BREAK_GLASS_ADMIN_LOGIN` | Empty | `1` re-enables admin-token login (emergency only) |

## Reset Admin Token With Env

If the database is already initialized and the admin token is lost:

1. Set `PCP_ADMIN_TOKEN` to a new 32+ character value.
2. Recreate the app container:

```bash
docker compose up -d --build app
```

3. Log in with `PCP_ADMIN_TOKEN`.
4. To move the credential back into database-managed settings, unset `PCP_ADMIN_TOKEN`, recreate the app container, then open **Settings** and set a custom admin token.

Build and runtime logs report whether `PCP_ADMIN_TOKEN` is configured. User-supplied `PCP_ADMIN_TOKEN` values are not printed. If deploy initialization generates a first-login token because `PCP_ADMIN_TOKEN` is empty, that generated token is printed once so the local deployment can log in without pre-seeded credentials.

## Health Check

```bash
curl http://localhost:3000/api/v1/health
```

Expected response:

```json
{
  "status": "ok",
  "version": "0.3.0",
  "database": "pending"
}
```

## Stop

```bash
docker compose down
```

`docker compose down` (with or without `-v`) leaves the data directory in
place. Delete `PCP_POSTGRES_DATA_DIR` yourself only if you really want to
discard the database.

For remote-SCM builds and automatic local deployments, use the
[Jenkins target](deployment-jenkins.md). Its stable bind-mounted data directory
preserves data while image tags include both software version and Jenkins build.

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

The default Compose image is `personal-context-protocol:0.1.0`. When `VERSION` changes, set `PCP_VERSION` to the new value before building so each release gets a distinct image tag.

## Start Locally

```bash
docker compose build app
docker compose up -d
```

Open http://localhost:3000 and click **Initialize Database**. If `PCP_ADMIN_TOKEN` is set, log in with that value. Otherwise, save the one-time UI token shown by setup.

## Environment Variables

Compose provides local defaults for development. Override them when needed:

| Name | Default | Purpose |
|---|---|---|
| `PCP_VERSION` | `0.1.0` | App image tag and Docker build version |
| `PCP_PORT` | `3000` | Host port mapped to the app container |
| `PCP_APP_URL` | `http://localhost:3000` | Public app URL used by clients |
| `PCP_INSTANCE_SECRET` | Local placeholder | 32+ character instance secret |
| `PCP_ADMIN_TOKEN` | Empty | Optional 32+ character admin/reset token |

## Reset Admin Token With Env

If the database is already initialized and the admin token is lost:

1. Set `PCP_ADMIN_TOKEN` to a new 32+ character value.
2. Recreate the app container:

```bash
docker compose up -d --build app
```

3. Log in with `PCP_ADMIN_TOKEN`.
4. To move the credential back into database-managed settings, unset `PCP_ADMIN_TOKEN`, recreate the app container, then open **Settings** and set a custom admin token.

Build and runtime logs only report whether `PCP_ADMIN_TOKEN` is configured. They do not print plaintext tokens.

## Health Check

```bash
curl http://localhost:3000/api/v1/health
```

Expected response:

```json
{
  "status": "ok",
  "version": "0.1.0",
  "database": "pending"
}
```

## Stop

```bash
docker compose down
```

To remove the local Postgres volume created for this version:

```bash
docker compose down -v
```

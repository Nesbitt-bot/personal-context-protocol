# Deployment: Vercel + Neon

## Requirements

- GitHub account
- Vercel account
- Neon account
- Node.js 18+ for local checks

## Deploy

1. Create a Neon project and copy its Postgres connection string.
2. Import this repo at [vercel.com/new](https://vercel.com/new).
3. Set these Vercel environment variables:

| Name | Value |
|---|---|
| `DATABASE_URL` | Neon Postgres connection string |
| `PCP_INSTANCE_SECRET` | Random secret, 32+ chars |
| `PCP_APP_URL` | `https://<your-app>.vercel.app` |
| `PCP_ADMIN_TOKEN` | Optional 32+ character admin/reset token. Leave unset for zero-config first login. |

Generate local secrets with:

```bash
openssl rand -hex 32
```

4. Deploy or redeploy the Vercel project.
5. Open the app and click **Initialize Database**.
6. Log in:
   - If `PCP_ADMIN_TOKEN` is configured, use that value.
   - If `PCP_ADMIN_TOKEN` is not configured, PCP generates a temporary first-login admin token for you. The token is shown once on the setup page and printed once in Vercel function logs. Copy it, log in, then open **Settings** and change it immediately so the real credential is never visible in logs.

## Zero-Config Admin Login

`PCP_ADMIN_TOKEN` is optional. When it is missing, setup creates the admin credential automatically and logs the generated token with a banner like:

```text
personal-context-protocol generated first-login admin token
Admin token: <generated-token>
Log in with this token, then change it immediately in Settings.
```

Only PCP-generated first-login tokens are printed. User-supplied `PCP_ADMIN_TOKEN` values and Settings-rotated tokens are not printed.

## Reset Admin Token With Env

If the database is already initialized and the browser token is lost:

1. Add or update `PCP_ADMIN_TOKEN` in Vercel with a new 32+ character value.
2. Redeploy the project.
3. Log in with that value.
4. To keep the credential inside the app database instead of Vercel env, remove `PCP_ADMIN_TOKEN`, redeploy, then open **Settings** and set a custom admin token.

Build and runtime logs report whether `PCP_ADMIN_TOKEN` is configured. If setup generates a first-login token because `PCP_ADMIN_TOKEN` is not configured, that generated token is printed once so the deployment can be used without pre-seeded credentials. Change it immediately after first login.

## Docker Compose Alternative

Docker Compose deployment is documented in [deployment-docker-compose.md](deployment-docker-compose.md). It builds the app image with the versioned tag `personal-context-protocol:0.1.1` by default and runs Postgres locally.

## Local Development

```bash
npm install
cp .env.example .env.local
npm run db:migrate
npm run dev
```

`.env.local` needs:

```bash
DATABASE_URL=postgresql://user:password@host:5432/db?sslmode=require
PCP_INSTANCE_SECRET=local-dev-secret-with-32-plus-chars
PCP_APP_URL=http://localhost:3000
# Optional admin/reset token:
# PCP_ADMIN_TOKEN=local-admin-token-with-32-plus-chars
```

## Verify

```bash
npm run typecheck
npm run test:run
npm run build
```

Health check:

```bash
curl https://<your-app>.vercel.app/api/v1/health
```

Expected response:

```json
{
  "status": "ok",
  "version": "0.1.1",
  "database": "pending"
}
```

## Troubleshooting

- Setup page reports database status failure: verify `DATABASE_URL`, Neon availability, and migration state.
- Login reports `SETUP_REQUIRED`: open the app home page and click **Initialize Database** to generate the first-login token.
- Login reports `ADMIN_CREDENTIAL_NOT_INITIALIZED`: `PCP_ADMIN_TOKEN` is configured but the credential was not stored. Open the app home page and run setup again; if it repeats, verify `DATABASE_URL` and redeploy.
- Setup or login reports `INVALID_ADMIN_TOKEN`: update `PCP_ADMIN_TOKEN` to at least 32 characters, or remove it and let PCP generate the first-login token.
- Build fails: run `npm run typecheck` and `npm run build` locally.
- UI token is lost: set `PCP_ADMIN_TOKEN` in Vercel, redeploy, and log in with that value.

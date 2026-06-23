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
| `PCP_ADMIN_TOKEN` | Optional 32+ character admin/reset token |

Generate local secrets with:

```bash
openssl rand -hex 32
```

4. Deploy or redeploy the Vercel project.
5. Open the app and click **Initialize Database**.
6. Log in with `PCP_ADMIN_TOKEN` if it is configured. Otherwise, save the one-time UI token shown by setup.

## Reset Admin Token With Env

If the database is already initialized and the browser token is lost:

1. Add or update `PCP_ADMIN_TOKEN` in Vercel with a new 32+ character value.
2. Redeploy the project.
3. Log in with that value.
4. To keep the credential inside the app database instead of Vercel env, remove `PCP_ADMIN_TOKEN`, redeploy, then open **Settings** and set a custom admin token.

Build and runtime logs report whether `PCP_ADMIN_TOKEN` is configured, but they never print token plaintext.

## Docker Compose Alternative

Docker Compose deployment is documented in [deployment-docker-compose.md](deployment-docker-compose.md). It builds the app image with the versioned tag `personal-context-protocol:0.1.0` by default and runs Postgres locally.

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
  "version": "0.1.0",
  "database": "pending"
}
```

## Troubleshooting

- Setup page reports database status failure: verify `DATABASE_URL`, Neon availability, and migration state.
- Build fails: run `npm run typecheck` and `npm run build` locally.
- UI token is lost: set `PCP_ADMIN_TOKEN` in Vercel, redeploy, and log in with that value.

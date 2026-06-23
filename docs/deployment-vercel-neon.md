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

Generate a local secret with:

```bash
openssl rand -hex 32
```

4. Deploy or redeploy the Vercel project.
5. Open the app, click **Initialize Database**, and save the UI token shown once.

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
- UI token is lost: recovery and rotation work is tracked in [TODO.md](TODO.md).

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

4. Deploy or redeploy the Vercel project. The build connects to the empty Neon database, creates the schema, inserts the app instance, and creates the admin credential.
5. Log in:
   - If `PCP_ADMIN_TOKEN` is configured, use that value.
   - If `PCP_ADMIN_TOKEN` is not configured, PCP generates a temporary first-login admin token for you during build. The token is printed once in Vercel build logs. Copy it, log in, then open **Settings** and change it immediately so the real credential is never visible in logs.

## Zero-Config Admin Login

`PCP_ADMIN_TOKEN` is optional. When it is missing, deploy initialization creates the admin credential automatically and logs the generated token with a banner like:

```text
personal-context-protocol v0.1.15 - generated deployment admin token
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

Build and runtime logs report whether `PCP_ADMIN_TOKEN` is configured. If deploy initialization generates a first-login token because `PCP_ADMIN_TOKEN` is not configured, that generated token is printed once so the deployment can be used without pre-seeded credentials. Change it immediately after first login.

## Admin token recovery

The admin (UI) credential comes from one of three sources. Precedence is
**environment > user > deploy**:

| Source | How it is set | Rotation |
|---|---|---|
| `env` | `PCP_ADMIN_TOKEN` is configured | Reconciled to the env value on every deploy; the env var owns the credential |
| `user` | You set a custom token in **Settings** after login | Never auto-rotated |
| `deploy` | Neither of the above — PCP generates one | A fresh token is generated on **every deploy**; the previous deploy token stops working |

### I entered the wrong password / lost the token

1. **Check your deploy logs.** If you did not set `PCP_ADMIN_TOKEN`, the active
   token is the one PCP generated and printed once during build/start, under a
   banner containing `Admin token:`. Because a new token is generated on each
   deploy, use the token from the **most recent** deploy — do not reuse an older
   one.
2. **Set your own token via the environment.** Add `PCP_ADMIN_TOKEN` (32+
   characters) in Vercel (or Docker Compose) and redeploy. The environment
   variable then owns the credential and overrides any generated token, so it no
   longer rotates per deploy and is never printed in logs.
3. **Or set it in Settings.** After logging in, open **Settings** and set a
   custom token. That marks the credential `user`-managed, so deploys stop
   rotating it. (Settings rotation is disabled while `PCP_ADMIN_TOKEN` is
   configured, because the env var owns the credential.)

How they relate: setting `PCP_ADMIN_TOKEN` always wins and freezes the
credential to that value; clearing it and setting a token in Settings keeps a
stable token inside the database; with neither, PCP keeps the deployment usable
by minting a fresh token each deploy and printing it once.

## Docker Compose Alternative

Docker Compose deployment is documented in [deployment-docker-compose.md](deployment-docker-compose.md). It builds the app image with the versioned tag `personal-context-protocol:0.1.15` by default, generates a local `.env` when needed, and runs Postgres locally.

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
  "version": "0.1.15",
  "database": "pending"
}
```

## Troubleshooting

- Build does not print a generated token: verify `DATABASE_URL` is set for the Vercel environment and redeploy. If the database already has an admin credential, the existing credential is preserved and no new token is printed.
- Login reports `SETUP_REQUIRED`: deploy initialization did not run. The login page will offer initialization as a fallback; prefer fixing `DATABASE_URL` and redeploying so the token appears in build logs.
- Login reports `ADMIN_CREDENTIAL_NOT_INITIALIZED`: `PCP_ADMIN_TOKEN` is configured but the credential was not stored. Verify `DATABASE_URL` and redeploy.
- Setup or login reports `INVALID_ADMIN_TOKEN`: update `PCP_ADMIN_TOKEN` to at least 32 characters, or remove it and let PCP generate the first-login token.
- Build fails: run `npm run typecheck` and `npm run build` locally.
- UI token is lost: set `PCP_ADMIN_TOKEN` in Vercel, redeploy, and log in with that value.

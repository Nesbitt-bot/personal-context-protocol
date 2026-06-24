# Personal Context Protocol (PCP)

Vercel + Neon Postgres web app for scoped AI session recording.

[![Deploy to Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FNesbitt-bot%2Fpersonal-context-protocol&envDescription=Add%20Neon%20database%20and%20environment%20variables%20after%20deployment)

[Documentation](https://nesbitt-bot.github.io/personal-context-protocol/) | [API Spec](docs/protocol.md) | [Vercel Deploy](docs/deployment-vercel-neon.md) | [Docker Compose](docs/deployment-docker-compose.md)

## What It Does

Personal Context Protocol stores AI conversation context in user-managed topics and sessions.

- Admin users create topics and recording sessions in the web UI.
- Each session gets a scoped API token for an external AI agent.
- Agents append messages to their assigned session only.
- The admin dashboard previews sessions, events, and exports.

## Quick Deploy

1. Click **Deploy to Vercel** and import this repo.
2. Create a Neon project and copy the Postgres connection string.
3. Set Vercel environment variables:

| Variable | Value |
|---|---|
| `DATABASE_URL` | Neon Postgres connection string |
| `PCP_INSTANCE_SECRET` | Random secret, 32+ characters |
| `PCP_APP_URL` | Your Vercel URL |
| `PCP_ADMIN_TOKEN` | Optional 32+ character admin/reset token. Leave unset for zero-config first login. |

4. Redeploy the Vercel project. The build initializes the empty database and creates the admin credential.
5. Log in with `PCP_ADMIN_TOKEN` if configured. Otherwise, use the generated first-login token printed once in Vercel build logs, then change it immediately in **Settings**.

## Admin Token Recovery

If `PCP_ADMIN_TOKEN` is not configured during deployment, PCP generates a temporary admin token during deploy initialization, stores only its salted hash, and prints it once in build/start logs so a fresh deploy can be used without pre-seeded credentials. Log in with that generated token, then change it immediately in **Settings** so the real credential is never visible in logs.

If the database is already initialized and the UI token is lost, set `PCP_ADMIN_TOKEN` in Vercel or Docker Compose, redeploy/recreate the app, and log in with that value. The app reconciles that token into the `ui_auth` table. User-supplied `PCP_ADMIN_TOKEN` values are never printed in logs.

After login, use **Settings** to set a custom admin token. Settings rotation is disabled while `PCP_ADMIN_TOKEN` remains configured because the environment variable owns the credential.

## Docker Compose Deployment

Docker Compose can run the app and Postgres locally. The image tag defaults to personal-context-protocol:0.1.2; run `npm run docker:up` to generate `.env`, start Postgres, initialize the app, and print the first-login token when needed. See [Docker Compose deployment](docs/deployment-docker-compose.md).

## Local Development

```bash
npm install
cp .env.example .env.local
npm run db:migrate
npm run dev
```

Run checks:

```bash
npm run typecheck
npm run test:run
npm run build
```

## Token Model

### UI/admin token

- Unlocks the admin UI and protected admin API routes.
- Stored as a salted hash in Postgres.
- Generated during deploy initialization when `PCP_ADMIN_TOKEN` is not configured; the generated first-login token is printed once in build/start logs.
- Can be rotated from the Settings page after login.

### AI session token

- Generated per session and shown once.
- Stored as a salted hash with a token prefix for lookup.
- Scoped to one session.
- Can append messages and optionally rename its session.

## Documentation

Published docs: https://nesbitt-bot.github.io/personal-context-protocol/

Key local docs:

- [Protocol Spec](docs/protocol.md)
- [Data Model](docs/data-model.md)
- [Vercel Deployment Guide](docs/deployment-vercel-neon.md)
- [Docker Compose Deployment](docs/deployment-docker-compose.md)
- [Security Model](docs/security.md)
- [AI Agent Instructions](docs/agent-instructions.md)
- [TODO](docs/TODO.md)

Local docs build:

```bash
cd docs
pip install -r requirements.txt
sphinx-build -b html . _build/html
```

## Contributors

- **Nesbitt-bot**: Project author and implementation
- **Trance-0**: Agent guidelines and architectural guidance

## License

MIT



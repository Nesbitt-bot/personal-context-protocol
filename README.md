# Personal Context Protocol (PCP)

Vercel + Neon Postgres web app for scoped AI session recording.

[![Deploy to Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FNesbitt-bot%2Fpersonal-context-protocol&envDescription=Add%20Neon%20database%20and%20environment%20variables%20after%20deployment)

[Documentation](https://nesbitt-bot.github.io/personal-context-protocol/) | [API Spec](docs/protocol.md) | [Vercel Deploy](docs/deployment-vercel-neon.md) | [Docker Compose](docs/deployment-docker-compose.md)

## What It Does

Personal Context Protocol stores AI conversation context in user-managed topics and sessions.

- Admin users create topics and recording sessions in the web UI (one click, no
  naming required — defaults are generated and duplicates auto-suffixed).
- Each session produces a **recording URL + access token** pair. An agent fetches
  the recording URL to discover its upload routes, then records using only
  `Authorization: Bearer <access-token>`.
- Agents append messages to their assigned session only, or send a compaction
  when full upload is impossible. They never manage topics.
- The admin dashboard previews sessions, events, token status, and exports.

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

The admin credential has one of three sources, with precedence **environment > user > deploy**:

- **deploy** — if you set neither of the below, PCP generates a token during deploy initialization and prints it once in build/start logs. A **fresh token is generated on every deploy**, so the previous deploy token stops working — never reuse an old one. While a deploy token is in use, the dashboard shows a warning banner prompting you to set your own.
- **env** — set `PCP_ADMIN_TOKEN` (32+ chars) and redeploy. The env var owns the credential, overrides any generated token, stops per-deploy rotation, and is never printed in logs.
- **user** — after login, use **Settings** to set a custom token. That marks the credential user-managed so deploys stop rotating it. Settings rotation is disabled while `PCP_ADMIN_TOKEN` is configured because the env var owns the credential.

If you entered the wrong password: find the current token in your **most recent** deploy logs (banner containing `Admin token:`), or set `PCP_ADMIN_TOKEN` and redeploy. The login page links to the [admin token recovery guide](https://nesbitt-bot.github.io/personal-context-protocol/deployment-vercel-neon.html#admin-token-recovery).

## Docker Compose Deployment

Docker Compose can run the app and Postgres locally. The image tag defaults to personal-context-protocol:0.1.4; run `npm run docker:up` to generate `.env`, start Postgres, initialize the app, and print the first-login token when needed. See [Docker Compose deployment](docs/deployment-docker-compose.md).

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

### AI session access token

- Generated per session and shown once, paired with the session's recording URL.
- Stored as a salted hash with a token prefix for lookup.
- Scoped to exactly one session.
- Expiration is chosen at creation: `1h`, `24h`, `7d` (default), `30d`, or
  `never`. Expired or revoked tokens are rejected; tokens created before
  expiration existed are treated as never-expiring.
- Can append messages, record compactions, and optionally suggest its session
  title. Cannot manage topics.

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



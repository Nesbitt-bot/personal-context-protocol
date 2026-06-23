# Personal Context Protocol (PCP)

Vercel + Neon Postgres app for scoped AI session recording.

[![Deploy to Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FNesbitt-bot%2Fpersonal-context-protocol)

[Docs](https://nesbitt-bot.github.io/personal-context-protocol/) | [API](docs/protocol.md) | [Deploy](docs/deployment-vercel-neon.md) | [TODO](docs/TODO.md)

## What It Does

PCP lets a human create topics and sessions, generate a scoped token for one AI session, and let an external AI append conversation messages without seeing or managing topics.

Core rules:

- UI/admin access uses a setup token shown once.
- AI tokens are scoped to one session.
- AI can append messages, not edit or delete them.
- Topic management is admin-only.
- Tokens are stored as salted hashes.

## Quick Deploy

1. Deploy this repo to Vercel.
2. Create a Neon Postgres database.
3. Add Vercel env vars:

| Variable | Value |
|---|---|
| `DATABASE_URL` | Neon connection string |
| `PCP_INSTANCE_SECRET` | Random secret, 32+ chars |
| `PCP_APP_URL` | Deployed app URL |

4. Redeploy, open the app, click **Initialize Database**, and save the UI token shown once. The setup flow creates the Postgres schema automatically when `DATABASE_URL` is available.

## Local Development

```bash
npm install
cp .env.example .env.local
npm run db:migrate
npm run dev
```

Useful checks:

```bash
npm run typecheck
npm run test:run
npm run build
```

## Implemented API Surface

Public/setup:

- `GET /api/v1/health`
- `GET /api/v1/setup/status`
- `POST /api/v1/setup/init`
- `GET /api/v1/auth/check`

Admin:

- `GET /api/v1/topics`
- `POST /api/v1/topics`
- `POST /api/v1/topics/:id/rename`
- `POST /api/v1/topics/:id/archive`
- `GET /api/v1/topics/:topicId/sessions`
- `POST /api/v1/topics/:topicId/sessions`
- `GET /api/v1/sessions/:id`
- `PATCH /api/v1/sessions/:id`
- `GET /api/v1/sessions/:id/review`
- `GET /api/v1/sessions/:id/events`
- `POST /api/v1/sessions/:id/archive`
- `POST /api/v1/sessions/:sessionId/tokens`
- `GET /api/v1/export`

AI:

- `POST /api/v1/sessions/:sessionId/messages`

## Docs

- [Project overview](docs/readme.md)
- [API reference](docs/protocol.md)
- [Data model](docs/data-model.md)
- [Deployment](docs/deployment-vercel-neon.md)
- [Security model](docs/security.md)
- [AI agent instructions](docs/agent-instructions.md)
- [Future work](docs/TODO.md)

## Contributors

- **Nesbitt-bot**: Project author and implementation
- **Trance-0**: Agent guidelines and architectural guidance

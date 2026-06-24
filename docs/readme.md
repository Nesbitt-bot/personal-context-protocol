# Personal Context Protocol

PCP is a small Next.js + Postgres app for recording AI sessions with least-privilege tokens. It can run on Vercel + Neon or locally with Docker Compose.

## Runtime Shape

- Next.js 14 App Router, React, TypeScript
- Next.js API routes
- Drizzle ORM
- Neon Postgres
- Zod request validation
- Vitest tests

## Workflow

1. Deploy initialization creates the app schema and admin credential.
2. Human logs in with `PCP_ADMIN_TOKEN` or the generated first-login UI token.
3. Human creates topics and sessions one-click (names are generated if omitted).
4. Human edits, moves, archives, or restores sessions from the dashboard.
5. Human generates a **recording URL + access token** pair for one AI agent/session,
   choosing a token expiration (default 7 days).
6. The AI fetches the recording URL to discover routes, then records via
   `POST /api/v1/agent/sessions/:sessionId/messages` (or `/compact`, `/ingest`)
   with `Authorization: Bearer <access-token>`.
7. Human reviews messages, compactions, events, and token status in the admin UI.

## Invariants

- AI tokens are scoped to exactly one session.
- AI requests cannot include topic fields.
- Messages are append-only.
- Tokens are stored as salted hashes.
- Admin-only routes require the UI token.

## Deploy

1. Deploy the repo to Vercel.
2. Create a Neon database.
3. Set `DATABASE_URL`, `PCP_INSTANCE_SECRET`, and `PCP_APP_URL`.
4. Redeploy. Build-time deploy initialization creates the schema and admin credential. If `PCP_ADMIN_TOKEN` is not set, PCP generates a temporary first-login token and prints it once in deployment logs. Change it in Settings after login.

See [deployment-vercel-neon.md](deployment-vercel-neon.md) or [deployment-docker-compose.md](deployment-docker-compose.md) for exact deployment commands.

## References

- [API reference](protocol.md)
- [Data model](data-model.md)
- [Security model](security.md)
- [AI agent instructions](agent-instructions.md)
- [Docker Compose deployment](deployment-docker-compose.md)
- [Future work](TODO.md)


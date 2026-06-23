# Personal Context Protocol

PCP is a small Vercel + Neon Postgres app for recording AI sessions with least-privilege tokens.

## Runtime Shape

- Next.js 14 App Router, React, TypeScript
- Next.js API routes
- Drizzle ORM
- Neon Postgres
- Zod request validation
- Vitest tests

## Workflow

1. Human initializes the app and saves the one-time UI token.
2. Human creates topics and sessions.
3. Human edits, moves, archives, or restores sessions from the dashboard.
4. Human generates a session token for one AI agent/session.
5. AI appends messages through `POST /api/v1/sessions/:sessionId/messages`.
6. Human reviews messages and events in the admin UI.

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
4. Redeploy and initialize from the app homepage.

See [deployment-vercel-neon.md](deployment-vercel-neon.md) for the exact commands.

## References

- [API reference](protocol.md)
- [Data model](data-model.md)
- [Security model](security.md)
- [AI agent instructions](agent-instructions.md)
- [Future work](TODO.md)

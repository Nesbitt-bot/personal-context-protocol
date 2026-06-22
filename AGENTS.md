# AGENTS.md — Personal Context Protocol

This project inherits the canonical agent rules from:

**@https://github.com/Trance-0/AGENTS.md**

Copy that file's rules into your agent context. Project-specific overrides and details are in [`docs/AGENTS.md`](docs/AGENTS.md).

## Quick pointers

- **Owner rules**: See canonical [Trance-0/AGENTS.md](https://github.com/Trance-0/AGENTS.md)
- **Project details**: [`docs/AGENTS.md`](docs/AGENTS.md)
- **Architecture**: [`docs/index.md`](docs/index.md)
- **Deployment**: [`docs/deployment-vercel-neon.md`](docs/deployment-vercel-neon.md)
- **Protocol spec**: [`docs/protocol.md`](docs/protocol.md)
- **Data model**: [`docs/data-model.md`](docs/data-model.md)
- **Security**: [`docs/security.md`](docs/security.md)
- **End-of-round checklist**: [`docs/LLM_CHECK.md`](docs/LLM_CHECK.md)

## Critical invariants for this project

1. **No topic management by AI**: AI tokens cannot create/rename/delete/archive topics
2. **Immutable messages**: Never update/delete message content; corrections are new messages
3. **Token scoping**: Each session token is bound to exactly one session
4. **No external auth**: v0.1 uses single instance token + scoped session tokens only
5. **Verify before claiming**: Test API routes, migrations, and token flows locally before claiming completion
6. **No real secrets**: Never commit `.env` files or real credentials
7. **File limits**: Keep files under 1000 lines; split by responsibility
8. **Clean root**: Only README.md, AGENTS.md, CLAUDE.md, CODEX.md, .gitignore, package.json at root

## Current stack

- Next.js 14 App Router + TypeScript + React
- Drizzle ORM + Neon Postgres
- Zod validation
- Vitest testing
- Vercel deployment

## Working branches

Check current branch and status before making changes:
```bash
git status
git branch -v
```

## Test commands

```bash
npm run typecheck    # TypeScript check
npm run test         # Run tests
npm run build        # Build for production
npm run db:generate  # Generate DB migrations
npm run db:migrate   # Apply migrations
```

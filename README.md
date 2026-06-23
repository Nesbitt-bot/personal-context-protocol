# Personal Context Protocol (PCP)

**Route B:** Vercel + Neon Postgres web app for scoped AI session recording.

[![Deploy to Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FNesbitt-bot%2Fpersonal-context-protocol&env=DATABASE_URL,PCP_INSTANCE_SECRET,PCP_APP_URL&envDescription=Set%20up%20your%20environment%20variables%20after%20deployment)

[Documentation](https://nesbitt-bot.github.io/personal-context-protocol/) | [API Spec](https://github.com/Nesbitt-bot/personal-context-protocol/blob/main/docs/protocol.md) | [Deploy Guide](https://github.com/Nesbitt-bot/personal-context-protocol/blob/main/docs/deployment-vercel-neon.md)

## Overview

Personal Context Protocol is a minimal web app where:

1. **Human** creates topics and AI recording sessions
2. Each session gets a scoped token
3. **External AI agents** receive only `domain + session_id + session_token`
4. AI agents record conversation messages through API routes
5. **Human** previews sessions in a read-only ChatGPT-like UI

### Core principles

- **No external auth** (v0.1): UI access via single instance token
- **Scoped AI tokens**: Per-session, append-only, no topic management
- **Immutable messages**: Corrections are new messages/events
- **Local-first setup**: One-click Vercel deploy, UI-driven DB init
- **Minimal exposure**: AI sees only its session context

## Quick start (one-click deploy)

### 1. Deploy to Vercel

Click [Deploy to Vercel](https://vercel.com/new) and import this repo.

### 2. Connect Neon Postgres

During Vercel setup:
1. Create new Neon project (free tier works)
2. Copy connection string
3. Add to Vercel env vars as `DATABASE_URL`

### 3. Set required env vars

```
DATABASE_URL=postgresql://...
PCP_INSTANCE_SECRET=generate-a-random-secret-here
PCP_APP_URL=https://your-app.vercel.app
```

### 4. Initialize database

After first deploy:
1. Visit `https://your-app.vercel.app`
2. Click "Initialize Database"
3. Save the UI admin token (shown once!)
4. App is ready

### 5. Create your first session

1. Create a topic (e.g., "work-notes")
2. Create a session within that topic
3. Copy the AI session token
4. Give AI agent: domain, session_id, session_token

## Architecture

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│   Human     │────▶│  Next.js App │────▶│ Neon PG     │
│   (UI)      │     │  (Vercel)    │     │  (PG)       │
└─────────────┘     └──────────────┘     └─────────────┘
                            │
                            │ Bearer token
                            ▼
                     ┌──────────────┐
                     │ External AI  │
                     │  (append-    │
                     │  only)       │
                     └──────────────┘
```

### Tech stack

- **Frontend**: Next.js 14 App Router, TypeScript, React
- **Backend**: Next.js API routes, Drizzle ORM
- **Database**: Neon Postgres (serverless PG)
- **Validation**: Zod
- **Testing**: Vitest
- **Deploy**: Vercel

## Token model

### UI/admin token
- Generated at setup
- Hash stored (salted)
- Unlocks admin UI
- Shown **once** on creation
- Can: create topics, manage sessions, view all data

### AI session token
- Generated per session
- Hash stored (salted)
- Scoped to single session
- Can: append messages, optionally read session context, optionally rename session
- Cannot: manage topics, delete/rewrite messages, access other sessions

## API endpoints

### Public/health
- `GET /api/v1/health` - Health check
- `GET /api/v1/protocol` - Protocol spec
- `GET /api/v1/setup/status` - Setup progress

### Setup
- `POST /api/v1/setup/init` - Initialize DB + UI token
- `POST /api/v1/auth/unlock` - Unlock UI with admin token
- `POST /api/v1/auth/rotate-ui-token` - Rotate admin token

### Topics (admin only)
- `GET /api/v1/topics` - List topics
- `POST /api/v1/topics` - Create topic
- `GET /api/v1/topics/:id` - Get topic
- `POST /api/v1/topics/:id/rename` - Rename topic
- `POST /api/v1/topics/:id/archive` - Archive topic

### Sessions
- `GET /api/v1/sessions/:id` - Get session
- `GET /api/v1/sessions/:id/review` - Review session (admin)
- `POST /api/v1/topics/:topicId/sessions` - Create session
- `POST /api/v1/sessions/:id/rename` - Rename session
- `POST /api/v1/sessions/:id/archive` - Archive session

### Tokens
- `POST /api/v1/sessions/:id/tokens` - Generate session token
- `POST /api/v1/session-tokens/:id/revoke` - Revoke token

### Messages (AI write)
- `POST /api/v1/sessions/:sessionId/messages` - Append messages (AI)
- `GET /api/v1/sessions/:id/messages` - Read messages (admin)

### Events
- `GET /api/v1/sessions/:id/events` - Audit events

### Import/Export (admin)
- `GET /api/v1/export` - Export all data
- `POST /api/v1/import/pcp-json` - Import PCP JSON
- `POST /api/v1/import/pcp-jsonl` - Import PCP JSONL
- `POST /api/v1/import/generic-transcript` - Import generic transcript

## Local development

```bash
# Install dependencies
npm install

# Set up env (copy .env.example to .env.local)
cp .env.example .env.local
# Edit .env.local with your values

# Generate DB migrations
npm run db:generate

# Run migrations locally (if you have PG)
npm run db:migrate

# Start dev server
npm run dev

# Run tests
npm run test

# Type check
npm run typecheck

# Build
npm run build
```

## Data model

See [`docs/data-model.md`](docs/data-model.md).

Key tables:
- `app_instance` - Single instance metadata
- `ui_auth` - UI admin token hash
- `topics` - Human-managed categories
- `sessions` - AI recording sessions
- `session_tokens` - Scoped AI tokens
- `messages` - Immutable conversation messages
- `events` - Audit trail

## Security

See [`docs/security.md`](docs/security.md).

Key points:
- No plaintext tokens stored
- Token validation on every AI request
- Immutable messages (corrections = new messages)
- AI tokens cannot manage topics
- CORS configured for app domain only

## Documentation

- [`docs/protocol.md`](docs/protocol.md) - Full API spec
- [`docs/deployment-vercel-neon.md`](docs/deployment-vercel-neon.md) - Deploy guide
- [`docs/security.md`](docs/security.md) - Security model
- [`docs/data-model.md`](docs/data-model.md) - Database schema
- [`docs/agent-instructions.md`](docs/agent-instructions.md) - AI agent instructions
- [`docs/migrations.md`](docs/migrations.md) - DB migrations
- [`docs/export-format.md`](docs/export-format.md) - Export format spec
- [`docs/limitations.md`](docs/limitations.md) - v0.1 limitations

## License

MIT

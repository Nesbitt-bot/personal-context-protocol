# PCP Architecture (Route B: Vercel + Neon)

## Overview

Personal Context Protocol (PCP) is a minimal web app for scoped AI session recording. Route B is the Vercel + Neon Postgres deployment variant.

## Problem statement

When working with external AI agents:

1. You need them to record conversation context
2. You don't want them managing your data structure
3. You don't want to share raw credentials
4. You want revocable, scoped access
5. You need an audit trail

PCP solves this by providing:

- **Scoped tokens**: One token per session, bound to that session only
- **Append-only API**: AI can only add messages, never modify/delete
- **Topic isolation**: AI cannot create/rename/archive topics
- **Human control**: You manage topics, review sessions, revoke tokens
- **Audit log**: Every action is recorded

## System architecture

```
┌─────────────┐
│   Human     │
│   (browser) │
└──────┬──────┘
       │ authenticated via UI token
       ▼
┌───────────────────────────────────────────┐
│           Next.js App (Vercel)           │
│  ┌─────────────────────────────────────┐  │
│  │   Admin UI (React)                  │  │
│  │   - Topic management                │  │
│  │   - Session creation                │  │
│  │   - Message preview                 │  │
│  │   - Token generation                │  │
│  └─────────────────────────────────────┘  │
│  ┌─────────────────────────────────────┐  │
│  │   API Routes                        │  │
│  │   - Token validation                │  │
│  │   - Message insertion               │  │
│  │   - Audit logging                   │  │
│  └─────────────────────────────────────┘  │
└──────────────┬────────────────────────────┘
               │
               │ PostgreSQL connection
               ▼
┌───────────────────────────────────────────┐
│         Neon Postgres (serverless)       │
│  - app_instance                           │
│  - ui_auth                                │
│  - topics                                 │
│  - sessions                               │
│  - session_tokens                         │
│  - messages                               │
│  - events                                 │
└───────────────────────────────────────────┘

                    ┌─────────────┐
                    │   External  │
                    │     AI      │
                    └──────┬──────┘
                           │ Bearer <session_token>
                           │ domain + session_id + token only
                           ▼
                    (API routes only)
```

## Component breakdown

### Frontend (Admin UI)

**Purpose**: Human-facing dashboard for managing the system

**Features**:
- Setup wizard (first-time init)
- Topic list and creation
- Session list per topic
- Session detail (read-only message preview)
- Token generation and revocation
- Import/export tools

**Tech**: Next.js App Router, React Server Components + Client Components, TypeScript

### API layer

**Purpose**: Expose controlled endpoints for human and AI access

**Routes**:
- **Setup routes**: `/api/v1/setup/*` - First-time initialization
- **Auth routes**: `/api/v1/auth/*` - UI token validation/rotation
- **Topic routes**: `/api/v1/topics/*` - Admin-only CRUD
- **Session routes**: `/api/v1/sessions/*` - Session management
- **Token routes**: `/api/v1/sessions/:id/tokens` - AI token generation
- **Message routes**: `/api/v1/sessions/:id/messages` - AI append / Admin read
- **Event routes**: `/api/v1/sessions/:id/events` - Audit log
- **Import/Export**: `/api/v1/export`, `/api/v1/import/*`

### Database (Neon Postgres)

**Purpose**: Persistent storage with serverless scaling

**Why Neon**:
- Serverless PostgreSQL (no server management)
- Branching for testing
- Free tier available
- Vercel integration
- Instant connection string provisioning

### Token system

#### UI admin token

- **Purpose**: Unlock admin UI
- **Generation**: Random 32-byte hex, shown once
- **Storage**: Salted hash (bcrypt/Argon2)
- **Validation**: Compare hash on each request
- **Rotation**: Generate new hash, invalidate old

#### AI session token

- **Purpose**: Scoped write access for AI agents
- **Generation**: Random 32-byte hex per session
- **Storage**: Salted hash + session_id + revocation flag
- **Scope**: Exactly one session
- **Capabilities**:
  - Append messages to session
  - Optionally: read session context
  - Optionally: suggest session title
  - Cannot: manage topics, delete messages, access other sessions
- **Revocation**: Soft delete (revoked flag)

## Data flow

### Human workflow

1. Deploy app → visit URL
2. Initialize DB → save UI token
3. Create topic (e.g., "work")
4. Create session within topic
5. Generate AI token
6. Give AI: `APP_URL`, `SESSION_ID`, `SESSION_TOKEN`
7. Later: review messages in UI

### AI workflow

1. Receive: `APP_URL`, `SESSION_ID`, `SESSION_TOKEN`
2. Read instructions: "record messages via POST"
3. For each conversation turn:
   - `POST /api/v1/sessions/{SESSION_ID}/messages`
   - Body: `{role, content, provider, base_model, timestamps}`
4. If API unavailable: output `<PCP_APPEND>...</PCP_APPEND>` block
5. Never attempt topic management or message deletion

## Security model

### Threats addressed

1. **Prompt injection**: AI cannot modify system behavior via messages
2. **Token overreach**: Session tokens cannot access other sessions
3. **Topic pollution**: AI cannot create fake topics
4. **Message tampering**: Append-only, corrections are new messages
5. **Data exposure**: Minimal data in token validation (hash only)

### Security boundaries

- **Human boundary**: Full access via UI token
- **AI boundary**: Session-scoped token, append-only
- **Network boundary**: CORS restricts to app domain
- **Database boundary**: Connection pooling, prepared statements

## Deployment topology

### Production (Route B)

- **Frontend/API**: Vercel (serverless functions)
- **Database**: Neon Postgres
- **Env vars**: Vercel environment variables
- **Domain**: `*.vercel.app` or custom domain

### Local development

- **Frontend/API**: `npm run dev` (localhost:3000)
- **Database**: Local Postgres or Neon dev branch
- **Env vars**: `.env.local`

### Migration path

1. Local development → test migrations
2. Push to main → Vercel auto-deploys
3. Set env vars in Vercel dashboard
4. Visit app → click "Initialize Database"
5. App checks schema version, applies migrations if needed

## Technology decisions

### Why Next.js?

- Single framework for frontend + API
- App Router for clear route separation
- Server Components for reduced bundle size
- Vercel-native deployment
- TypeScript first

### Why Drizzle ORM?

- Type-safe queries
- Clean migrations
- PostgreSQL-first
- Lightweight compared to Prisma
- Good migration tooling

### Why Vitest?

- Fast test runner
- Vercel/Next.js ecosystem fit
- ESM-native
- Simple configuration

### Why not vector DB?

- v0.1 goal: basic recording + retrieval
- Full-text search via Postgres is sufficient
- Vector search is v0.2+ scope

### Why not OAuth?

- v0.1 goal: simplest possible setup
- Single instance, single user
- OAuth is v0.2+ scope

## File structure

```
personal-context-protocol/
├── README.md              # Human-facing overview
├── AGENTS.md              # Agent rules (inherits from Trance-0)
├── CLAUDE.md              # @AGENTS.md
├── CODEX.md               # @AGENTS.md
├── package.json
├── tsconfig.json
├── next.config.js
├── .env.example
├── .gitignore
├── docs/
│   ├── LLM_CHECK.md       # End-of-round checklist
│   ├── readme.md          # Human-facing architecture
│   ├── index.md           # This file
│   ├── AGENTS.md          # Project-specific agent rules
│   ├── protocol.md        # Full API spec
│   ├── deployment-vercel-neon.md
│   ├── security.md
│   ├── data-model.md
│   ├── agent-instructions.md
│   ├── migrations.md
│   ├── export-format.md
│   └── limitations.md
├── src/
│   ├── app/               # Next.js App Router
│   │   ├── layout.tsx
│   │   ├── page.tsx       # Dashboard
│   │   ├── setup/         # Setup pages
│   │   ├── topics/        # Topic pages
│   │   └── sessions/      # Session pages
│   ├── api/               # API routes
│   │   └── v1/
│   ├── lib/               # Shared utilities
│   │   ├── db.ts          # Drizzle connection
│   │   ├── auth.ts        # Token validation
│   │   └── schema.ts      # Zod schemas
│   └── components/        # React components
├── drizzle/               # DB migrations
└── tests/
    ├── api/               # API route tests
    ├── auth.test.ts       # Token tests
    └── migrations.test.ts # Migration tests
```

## Version history

### v0.1.0 (current)

- Basic setup + migration flow
- UI token + session tokens
- Topic CRUD (admin only)
- Session CRUD (admin only)
- Message append (AI), message read (admin)
- Audit events
- Export/import (admin)
- Vercel + Neon deployment

### v0.2.0 (planned)

- Vector search for semantic retrieval
- OAuth/SSO support
- Multiple user support
- Token expiration
- Real-time updates (WebSocket/SSE)
- Advanced filtering/search

## Related documentation

- [`docs/protocol.md`](protocol.md) - Complete API specification
- [`docs/data-model.md`](data-model.md) - Database schema details
- [`docs/security.md`](security.md) - Security model and threats
- [`docs/deployment-vercel-neon.md`](deployment-vercel-neon.md) - Deploy guide
- [`docs/agent-instructions.md`](agent-instructions.md) - AI agent instructions

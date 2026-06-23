# Personal Context Protocol (PCP)

**Route B:** Vercel + Neon Postgres web app for scoped AI session recording.

[![Deploy to Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FNesbitt-bot%2Fpersonal-context-protocol)

[API Spec](protocol.md) | [Deploy Guide](deployment-vercel-neon.md) | [Security](security.md) | [AI Agent Guide](agent-instructions.md)

## Quick Deploy (3 steps)

### 1. Deploy to Vercel
Click **Deploy to Vercel** above and fork/import this repo.

### 2. Connect Neon Database
1. Go to [neon.tech](https://neon.tech) → Create project
2. Copy the **connection string** (includes password)

### 3. Set Environment Variables
In your Vercel project **Settings → Environment Variables**:

| Variable | Value |
|---|---|
| `DATABASE_URL` | Paste your Neon connection string |
| `PCP_INSTANCE_SECRET` | Run `python scripts/deploy-setup.py` or generate random 32-char hex |
| `PCP_APP_URL` | Your Vercel URL (auto-set as `VERCEL_URL` variable) |

After adding env vars, click **Redeploy**.

### 4. Initialize (First Run)
1. Visit your deployed app
2. Click **"Initialize Database"**
3. **COPY THE UI TOKEN** (shown once, then gone forever)
4. Start creating topics and sessions!

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
- **Local-first setup**: Vercel + Neon, UI-driven DB init
- **Minimal exposure**: AI sees only its session context

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

## Documentation

- **[Protocol Spec](protocol.md)** - Full API documentation
- **[Data Model](data-model.md)** - Database schema and relationships
- **[Deployment Guide](deployment-vercel-neon.md)** - Step-by-step Vercel + Neon setup
- **[Security Model](security.md)** - Threat model and mitigations
- **[AI Agent Instructions](agent-instructions.md)** - How AI agents should use the API
- **[Migrations](migrations.md)** - Database migration workflow
- **[Export Format](export-format.md)** - Import/export specifications
- **[Limitations](limitations.md)** - v0.1 constraints and future plans

## License

MIT

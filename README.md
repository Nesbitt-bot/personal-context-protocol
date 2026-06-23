# Personal Context Protocol (PCP)

**Route B:** Vercel + Neon Postgres web app for scoped AI session recording.

[![Deploy to Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FNesbitt-bot%2Fpersonal-context-protocol&envDescription=Add%20Neon%20database%20and%20environment%20variables%20after%20deployment)

[📚 Documentation](https://nesbitt-bot.github.io/personal-context-protocol/) | [API Spec](docs/protocol.md) | [Deploy Guide](docs/deployment-vercel-neon.md)

## Contributors

- **Nesbitt-bot**: Project author and implementation
- **Trance-0**: Agent guidelines and architectural guidance (see [`AGENTS.md`](AGENTS.md))

---

## 🚀 Quick Deploy (3 steps)

### 1. Deploy to Vercel
Click **Deploy to Vercel** above and fork/import this repo.  
*Don't worry about env vars yet - you'll add them after.*

### 2. Connect Neon Database
1. Go to [neon.tech](https://neon.tech) → Create project
2. Copy the **connection string** (includes password)

### 3. Set Environment Variables
In your Vercel project **Settings → Environment Variables**:

| Variable | Value |
|---|--|
| `DATABASE_URL` | Paste your Neon connection string |
| `PCP_INSTANCE_SECRET` | Run `python scripts/deploy-setup.py` or generate random 32-char hex |
| `PCP_APP_URL` | Your Vercel URL (auto-set as `VERCEL_URL` variable) |

After adding env vars, click **Redeploy**.

### 4. Initialize (First Run)
1. Visit your deployed app
2. Click **"Initialize Database"**
3. **COPY THE UI TOKEN** (shown once, then gone forever)
4. Start creating topics and sessions!

---

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

---

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

- **Frontend**: Next.js 14 App Router, TypeScript, React, Tailwind CSS
- **Backend**: Next.js API routes, Drizzle ORM
- **Database**: Neon Postgres (serverless)
- **Validation**: Zod
- **Testing**: Vitest
- **Deploy**: Vercel

---

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

---

## Documentation

All documentation is hosted on GitHub Pages:  
👉 **https://nesbitt-bot.github.io/personal-context-protocol/**

### Available docs

- **[Protocol Spec](docs/protocol.md)** - Full API documentation
- **[Data Model](docs/data-model.md)** - Database schema and relationships
- **[Deployment Guide](docs/deployment-vercel-neon.md)** - Step-by-step Vercel + Neon setup
- **[Security Model](docs/security.md)** - Threat model and mitigations
- **[AI Agent Instructions](docs/agent-instructions.md)** - How AI agents should use the API
- **[Migrations](docs/migrations.md)** - Database migration workflow
- **[Export Format](docs/export-format.md)** - Import/export specifications
- **[Limitations](docs/limitations.md)** - v0.1 constraints and future plans
- **[Logging Guidelines](docs/logging.md)** - AGENTS.md-compliant logging
- **[Agent Guidelines](docs/AGENTS.md)** - Canonical owner rules (submodule)
- **[LLM_CHECK](docs/LLM_CHECK.md)** - End-of-round checklist

### Local docs build

```bash
cd docs
pip install -r requirements.txt
sphinx-build -b html . _build/html
```

Then open `_build/html/index.html` in your browser.

---

## License

MIT

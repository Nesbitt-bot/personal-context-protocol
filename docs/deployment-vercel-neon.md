# Deployment Guide: Vercel + Neon

This document describes how to deploy PCP Route B to Vercel with Neon Postgres.

## Prerequisites

- GitHub account
- Vercel account (free tier works)
- Neon account (free tier works)
- Node.js 18+ locally for testing

## One-click deploy

### Option 1: Vercel Deploy Button

1. Click [Deploy to Vercel](https://vercel.com/new)
2. Import this repository
3. Follow the wizard (details below)

### Option 2: Vercel CLI

```bash
npm install -g vercel
vercel
```

## Step-by-step deployment

### 1. Create Neon database

1. Go to [neon.tech](https://neon.tech)
2. Sign up (free)
3. Click "Create a project"
4. Name: `pcp-db` (or any name)
5. Region: choose closest to your users
6. Compute: default (provisioned)
7. Click "Create"

8. Copy the connection string:
   - Click the "Connection Details" button
   - Copy the "Connection string" (it looks like `postgresql://user:pass@host:5432/db`)
   - Save this - you'll need it for Vercel env vars

### 2. Deploy to Vercel

1. Go to [vercel.com/new](https://vercel.com/new)
2. Import Git Repository → select this repo
3. Framework Preset: Next.js
4. Build Settings:
   - Build Command: `npm run build`
   - Output Directory: `.next`
5. Environment Variables:
   Add these:

   ```
   DATABASE_URL=<paste Neon connection string>
   PCP_INSTANCE_SECRET=<generate random 32-char string>
   PCP_APP_URL=https://<your-app-name>.vercel.app
   ```

   **How to generate PCP_INSTANCE_SECRET**:
   ```bash
   # Run locally or use an online generator
   openssl rand -hex 32
   # Or use: cat /dev/urandom | tr -dc 'a-zA-Z0-9' | fold -w 32 | head -n 1
   ```

6. Click "Deploy"

### 3. Wait for deployment

Vercel will build and deploy your app. This takes 2-5 minutes.

### 4. Initialize the database

1. Visit your app URL: `https://<your-app-name>.vercel.app`
2. You should see the setup page (app not initialized)
3. Click "Initialize Database"
4. **CRITICAL**: Copy the UI admin token shown on screen
   - This token is NEVER shown again
   - Store it securely (password manager, encrypted note, etc.)
5. Click "Continue to App"

### 5. Verify deployment

1. Visit `https://<your-app-name>.vercel.app/api/v1/health`
2. You should see:
   ```json
   {
     "status": "ok",
     "version": "0.1.0",
     "database": "connected"
   }
   ```

## Environment variables

### Required

| Name | Description | Example |
|------|-----------|---------|
| `DATABASE_URL` | Neon Postgres connection string | `postgresql://user:pass@ep-xxx.us-east-1.neon.tech/db?sslmode=require` |
| `PCP_INSTANCE_SECRET` | Random secret for token hashing | `a1b2c3...` (32+ chars) |
| `PCP_APP_URL` | Your app's public URL | `https://my-app.vercel.app` |

### Optional

| Name | Description |
|------|-----------|
| `NODE_ENV` | Set by Vercel automatically (`production`, `preview`, `development`) |

## Environment variable security

**DO NOT**:
- Commit `.env` files to Git
- Share env vars in public discussions
- Use the same `PCP_INSTANCE_SECRET` across multiple deployments

**DO**:
- Use Vercel's Environment Variables UI
- Rotate `PCP_INSTANCE_SECRET` if compromised
- Use different secrets for dev/staging/prod

## Post-deployment tasks

### 1. Create your first topic

1. Login with your UI token
2. Click "Create Topic"
3. Enter title (e.g., "work-notes")
4. Click "Create"

### 2. Create your first session

1. Click on the topic
2. Click "Create Session"
3. Enter title (e.g., "Meeting with team")
4. Click "Create"

### 3. Generate AI token

1. In the session view, click "Generate Token"
2. Enter a name (e.g., "Claude session")
3. Choose if AI can suggest titles
4. Click "Generate"
5. **Copy the token immediately** - it won't be shown again
6. Share with AI:
   ```
   APP_URL: https://your-app.vercel.app
   SESSION_ID: ses_1719099903_xxx
   SESSION_TOKEN: tok_1719099905_a3f2b1c4d5e6...
   ```

## Local development

### 1. Clone repo

```bash
git clone https://github.com/Nesbitt-bot/personal-context-protocol.git
cd personal-context-protocol
```

### 2. Install dependencies

```bash
npm install
```

### 3. Set up local database (optional)

You can use Neon for local dev too, or set up local Postgres:

```bash
# Using Neon (recommended)
# Copy your Neon connection string to .env.local

# Or local Postgres
# npm run db:local:start  # if you have Docker
```

### 4. Create .env.local

```bash
cp .env.example .env.local
```

Edit `.env.local`:

```
DATABASE_URL=postgresql://user:pass@localhost:5432/pcp_dev
PCP_INSTANCE_SECRET=local-dev-secret-12345678901234567890
PCP_APP_URL=http://localhost:3000
```

### 5. Generate migrations (if schema changed)

```bash
npm run db:generate
```

### 6. Run migrations locally

```bash
npm run db:migrate
```

### 7. Start dev server

```bash
npm run dev
```

Visit `http://localhost:3000`

## Custom domain

1. Go to Vercel project settings
2. Click "Domains"
3. Add your custom domain
4. Follow DNS instructions
5. Vercel automatically provisions SSL

## Environment previews

Vercel automatically creates preview deployments for each PR:

- URL: `https://<branch-name>-<app-name>.vercel.app`
- Uses preview env vars
- Has separate database (if configured)

## Monitoring

### Vercel Analytics

Enable in Vercel project settings for:
- Page views
- Performance metrics
- Geographic distribution

### Database monitoring

Neon dashboard provides:
- Connection count
- Query performance
- Storage usage

## Troubleshooting

### "Database connection failed"

1. Check `DATABASE_URL` in Vercel env vars
2. Verify Neon project is active
3. Check connection string format (must include `?sslmode=require`)
4. Check Vercel deployment logs

### "App not initialized"

This is expected for new deployments. Visit the setup page and click "Initialize Database".

### "UI token lost"

If you lose the UI token:
1. Set a new `PCP_INSTANCE_SECRET` in Vercel env vars
2. Redeploy
3. Re-initialize the database
4. Save the new token securely

### Build fails

1. Check Node.js version (must be 18+)
2. Run `npm run build` locally to see errors
3. Check for TypeScript errors: `npm run typecheck`

## Scaling

### Current limits (free tier)

- Vercel: 100GB bandwidth/month, unlimited deployments
- Neon: 0.5GB storage, 10GB bandwidth/month

### When to upgrade

- Storage > 0.5GB (Neon paid plans)
- Bandwidth > 100GB/month (Vercel paid plans)
- Need dedicated compute (Neon/provisioned)

## Backup strategy

### Manual export

1. Login to admin UI
2. Click "Export Data"
3. Save the JSON file
4. Store in secure backup location

### Automated backup

Set up a cron job or GitHub Action to:
1. Call `/api/v1/export` with UI token
2. Save output to cloud storage (S3, GCS)
3. Run daily or weekly

## Disaster recovery

### If Vercel deployment fails

1. Check deployment logs
2. Verify env vars are set correctly
3. Try redeploying from main branch
4. Check Neon connection string is valid

### If database is corrupted

1. Restore from Neon backup (if enabled)
2. Or re-run migrations from scratch
3. Import data from last export

### If all else fails

1. Create new Neon project
2. Redeploy to Vercel
3. Initialize fresh database
4. Import from last backup export

## Cost estimation

### Free tier (sufficient for personal use)

- Vercel: $0/month
- Neon: $0/month

### Expected usage

- Small personal app: ~100 sessions, ~10,000 messages
- Storage: < 100MB
- Bandwidth: < 10GB/month
- Cost: $0/month

### Paid tier (if needed)

- Neon Pro: $10/month (more storage, more compute)
- Vercel Pro: $20/month (more bandwidth, advanced features)

## Security hardening

### Enable these in Vercel

- [ ] Automatic security updates
- [ ] Git protection (require PRs for main)
- [ ] Environment variable encryption
- [ ] Audit logs

### Enable these in Neon

- [ ] Automatic backups
- [ ] Connection pooling
- [ ] IP allowlist (if needed)

### Application-level

- [ ] Rotate `PCP_INSTANCE_SECRET` annually
- [ ] Monitor for unusual API usage
- [ ] Export data regularly
- [ ] Review session tokens periodically

## Next steps

- [ ] Set up custom domain
- [ ] Enable Vercel analytics
- [ ] Create first topic and session
- [ ] Generate AI token
- [ ] Test message recording
- [ ] Set up automated backups

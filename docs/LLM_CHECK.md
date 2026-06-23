# End-of-round checklist

Run this checklist before declaring any modification round complete.

## Common mistakes seen in this project

- **Token leakage**: Accidentally logging or returning plaintext tokens
- **Topic exposure**: Including topic fields in AI-facing APIs
- **Mutable messages**: Attempting to update/delete existing messages instead of appending corrections
- **Scoping bugs**: Session tokens that can access multiple sessions
- **Migration failures**: Not testing migrations end-to-end before claiming success
- **Env var gaps**: Missing required env vars (`DATABASE_URL`, `PCP_INSTANCE_SECRET`, `PCP_APP_URL`)
- **Build failures**: Not running `npm run build` before claiming deploy readiness

## Round-end checklist

### Verification

- [ ] All tests pass: `npm run test`
- [ ] Type check passes: `npm run typecheck`
- [ ] Build succeeds: `npm run build`
- [ ] If DB changes: migrations generated and tested locally
- [ ] If API changes: tested with curl/POSTMAN
- [ ] If token flows changed: verified token hashing + validation
- [ ] No `.env` files staged: `git status --short`
- [ ] No files over 1000 lines: check new/modified files
- [ ] No unrelated refactors in this commit

### Docs audit

- [ ] `README.md` still reflects current architecture
- [ ] `docs/protocol.md` updated if API changed
- [ ] `docs/data-model.md` updated if schema changed
- [ ] `docs/deployment-vercel-neon.md` updated if deploy steps changed
- [ ] Error messages include consequence + module + cause (per AGENTS.md)

### Security audit

- [ ] No plaintext tokens in logs or responses
- [ ] AI tokens cannot call topic management routes
- [ ] Session tokens are properly scoped
- [ ] CORS configured correctly
- [ ] No real secrets in repo

### Git hygiene

- [ ] `git diff --cached --stat` shows only intended changes
- [ ] Commit message follows convention: `area: concise description`
- [ ] Force-push not needed (if force-push is required, request explicit approval)
- [ ] Branch is correct (work on feature branch if repo has non-main branches)

## Current round log

Append what this round actually did below:

- [Round date] - Initial rewrite to Next.js + Neon
  - Created project structure
  - Set up AGENTS.md, CLAUDE.md, CODEX.md
  - Created documentation skeleton
  - TODO: Implement actual application code
- 2026-06-23 - Fixed Sphinx documentation build root document configuration
  - Removed `index.rst` from Sphinx exclude patterns so the root document loads
  - Repaired the `docs/index.rst` heading underline
  - Added root `VERSION` with the current project version
  - Allowed placeholder `.env.example` files to remain trackable
- 2026-06-23 - Revised diagnostic logs and frontend setup error context
  - Added shared TypeScript diagnostic logging helpers with secret redaction
  - Replaced vague frontend fallback errors with consequence, module/process, and cause
  - Replaced vague API `console.error` labels with structured diagnostic log messages
  - Updated Python logging examples and startup log text to follow the same diagnostic format
  - Added missing Python and TypeScript generated-file ignore rules
  - Added `docs/TODO.md` for future implementation work
- 2026-06-23 - Compacted user-facing docs and removed route terminology
  - Removed route labels from README and docs
  - Replaced stale API docs with implemented endpoints only
  - Moved roadmap, hardening, and non-current feature notes into `docs/TODO.md`
- 2026-06-23 - Added Tailwind session workspace
  - Added Tailwind CSS and lucide icons
  - Added session listing and session metadata update APIs
  - Replaced inline dashboard/setup/session UI with a chat-style workspace
  - Updated docs for implemented session edit/archive routes
- 2026-06-23 - Fixed setup API routing and non-JSON setup errors
  - Moved API route handlers under `src/app/api/v1` so Next.js serves them
  - Made database client initialization return structured handler errors when `DATABASE_URL` is missing
  - Added setup-page handling for non-JSON API responses
  - Replaced the native Argon2 package with built-in scrypt hashing so App Router routes bundle cleanly
  - Removed runtime Drizzle index exports while keeping SQL migration indexes intact
  - Marked API routes dynamic so production builds do not execute runtime database handlers
- 2026-06-23 - Added themed intro page and split dashboard UI
  - Added light, dark, and system theme modes with a reusable toggle
  - Replaced the setup-only landing screen with a project introduction, login portal, and documentation/footer links
  - Split dashboard topic, session, and workspace rendering into focused components with JSDoc comments
  - Added dark-mode-aware dashboard and landing page colors
- 2026-06-23 - Added admin login gate and automatic schema bootstrap
  - Added `/login` so the login portal prompts for the admin token before opening the dashboard
  - Added `/api/v1/auth/check` for validating UI tokens before storing them in browser local storage
  - Redirected direct dashboard access without `ui_token` to `/login?next=/dashboard`
  - Added automatic Postgres schema creation when setup status or init runs with `DATABASE_URL` configured

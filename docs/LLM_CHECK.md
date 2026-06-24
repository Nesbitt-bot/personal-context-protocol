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
- [ ] Patch version bumped for this change round across release metadata
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
- [ ] Bark notification text includes app name and version if notifications are sent

### Security audit

- [ ] No plaintext tokens in logs or responses
- [ ] AI tokens cannot call topic management routes
- [ ] Session tokens are properly scoped
- [ ] CORS configured correctly
- [ ] No real secrets in repo
- [ ] No `*.bark.env` values or URL templates echoed in logs, docs, commits, or summaries

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
- 2026-06-23 - Updated docs links, TODO tracking, and safe startup diagnostics
  - Pointed frontend documentation footer links at the published GitHub Pages docs
  - Rewrote `docs/TODO.md` as a checked versioned tracker with completed subitems
  - Replaced build/runtime token-printing scripts with secret-safe configuration diagnostics
  - Preserved setup/login token display in the browser instead of exposing admin tokens in Vercel logs
- 2026-06-23 - Added safe admin token recovery and settings rotation
  - Added `PCP_ADMIN_TOKEN` reconciliation so a lost admin token can be replaced through Vercel env without printing secrets in logs
  - Added `/api/v1/auth/token` for logged-in admins to set a custom token from settings
  - Added `/settings` with token confirmation and local storage update after successful rotation
  - Updated build/runtime diagnostics to show whether `PCP_ADMIN_TOKEN` is configured without revealing its value
  - Added setup/init repair for initialized databases missing the `ui_auth` credential row
- 2026-06-23 - Added Docker Compose deployment path
  - Added versioned Dockerfile and docker-compose.yml with image tag default personal-context-protocol:0.1.2
  - Added root VERSION consistency checks for package, Dockerfile, Compose, and runtime fallback
  - Updated deployment docs for admin token reset through PCP_ADMIN_TOKEN
- 2026-06-23 - Added zero-config first-login admin token flow
  - Generated and logged first-login admin tokens only when PCP_ADMIN_TOKEN is absent
  - Added credential-state-specific setup/login errors and deployment guide links
  - Updated deployment, security, and protocol docs for the generated-token exception
- 2026-06-23 - Bumped app version and added Bark notification helper
  - Bumped release metadata to 0.1.1 for the current change round
  - Added `npm run notify:bark` with app name/version prefixes and passive Bark delivery
  - Added a Bark env example and checklist rules for version bumps and notification secrecy
- 2026-06-24 - Human fallback paste-import with auto-merge (v0.1.8)
  - Patch-bumped to 0.1.8
  - Added `POST /api/v1/sessions/:id/import` (UI token): parses a pasted agent fallback block (forgiving formats incl. agent wrapper JSON) and records it, skipping messages already present (dedup by role + content) so re-pasting merges cleanly; `<PCP_COMPACT>` stored as a compaction
  - New pure `import-merge.ts` (dedupeNewMessages) + tests; `parseIngestPayload` gained a `maxMessages` option for larger human imports
  - Added an ImportPanel (terminal-style paste box) below the messages widget on the session detail page and the dashboard workspace
  - Verified live: agent-wrapper JSON imports; re-paste imports nothing new; superset imports only the delta; compact block stored; empty/garbage returns 422; ordinals stay monotonic. 51 tests pass
- 2026-06-24 - Public sessions, token revocation, recording-URL origin fix, front-page polish (v0.1.7)
  - Patch-bumped release metadata to 0.1.7
  - Added `sessions.public` (migration 006); `GET /api/v1/public/sessions/:id` and `/s/:id` render a read-only view without the admin token; private sessions return 404 to avoid leaking existence
  - Token revocation: `PATCH /api/v1/sessions/:id/tokens { token_id }` sets revoked + audit event; dashboard token-management modal lists tokens with one-click revoke; workspace gained a public/private toggle + copyable public link
  - Recording URL: hardened `resolveAppBaseUrl` to ignore a non-absolute PCP_APP_URL (e.g. the literal `${VERCEL_URL}`) and fall back to request origin; the browser now builds the recording URL + instruction from `window.location.origin` so it always matches where the UI is open
  - Front page: staggered fade-in-up load animations (with prefers-reduced-motion guard); footer shows the deployed `vX.Y.Z`
  - Added resolveAppBaseUrl tests; 46 tests pass
  - Verified live: public read returns messages only when public (404 when private), token revoke rejects the agent immediately
- 2026-06-24 - Fixed admin token not rotating on deploy (v0.1.6)
  - Root cause: migration 003 backfilled pre-existing credentials as `source = 'user'`, which preserved them forever, so a new deploy printed "user-set admin credential preserved" and generated no token
  - Added one-time, self-guarded migration 005 (`0004_default_token_rotates.sql`) that resets mis-marked `user` rows to `deploy`; mirrored in deploy-init and ensureDatabaseSchema. After it runs, the deploy generates and prints a fresh token
  - Default for any credential not set in Settings is now `deploy` (rotates each deploy); only a Settings-set token (tagged `user` after migration 005) or `PCP_ADMIN_TOKEN` (`env`) stops rotation
  - Clarified the deploy-init "preserved" log so the user is notified that a Settings-set token is in effect and how to resume rotation
  - Verified live: a row mis-marked `user` rotates and prints a new token after the corrective migration; a Settings-set token (tagged after 005) is preserved across deploys
- 2026-06-24 - ChatGPT-style nav, context menu, and uncategorized sessions (v0.1.5)
  - Patch-bumped release metadata to 0.1.5
  - Made `sessions.topic_id` and `messages.topic_id` nullable + idempotent migration `0003_optional_topic.sql` (mirrored in setup-schema and deploy-init)
  - Added `GET/POST /api/v1/sessions` (list all + create with optional topic); `PATCH /sessions/:id` accepts `topic_id: null` to move to Uncategorized
  - Null-safe session-title uniqueness within the topic group or the uncategorized group (new `session-store.ts`; recording-store rename made null-safe)
  - Replaced the two-column topic/session sidebars with one ChatGPT-style nav: collapsible topic groups + Uncategorized group, sessions nested as items; removed `topic-sidebar.tsx` and `session-sidebar.tsx`
  - Right-click + long-press context menu to remove (archive) topics/sessions, with confirm; removing a topic moves its sessions to Uncategorized so none are lost
  - Verified end-to-end against live Postgres: nullable columns, uncategorized create + auto-suffix, grouping, agent append to a no-topic session (message.topic_id NULL), move to/from a topic, archive
- 2026-06-23 - Per-deploy admin token rotation + recovery guidance (v0.1.4)
  - Patch-bumped release metadata to 0.1.4
  - Added `ui_auth.source` (deploy/env/user) + idempotent migration `0002_admin_token_source.sql`; pre-existing credentials migrate to `user` so an upgrade never rotates a token already in use
  - deploy-init now rotates the admin token on every deploy unless PCP_ADMIN_TOKEN (env) or a Settings-set (user) token owns the credential; the fresh token is printed once
  - Settings rotation tags `user`; setup/init and env reconcile tag their source
  - Login wrong-password error now explains deploy-log lookup, PCP_ADMIN_TOKEN reset, and their precedence, with a link to the deployment guide's admin-token-recovery section
  - Dashboard shows a Tailwind warning banner below the nav when a deploy-generated token is in use; auth/check returns `ui_token_source`
  - Verified end-to-end against live Postgres: first deploy generates token; redeploy rotates it (old token rejected); env-set and user-set tokens preserved; wrong token returns recovery link
- 2026-06-23 - Added agent recording-URL model (v0.1.3)
  - Patch-bumped release metadata to 0.1.3 (VERSION, package.json, package-lock, version.ts, Dockerfile, docker-compose, pyproject)
  - Version policy: stays in the v0.1 line. A 0.2.0 bump is gated on completing v0.1 Remaining Hardening (startup validation, setup integration tests, security audit, API docs sync); it is not triggered by shipping a feature while that work is open. Corrected an earlier 0.2.0 bump back to 0.1.3 for this reason.
  - Added pure helper libs: naming, recording-url, agent-protocol, ingest, agent-errors, token-expiration
  - Added `compactions` table + idempotent migration `0001_agent_recording.sql` and setup-schema bootstrap
  - Added public discovery routes (`/r/:id`, `/agent/resolve`, `/agent/sessions/:id/protocol`) and agent write routes (messages, compact, ingest) with structured `{ ok, code, retryable, message, next_steps }` errors
  - Token expiration choices (1h/24h/7d/30d/never, default 7d; NULL = never); token list shows active/expired/revoked + last used
  - One-click topic/session creation with generated default names; duplicate titles auto-suffixed; AI-suggested titles normalized + de-duped within topic
  - Session detail UI shows recording URL, expiration controls, copyable URL+token agent instruction, and issued-token status
  - Added tests (naming, recording-url, protocol, ingest, token-expiration, agent-errors); 43 tests pass
  - DB-backed routes verified via typecheck + build; no live Neon DB in the test env, so route-level append/compact/expiry rejection are covered by their pure building blocks plus example curl in docs/agent-instructions.md
- 2026-06-23 - Added deploy-time database/admin bootstrap
  - Bumped release metadata to 0.1.2 for the current change round
  - Added build/start deploy initialization for schema, app instance, and admin credential
  - Added Docker `.env` generation and `npm run docker:up`
  - Updated login to offer fallback initialization only when deploy initialization did not run


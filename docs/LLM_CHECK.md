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
- **Fixed overlays inside filtered ancestors**: a `position: fixed` modal rendered inside an element with `backdrop-filter`, `filter` or `transform` (the sticky `backdrop-blur` nav) is positioned relative to that element, not the viewport. Use `src/components/modal.tsx` (portal on `document.body`, focus trap, Esc) for every dialog, and run `deploy/docker/test-ui-browser.sh`

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

- 2026-11-05 - Projects across machines, sync conflict policy, UI fixes (v0.2.2)
  - Root cause of the unusable token dialog: `ScopedTokenManager` rendered inside
    the sticky nav whose `backdrop-blur` made it the containing block for the
    fixed overlay (panel at y=-235 at 1280x800). All dialogs now use the shared
    portal `Modal` (role=dialog, focus trap, Esc/Close, focus restore).
  - Nav: Sessions and Projects for signed-in users, phone menu (Tokens/Settings
    were unreachable below 640 px); signed-in home and `/login` no longer offer a
    second login; break-glass return path uses the server's sanitizer.
  - Migration 013 (additive): projects, aliases, workspaces, session project link
    and task context, sync clocks, conflicts, merge tasks. APIs for agents
    (global scoped token + `manage_projects`) and the admin UI; conflict policy
    documented in `docs/protocol.md`.
  - `organize-projects.mjs` + read-only `pcp-operator.js sessions export`;
    production dry run only (deployed version had no migration 013).
  - Verified: typecheck, `npm run build` (Docker builder target), vitest 302/302
    with a throwaway Postgres (300 + 2 skipped in the CI image, which excludes
    `thirdparty/`), thirdparty node tests 18 + 19, 152 browser checks, reorg
    e2e on the test stack with a byte-identical rerun.

- 2026-06-26 - Consent-framed token prompts + dashboard scroll fix (v0.1.21)
  - Rewrote the three token instruction builders (`buildAgentInstruction` /
    `buildImportInstruction` / `buildExportInstruction`) through a shared
    consent-framed `buildRecordingPrompt`. Agents were refusing the prior text
    as prompt-injection because it read like exfiltration ("fetch the recording
    URL to discover upload routes", "recall ALL past conversation history",
    "upload every message", token presented as page content). New framing:
    states this is a first-party request (user's own instance, user's own
    credential), gates direct upload behind the agent having a real web/MCP
    tool, and offers "produce import JSON for the user to paste" as a preferred
    non-refusal fallback. Mode now shown under its display name (exact→strict).
  - Layout: added the `min-h-0` chain so the nested message/events scrollers are
    no longer clipped by the fixed-height `h-[calc(100vh-57px)] overflow-hidden`
    page grid (workspace section + inner column, the messages/events grid row,
    and an independent scroller on the events column). The pinned Import
    composer and footer are reachable again.
  - typecheck clean; 122 tests pass (added a refusal-safe wording assertion,
    updated the exact-mode instruction test to the strict display name); build clean.
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
- 2026-06-25 - Trash model, drag-to-move, events toggle, scroll fixes (v0.1.14)
  - Replaced archive with trashcan: NavSidebar shows a Trash section with archived items, restore/delete-permanently context menu, and "Empty trash" for bulk permanent deletion. New DELETE endpoints for sessions and topics. Topic archive POST now accepts {archived:false} to restore.
  - Drag-to-move sessions: drag a session item onto a topic group; the topic auto-expands on hover and the session moves.
  - Events sidebar auto-hides: a toggle button on the right edge (ChevronLeft/Right) shows/hides events. Defaults to hidden.
  - Fixed workspace height: double h-[calc(100vh-57px)] removed (workspace now h-full inside the dashboard grid). Scroll-to-bottom button threshold lowered to 3 messages.
  - Topic dropdown in session edit now filters out archived topics.
  - Added docs/versions/ directory with per-release notes (v0.1.12–v0.1.14).
  - Bark notification sent on dev completion. 94 tests pass.
- 2026-06-25 - Session URL routing, scroll-to-bottom, overflow fix (v0.1.14)
  - Dashboard now uses URL-driven session selection: clicking a session pushes /dashboard?session=<id>, making every session shareable while the sidebar stays visible. Removed the standalone /sessions/[id] page (redirects); removed "Open page" button.
  - Fixed y-overflow scroll: the main container uses h-[calc(100vh-57px)] overflow-hidden with flex-1 overflow-y-auto on the message column. Long single messages no longer break the viewport.
  - Added scroll-to-bottom button (ArrowDown) that appears when the user scrolls up past ~8 messages; auto-scrolls to latest on session load.
  - 93 tests pass; build clean.
- 2026-06-25 - Agent read-messages endpoint + full-history instruction (v0.1.13)
  - Fixed root cause of agents failing to record context: protocol pointed review at admin endpoint (UI-token only), so agents couldn't read past messages. Instruction didn't tell agents to record ALL messages either.
  - Added GET /api/v1/agent/sessions/:id/review (access-token scoped) so an agent reads its own session history and picks up from the correct ordinal
  - Protocol descriptor now has read_messages route + existing_message_count + hint; instruction says "Record ALL messages — every user and assistant response, the full history"
  - 93 tests pass; verified: agent review returns scoped history, recording picks up from correct ordinal
- 2026-06-24 - Chat-bubble alignment + scroll (v0.1.12)
  - Rewrote MessageList with chat-bubble layout: user messages float right (sky-600 rounded-2xl), agent/assistant/system/tool/correction float left (white/grey rounded-2xl); compaction/system blocks span full width. Message bubbles capped at 75-85% width for readability. Role badge, ordinal, and pencil-edit inline in the bubble header.
  - Messages column now scrolls independently (flex-1 overflow-y-auto) with the ImportPanel pinned below; the outer flex container uses h-[calc(100vh-57px)] overflow-hidden to constrain it. Session detail page made a flex-col min-h-screen with the grid flex-1 + overflow-hidden for independent scroll.
  - Version 0.1.12; 92 tests pass.
- 2026-06-24 - Compaction rendering, mixed ingest, and v0.1 hardening (v0.1.11)
  - Patch-bumped to 0.1.11
  - Compactions are now first-class readable content: `GET /api/v1/sessions/:id/compactions` + a `CompactionList` rendered system-prompt-style (labeled Summary/Timeline/Decisions/Requirements/Open questions/Artifacts/Warnings) in the workspace and session page; when a session has compactions but no messages the messages pane says "No raw messages recorded. This session has compact summaries."
  - Ingest supports messages + compaction together: new `mixed` kind + `<PCP_INGEST>` tag; agent ingest and human import both record messages and a compaction. Import response is now `{ ok, imported: { messages, compactions }, skipped, notice }`
  - Hardening — startup validation: shared `validateRuntimeConfig` (missing + malformed: DATABASE_URL scheme, secret length, non-absolute PCP_APP_URL like `${VERCEL_URL}`); surfaced secret-free in setup/status and the home setup card
  - Hardening — API docs sync: a drift test asserts every route under src/app/api/v1 is documented in protocol.md (params normalized)
  - Tests: config validator (7), ingest mixed/compact (4 new), API-doc drift (per-route). 92 tests pass
  - Verified live: compact-only import stores a compaction (0 messages, correct notice) and renders; mixed PCP_INGEST records 2 messages + 1 compaction; setup/status returns config_issues
- 2026-06-24 - Admin message edit/delete with multi-select (v0.1.10)
  - Patch-bumped to 0.1.10
  - Added admin (UI-token) message correction: `PATCH /api/v1/sessions/:id/messages/:messageId` (edit) and `POST /api/v1/sessions/:id/messages/delete` (bulk delete, ownership-checked); audited `message.edited` / `message.deleted`. AI tokens remain strictly append-only; documented the human-admin exception in data-model and docs/AGENTS.md
  - New shared `MessageList` component (replaces the two inline renderers): inline edit, multi-select with select-all + shift-click range select, bulk delete, and auto-fold long messages to 5 lines (`line-clamp-5`) while selecting
  - Verified live: edit fixes a wrong import; bulk delete removes selected (ordinals keep gaps); cross-session ids rejected (deleted=0); edit without UI token → 401; agent append continues from max(ordinal)+1 after deletes. 53 tests pass
- 2026-06-24 - Session recording modes + token rename (v0.1.9)
  - Patch-bumped to 0.1.9
  - Added `sessions.mode` (`wild` default / `exact`, migration 007). The mode is surfaced to the agent in the protocol descriptor (`recording_mode` + `recording_guidance`) and the generated instruction: wild = may redact unsafe secrets, exact = verbatim incl. credentials for task migration. Workspace has a Wild/Exact toggle
  - Token rename: `PATCH /api/v1/sessions/:id/tokens { token_id, name }` (also `{ token_id, revoke: true }`); names auto-suffixed distinct on create and rename; rename button in the token modal
  - Verified live: protocol/instruction reflect the mode; rename updates the name distinctly; new tokens get distinct names; revoke still rejects. 53 tests pass
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


- 2026-11-03 — Jenkins/Neon local deployment (v0.1.25)
  - Discovered the existing workspace tracks the older Nesbitt-bot fork while
    the running 0.1.24 app/job use Trance-0 main. Work isolated on
    deploy/jenkins-neon-import; original checkout/main preserved.
  - Added versioned Jenkinsfile loaded from remote GitHub main, bounded
    production builds/typecheck/Vitest, backup-before-recreate, full-stack
    deployment and version/commit/database verification. Jenkins validator,
    Python/shell/JS syntax and Compose model checks passed.
  - Production builder ran npm run build; TypeScript check and all nine Vitest
    files/167 tests passed. Final preflight production image built. Runtime
    env excluded from contexts, logs/reports and .env.* ignored.
  - Neon unpooled PostgreSQL 17.11: read-only exported snapshot, public-schema
    dump via PG18 client, staging restore to local PG16 after omitting only
    unsupported transaction_timeout default. All 11 tables/495 rows matched
    before/after local app startup, including stored UI/session token hashes.
  - Imported 7 topics, 16 sessions, 258 messages and 33 session tokens. Existing
    user-managed admin credential preserved without rotation. Kept original
    DB as pcp_local_before_20261103 and private dumps/env/job backups under
    ~/.local/state/pcp-jenkins/<UTC timestamp>. Neon unchanged, not shut down.
  - Preserved existing instance secret, local DB password and named volume.
    Private local.env/prod.env references created; Jenkins env is local only.
    PCP job disabled during migration and converted from inline to SCM; it
    will be enabled before authorized push. Notechondria job/data unchanged.
  - Remote webhook rollout and post-deploy fingerprints are verified after
    push; UI plaintext admin token is not available from a stored hash, so
    continue using the existing user-managed Neon credential.
  - Final remote verification: GitHub push 793c5cf automatically started PCP
    Jenkins build #2, which completed SUCCESS. Remote npm build, typecheck,
    167 Vitest tests, PostgreSQL backup, full-stack rollout, and runtime
    software/commit/database checks passed. Both versioned containers healthy.
  - Post-rollout comparison retains all 495 rows and exact hashes in all ten
    content/auth tables. app_instance differs only in version 0.1.24→0.1.25,
    verified by normalizing that field in a read-only comparison. Original
    data volume and pcp_local_before_20261103 rollback DB remain. Root page
    HTTP200, unauthenticated topics HTTP401, health commit matches pushed SHA.
  - Source Neon dump was read-only. Browser login with the unknown plaintext
    Settings-managed admin token was not tested; its stored hash is preserved.
    Sphinx documentation build not run locally (toolchain absent). Old local
    checkout/main untouched; docs/code pushed to canonical Trance-0 main for
    webhook verification. Local tests/logs/private env excluded from Git.

- 2026-11-05 — Identity phase 1: Casdoor OIDC, ownership, claims (v0.2.0)
  - Fresh clone of Nesbitt-bot main on the remote dev host; branch
    feat/identity-phase1. Running deployment, Jenkins and deploy env untouched.
  - Builder image (`docker build --target builder`) ran `npm run build`
    successfully; `npm run typecheck` passed; `npm run test:run` passed
    12 files / 224 tests with a disposable tmpfs Postgres
    (`PCP_TEST_DATABASE_URL`), and 11 files / 208 passed + 16 skipped without
    it (the CI configuration).
  - Upgrade check: a database bootstrapped by v0.1.25 deploy-init with a
    session row was upgraded by the new deploy-init twice (idempotent); the
    session kept its data and became `unattributed`/unowned; `ui_auth` kept.
  - Runtime smoke test against the production build (internal Docker network,
    no published port): health 200, anonymous `/api/v1/sessions` and
    `/api/v1/auth/me` 401, admin token rejected with `BREAK_GLASS_DISABLED`,
    `/auth/login` without OIDC env redirects to `OIDC_DISABLED`.
  - Real Casdoor login not exercised (IdP stubbed in tests); first live check
    happens after the owner deploys with the `PCP_OIDC_*` env set.

- 2026-11-05 — Identity phase 2: service credentials, turn grants, sync (v0.2.1)
  - Separate commits on feat/identity-phase1 after phase 1 was complete.
  - Builder image ran `npm run build`; typecheck passed; `npm run test:run`
    passed 13 files / 244 tests with a disposable Postgres (218 + 26 skipped without it)
    (`tests/service-sync-db.test.ts` uses its own `<db>_service` database);
    without `PCP_TEST_DATABASE_URL` both DB files are skipped.
  - No broker, plugins or broker→OpenClaw call (later phases).

- 2026-11-05 — AstrBot history backfill and relay speaker attribution (plugin v0.1.2)
  - Root cause: `thirdparty/astrbot_plugin_pcp_relay/main.py` retained sender
    identity in the stamp but sent bare text to PCP. The broker recorded that
    bare text, so subsequent group recall lost the speaker identity.
  - Group text now carries its platform-derived principal and an escaped,
    explicitly untrusted display name. Signed IDs still determine access;
    private text, agent policy, group isolation and wake rules are unchanged.
    Nearby provider errors now include consequence, module/process and cause.
  - Backfilled the requested linked QQ DM from two AstrBot conversations and
    LivingMemory: 58 source records, seven overlaps, 51 imported messages.
    Added an append-only chronology note for source records without individual
    timestamps. Existing six PCP records and owner identity were preserved.
    Raw sources, rollback snapshots and replay scripts remain private under
    the host-backed PCP context-sync directory, outside Git. Attachments stay
    in the source snapshot with an explicit reference in recalled text.
  - Passed all 22 standard-library plugin tests; the new group-history test
    fails against the original source. Actual installed OpenClaw PCP tools
    recalled imported messages. Live signed fixture turns retained separate
    speakers and group recall returned 403 for the private DM. No message
    was sent to QQ or another external channel during verification.
  - Import replay inserted zero duplicates. Verified content equality, source
    IDs, unique ordinals, unchanged original rows and private session scope.
    Installed through the existing backup/restart helper; plugin/provider/IM
    startup and source checksums passed. Existing persistent mounts retained.
  - Reviewed README, docs/readme and broker documentation. No new env vars,
    runtime, ports, schema or API routes. Node build/typecheck/full app tests
    skipped: only the standalone Python relay changed. Plugin version bumped;
    PCP app version is unchanged. No repo-root Bark config was present.
  - Diff, changed-file line limits, secret/size/gitignore and unrelated-change
    audits passed. Work on fix/astrbot-group-context; main unchanged. Commit
    locally without pushing; remote Jenkins plugin sync can replace this
    local installation until the source change is merged upstream.

- 2026-11-05 — Telegram historical sync and admin recall (PCP v0.3.2; plugin v0.2.2)
  - Verified the installed PCP plugin and identity links. Root causes: live
    `agent_end` sync never backfilled pre-install transcripts; `createTurnGrant`
    applied non-admin ownership filters even to linked administrators.
  - Added operator-manifest backfill through the actual installed plugin hook,
    redaction, queue and service client. Immutable source hashes, stable native
    turn IDs, bounded progress logging and a separate queue make replay safe.
    Selected 470 Telegram turns from 16 snapshots; 2,268 records added to the
    existing session. A full replay kept the remote total at 2,270. Tool results,
    thinking and attachments follow the existing text-only plugin policy.
  - Admin DMs now receive every active session, including unowned imports and
    group archives; non-admin and group grants retain their existing scopes.
    Admin status is read from the linked PCP user. Writes stay home-session-only.
  - Passed TypeScript checks, 335 tests against isolated PostgreSQL (two existing
    source-excluded planner tests skipped in the CI image), all 32 plugin tests,
    and production Docker build before the release metadata bump. Verified
    installed plugin search returns the Telegram display name and numeric ID.
    Private database/source snapshots and logs stay under DockerVolumes/pcp.
  - Updated README, docs/readme, broker/service-sync documentation and plugin
    backfill instructions. App and plugin patch versions aligned. Runtime
    deployment and final checks are recorded in the following log entry.

  - Final rollout: PCP v0.3.2 production build passed and the app was recreated
    from its inspected runtime environment, ports and network. Database and
    broker containers stayed in place. Deployment is labeled local-admin-context;
    no GitHub push or Jenkins webhook build is claimed. Previous image/config
    and a pre-sync PostgreSQL dump are retained for rollback.
  - Live admin grants include all 426 active sessions. The installed PCP search
    tool resolves the Telegram display name and numeric ID from WeChat admin
    context. Signed group probes still receive 403 for private recall. Public
    health reports v0.3.2 and the implementation commit. Plugin v0.2.2 loaded;
    Telegram and WeChat channels report running after the standard sync helper.
  - Final plugin tests: 32 passed. Exact plugin-output comparison verified all
    2,268 imported records and original timestamps; 466 unique native turn keys
    represent the 470 selected source turns. Full replay added zero records.
    No chat message was sent during validation. Runtime images and source
    commits remain local; upstream deployment must include this fix to retain it.
  - Reviewed docs, config/env consistency, unchanged host ports, source sizes,
    ignore rules and staged credentials. Main remains unchanged. No root Bark
    config exists. Package-lock is the existing generated dependency lockfile;
    only its two project version fields changed.

## 2026-11-06 — AstrBot execution and media integration

- Consolidated previously unmerged 0.3.2 fixes into the canonical PCP checkout
  on `integration/ai-infra-execution-media`; archived redundant clones to Trash
  only after checking ancestry, clean status, active processes and mounts.
- Added per-tool execution authorization from signed AstrBot identity, live
  broker grants, exact agent binding and the dashboard-managed policy.
- Added sanitized image/GIF storage, authenticated previews and grant-based
  image recall; native inline image uploads use the durable bounded queue.
- Current-source typecheck and 349 Vitest tests against disposable PostgreSQL
  passed; 34 OpenClaw plugin and 24 AstrBot plugin tests passed.
- Production Docker build passed; no production database used for tests.
- Private backup/evidence stays under DockerVolumes/ai-infra/releases. Reviewed
  runtime settings, docs, source sizes, whitespace and staged paths.
- GitHub credentials unavailable in this session; no remote push or webhook
  deployment is claimed. Local rollout verification will be recorded separately.

## 2026-11-08 — voice and isolated group execution

- Added normalized voice attachments with authenticated audio playback. Existing
  AstrBot preprocessing supplies searchable transcript text; audio is never sent
  as an image. A local faster-whisper container replaces exhausted cloud STT.
- Added a grant-checked container executor and pcp_execute tool. Staging proved
  uid 1000, read-only root, no socket/private-state mounts, separate chat
  workspaces, and denial before execution when PCP rejects a grant.
- Migration 016 records legacy message identity aliases without editing any
  existing message; first ID-based replay preserves repeated identical turns.
- 351 database-backed Vitest tests passed on disposable PostgreSQL, along with
  TypeScript and production image build. The previous remote/deployed main is
  retained; release checks and final deployment evidence follow below.
- User dropped separate Unix-user/forge-administration setup; container isolation
  is the accepted execution boundary. No selected groups were enabled.

## 2026-11-09 — Outbound AstrBot multimedia

- Confirmed both deployed losses: OpenClaw HTTP collapsed payloads to text,
  then the PCP provider created text-only LLMResponse objects. The new opt-in
  gateway export, recorded broker bytes and AstrBot MessageChain preserve media.
- 356 Vitest tests passed against disposable PostgreSQL, including media-only
  recording, exact byte hashes and signed/idempotent receipt authorization.
  TypeScript, 27 Python plugin tests and production build passed.
- The actual installed AstrBot OneBot serializer produced text+image segments
  with base64 file bytes from the new chain. This check sent nothing to QQ.
- Only the responding agent workspace is readable for local exports. Native
  SSRF guards cover remote URLs; PCP validates media types and limits.
- Database/runtime backups were retained under DockerVolumes. Actual adapter
  send success is tracked separately from preparation and recipient display.

# TODO

Owner-visible future work for Personal Context Protocol. Keep this list focused on versioned product work, not per-round scratch notes.

## v0.1 Completed

- [x] **Core schema and API**
  - [x] App instance and UI auth tables
  - [x] Topic, session, session token, message, event, and migration tables
  - [x] Setup, auth check, topic, session, token, message, event, and export routes
  - [x] API route handlers served from `src/app/api/v1`
  - [x] API routes marked dynamic so builds do not execute runtime database handlers

- [x] **Setup and authentication**
  - [x] Deploy initialization creates schema, app instance, and the first admin credential
  - [x] One-time fallback setup token returned in the browser setup response
  - [x] Admin login page prompts for the UI token before dashboard access
  - [x] Admin login page prompts for fallback initialization when the database is not initialized
  - [x] `/api/v1/auth/check` validates the UI token before saving it in browser storage
  - [x] Direct `/dashboard` access without `ui_token` redirects to `/login?next=/dashboard`
  - [x] Automatic Postgres schema bootstrap when setup status/init runs with `DATABASE_URL`

- [x] **Session workspace UI**
  - [x] Topic creation and selection
  - [x] Session creation, editing, moving, archiving, and restoring
  - [x] Session token generation with copy-to-clipboard
  - [x] Message and event review views
  - [x] Dashboard split into focused topic, session, and workspace components

- [x] **Frontend shell**
  - [x] Public introduction page
  - [x] Light, dark, and system theme toggle
  - [x] Published documentation links use GitHub Pages
  - [x] Footer links for documentation, API reference, deployment, and future work

- [x] **Diagnostics and docs**
  - [x] Error messages include consequence, module/process, and cause
  - [x] Build/runtime diagnostics identify missing required env vars without printing secrets
  - [x] Build/start deploy initialization prints PCP-generated first-login admin tokens when `PCP_ADMIN_TOKEN` is absent
  - [x] Sphinx documentation build root fixed
  - [x] README and protocol docs updated for implemented routes

## v0.1 Remaining Hardening

- [ ] **Startup validation**
  - [ ] Add shared configuration validator for `DATABASE_URL`, `PCP_INSTANCE_SECRET`, and `PCP_APP_URL`
  - [ ] Validate malformed values, not only missing values
  - [ ] Surface deployment configuration errors in the setup UI without exposing secrets

- [ ] **Setup integration tests**
  - [ ] Missing `DATABASE_URL`
  - [ ] Unreachable Neon database
  - [ ] Empty database schema bootstrap
  - [ ] Duplicate initialization
  - [ ] Invalid admin token login attempt

- [ ] **Security audit**
  - [ ] Resolve current `npm audit` findings, including the Next.js 14.2.5 warning
  - [ ] Add CI security scanning
  - [ ] Add automated checks that logs never include plaintext admin or session tokens

- [ ] **API docs sync**
  - [ ] Generate or validate docs against `src/app/api/v1`
  - [ ] Add CI route/doc drift check
  - [ ] Keep README endpoint list in sync with protocol docs

## v0.2 Protocol Features

- [ ] **Token management**
  - [ ] Token revocation UI
  - [ ] Token revocation API flow
  - [ ] Audit events for token revocation
  - [x] Manual custom admin token from the settings page
  - [x] Recovery path for lost UI token through `PCP_ADMIN_TOKEN` without printing tokens to logs
  - [x] Missing admin credential repair during setup/init
  - [ ] Full UI token rotation flow with audit event history

- [ ] **Admin features**
  - [ ] Replace browser-local token storage if stronger admin unlock semantics are needed
  - [ ] Direct topic detail endpoint
  - [ ] Direct message read endpoint
  - [ ] Export download controls in the admin UI

- [ ] **Import/export**
  - [ ] Import endpoint for PCP JSON
  - [ ] Import endpoint for PCP JSONL
  - [ ] Import endpoint for generic transcripts
  - [ ] Richer transcript export formats

- [ ] **Query improvements**
  - [ ] Pagination for topics
  - [ ] Pagination for sessions
  - [ ] Pagination for messages
  - [ ] Pagination for event logs
  - [ ] Cross-session search

- [ ] **Advanced context features**
  - [ ] Bulk operations
  - [ ] Attachment support
  - [ ] Semantic search after the core append-only workflow is stable
  - [ ] Summaries and context compression
  - [ ] Auto-tagging

## v0.3 Operations

- [ ] **Deployment diagnostics**
  - [ ] Vercel diagnostics page
  - [ ] Neon diagnostics page
  - [ ] Schema version reporting
  - [ ] Migration state checks
  - [ ] Connection health checks without exposing secrets

- [ ] **Audit logging**
  - [ ] Structured audit-log views
  - [ ] Token creation events
  - [ ] Token revocation events
  - [ ] Message append events
  - [ ] Session rename events
  - [ ] Archive events

- [ ] **Backup and restore**
  - [ ] Neon branch backup documentation
  - [ ] JSON export restore process
  - [ ] Automated backup scripts

- [ ] **Rate limiting and observability**
  - [ ] AI-facing append endpoint rate limiting
  - [ ] Admin token creation rate limiting
  - [ ] Production log guidance with secret redaction requirements
  - [ ] Metrics collection setup
  - [ ] Alerting configuration

- [ ] **Scaling**
  - [ ] Custom domain documentation
  - [ ] Preview environment setup
  - [ ] Monitoring setup guide
  - [ ] Backup and disaster recovery procedures
  - [ ] Horizontal scaling guide

## Later Candidates

- [ ] Multiple admin users without external auth
- [ ] Per-user data isolation
- [ ] Role-based access control
- [ ] OAuth/SSO after the single-admin model is no longer sufficient
- [ ] MFA support
- [ ] IP allowlisting
- [ ] Optional app-level encryption
- [ ] Read-only session sharing with topic fields hidden from AI-facing surfaces
- [ ] Import prior AI conversations while preserving immutable message ordinals
- [ ] Richer correction workflows that link correction messages to original message IDs
- [ ] Local SQLite development profile
- [ ] Signed messages
- [ ] Advanced threat detection

## Status Legend

- [x] Completed and tested
- [ ] Planned or not started


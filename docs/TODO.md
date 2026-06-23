# TODO

Owner-visible future work for Personal Context Protocol. Keep this list focused on versioned product work, not per-round scratch notes.

## ✅ v0.1 Hardening (Completed)

- [x] **Initial schema and API implementation**
  - [x] 7-table database schema (app_instance, ui_auth, topics, sessions, session_tokens, messages, events)
  - [x] 14 API endpoints (setup, auth, topics, sessions, tokens, messages, events, export)
  - [x] Next.js App Router structure with TypeScript
  - [x] Tailwind CSS integration for UI styling
  - [x] Drizzle ORM for type-safe database operations

- [x] **Admin UI**
  - [x] Setup wizard with UI token generation
  - [x] Dashboard with topic/session management
  - [x] Session detail page with message viewing
  - [x] Token generation with copy-to-clipboard
  - [x] Login/authentication page

- [x] **Documentation**
  - [x] Sphinx/ReadTheDocs documentation structure
  - [x] GitHub Pages auto-deployment workflow
  - [x] All 11 docs files (protocol, data-model, deployment, security, etc.)
  - [x] Readme with clear deployment instructions
  - [x] Contributors section with Trance-0 credit

- [x] **Security and compliance**
  - [x] AGENTS.md as submodule (Trance-0/AGENTS.md)
  - [x] Token hashing with Argon2
  - [x] Scoped session tokens
  - [x] Immutable messages (append-only)
  - [x] Audit event logging
  - [x] Logging guidelines per AGENTS.md §1.4.1

- [x] **Deployment**
  - [x] Vercel configuration (vercel.json)
  - [x] Free tier compatibility (no maxDuration limits)
  - [x] Environment variable setup helper (deploy-setup.py)
  - [x] One-click deploy button
  - [x] Automated tests (7/7 passing)
  - [x] Type checking and build passing

## 🚧 v0.1 Hardening (Remaining)

- [ ] **Startup validation**
  - [ ] Add configuration validator for DATABASE_URL, PCP_INSTANCE_SECRET, PCP_APP_URL
  - [ ] Validate env vars before database connection attempts
  - [ ] Clear error messages for missing/malformed variables

- [ ] **Migration bootstrap**
  - [ ] Explicit migration script for schema creation
  - [ ] Pre-check schema before /api/v1/setup/init
  - [ ] Handle duplicate initialization attempts

- [ ] **Integration tests**
  - [ ] Test missing DATABASE_URL
  - [ ] Test unreachable Neon database
  - [ ] Test missing tables
  - [ ] Test duplicate initialization

- [ ] **Security audit**
  - [ ] Resolve npm audit findings (Next.js 14.2.5 warning)
  - [ ] Update dependencies to patched versions
  - [ ] Add security scanning to CI

- [ ] **Error logging compliance**
  - [ ] Validate all error messages include consequence + module + cause
  - [ ] Add linting rule for INVALID LOG constraint
  - [ ] Audit existing error strings

- [ ] **API docs sync**
  - [ ] Auto-generate docs from src/app/api/v1 routes
  - [ ] Add CI check for route existence vs docs
  - [ ] Prevent docs drift

## 🚀 v0.2 Protocol features

- [ ] **Token management**
  - [ ] Token revocation UI
  - [ ] Token revocation API flow
  - [ ] Audit events for revocation
  - [ ] UI token rotation flow
  - [ ] Show new token exactly once on rotation

- [ ] **Admin features**
  - [ ] Browser-local token storage replacement
  - [ ] Session management endpoints
  - [ ] Direct topic detail endpoints
  - [ ] Direct message read endpoints

- [ ] **Import/Export**
  - [ ] Export download controls in UI
  - [ ] Import endpoint for PCP JSON
  - [ ] Import endpoint for PCP JSONL
  - [ ] Import endpoint for generic transcripts

- [ ] **Query improvements**
  - [ ] Pagination for topics
  - [ ] Pagination for sessions
  - [ ] Pagination for messages
  - [ ] Pagination for event logs
  - [ ] Search functionality

- [ ] **Advanced features**
  - [ ] Bulk operations
  - [ ] Attachment support
  - [ ] Richer transcript export formats
  - [ ] Semantic search (after core workflow stable)
  - [ ] Summaries and context compression
  - [ ] Auto-tagging

## 🛠 v0.3 Operations

- [ ] **Diagnostics**
  - [ ] Deployment diagnostics for Vercel
  - [ ] Deployment diagnostics for Neon
  - [ ] Schema version reporting
  - [ ] Migration state checks
  - [ ] Connection health checks (no secrets exposed)

- [ ] **Audit logging**
  - [ ] Structured audit-log views
  - [ ] Token creation events
  - [ ] Token revocation events
  - [ ] Message append events
  - [ ] Session rename events
  - [ ] Archive events

- [ ] **Backup/Restore**
  - [ ] Neon branch backup documentation
  - [ ] JSON export restore process
  - [ ] Automated backup scripts

- [ ] **Rate limiting**
  - [ ] AI-facing append endpoint rate limiting
  - [ ] Admin token creation rate limiting
  - [ ] Configurable limits per deployment

- [ ] **Observability**
  - [ ] Production log guidance
  - [ ] Secret redaction requirements
  - [ ] Metrics collection setup
  - [ ] Alerting configuration

- [ ] **Scaling**
  - [ ] Custom domain documentation
  - [ ] Preview environment setup
  - [ ] Monitoring setup guide
  - [ ] Backup/DR procedures
  - [ ] Horizontal scaling guide

## 🔮 Later candidates

- [ ] **Multi-user support**
  - [ ] Multiple admin users without external auth
  - [ ] Per-user data isolation
  - [ ] Role-based access control

- [ ] **Authentication**
  - [ ] OAuth/SSO integration (after single-admin model insufficient)
  - [ ] MFA support
  - [ ] IP allowlisting
  - [ ] App-level encryption

- [ ] **Enhanced workflows**
  - [ ] Read-only session sharing (hide topic fields from AI)
  - [ ] Import prior AI conversations
  - [ ] Preserve immutable message ordinals
  - [ ] Richer correction workflows (link to original IDs)
  - [ ] Local SQLite development profile

- [ ] **Security enhancements**
  - [ ] Signed messages
  - [ ] Automated security scanning
  - [ ] Advanced threat detection

---

## Status Legend

- [x] **Completed**: Fully implemented and tested
- [ ] **Planned**: Defined but not started
- 🚧 **In Progress**: Currently being worked on
- 🚀 **v0.2**: Scheduled for next release
- 🛠 **v0.3**: Planned for future operations focus
- 🔮 **Later**: Candidates for future versions

# TODO

Owner-visible future work for Personal Context Protocol. Keep this list focused on versioned product work, not per-round scratch notes.

## v0.1 hardening

- Add a startup configuration validator for `DATABASE_URL`, `PCP_INSTANCE_SECRET`, and `PCP_APP_URL` so setup failures identify the missing or malformed variable before any database call.
- Add an explicit migration/bootstrap command that creates the schema before `/api/v1/setup/init` inserts the app instance and UI token records.
- Add integration tests for setup failure surfaces, including missing `DATABASE_URL`, unreachable Neon, missing tables, and duplicate initialization.
- Resolve current `npm audit` findings, including the Next.js 14.2.5 security warning reported by `npm ci`.
- Replace inline dashboard/session styles with shared UI components while preserving current workflows and scoped-token rules.
- Add automated checks for the INVALID LOG constraint so new error, warning, info, and debug strings must include consequence, module/process, and cause.

## v0.2 protocol features

- Add token revocation UI and API flow with audit events and tests.
- Add UI token rotation flow that invalidates previous UI tokens and shows the new token exactly once.
- Add session archive and topic archive controls in the admin UI.
- Add export download controls in the admin UI for the existing `/api/v1/export` endpoint.
- Add pagination and search for topics, sessions, messages, and event logs.

## v0.3 operations

- Add deployment diagnostics for Vercel and Neon that report schema version, migration state, and connection health without exposing secrets.
- Add structured audit-log views for token creation, token revocation, message append, session rename, and archive events.
- Add backup and restore documentation for Neon branches and JSON exports.
- Add rate limiting for AI-facing append endpoints and admin token creation endpoints.
- Add observability guidance for production logs with secret redaction requirements.

## Later candidates

- Support multiple human admin users without adding external auth to v0.1 semantics.
- Add read-only session sharing with topic fields hidden from AI-facing surfaces.
- Add import tooling for prior AI conversations while preserving immutable message ordinals.
- Add richer correction workflows that link correction messages to original message IDs in metadata.
- Add a local SQLite development profile if it can remain compatible with the production Postgres schema.

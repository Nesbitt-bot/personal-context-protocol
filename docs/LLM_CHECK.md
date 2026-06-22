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

- [Round date] - Initial rewrite to Next.js + Neon (Route B)
  - Created project structure
  - Set up AGENTS.md, CLAUDE.md, CODEX.md
  - Created documentation skeleton
  - TODO: Implement actual application code

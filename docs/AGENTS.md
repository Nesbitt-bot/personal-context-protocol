# PCP Project-Specific Agent Rules

These rules extend the canonical [Trance-0/AGENTS.md](https://github.com/Trance-0/AGENTS.md).

## Project context

**Personal Context Protocol** - Vercel + Neon Postgres web app for scoped AI session recording.

## Critical invariants

### AI must NOT manage topics

- AI-facing APIs reject any `topic_id`, `topic_name`, or topic-related fields in request bodies
- AI session tokens cannot call `/api/v1/topics/*` routes (403)
- Topic creation/rename/archive are admin-only operations
- Backend may resolve `topic_id` internally from session, but never expose to AI

### Messages are immutable

- Never UPDATE or DELETE existing messages
- Corrections are appended as new messages with `role: "correction"` or `role: "system"`
- Each message gets a monotonically increasing `ordinal` within its session
- Corrections reference the original message via metadata if needed

### Token scoping

- Each `session_token` is bound to exactly one `session_id`
- Token validation MUST verify session match on every request
- Revoked tokens (soft delete) must be rejected
- Never return plaintext tokens after initial generation

### No external auth in v0.1

- v0.1 uses single instance token + scoped session tokens only
- No OAuth, no SSO, no GitHub login
- UI token is generated at setup, stored as hash
- If user loses UI token, they must rotate (generates new token)

## Development rules

### Verify before claiming

- **API changes**: Test with curl/POSTMAN before marking complete
- **Migration changes**: Generate and test migrations locally
- **Token flows**: Verify hashing + validation + revocation
- **Build**: Run `npm run build` before claiming deploy readiness

### No unrelated refactors

- Fix the specific issue, don't "clean up" unrelated code
- If you see code smells outside your scope, note them in `docs/TODO.md` but don't fix them now
- Split commits: API changes separate from UI changes separate from tests

### File size discipline

- Keep files under 1000 lines
- If a file crosses 1000 lines, split by responsibility
- Do NOT shrink files by deleting documentation
- Prefer many small, well-named files over few large ones

### Error messages

Every error message must include:
1. **Consequence** - what the user can't do
2. **Module/process** - where the error occurred
3. **Cause** - the specific condition

Example:
- ❌ "Invalid token"
- ✅ "Unable to append messages: session token validation — token revoked or expired. Please generate a new token."

### Git discipline

- Commit locally first, don't push unless explicitly asked
- Force-push requires explicit per-task approval
- Check `git diff --cached --stat` before committing
- Never commit `.env` files or files with real secrets

## Testing requirements

### Required tests for PR

1. **Token validation tests**
   - Valid token accepts requests
   - Invalid token rejects with 401
   - Revoked token rejects with 401
   - Wrong session token rejects with 403

2. **AI token scoping tests**
   - AI token cannot call topic routes (403)
   - AI token cannot access other sessions (403)
   - AI token can only append to its session

3. **Append-only tests**
   - Cannot UPDATE existing messages
   - Cannot DELETE existing messages
   - Corrections are new messages
   - Ordinal assignment is monotonic

4. **Migration tests**
   - Fresh DB: init creates all tables
   - Empty schema: migration applies successfully
   - Existing schema: migration is idempotent
   - No data loss on migration

5. **Setup flow tests**
   - Uninitialized app shows setup page
   - Setup generates UI token (shown once)
   - After setup, UI token unlocks admin functions

### Test commands

```bash
npm run test           # Run all tests
npm run typecheck      # TypeScript check
npm run build          # Build for production
```

## Documentation updates

When making changes, update docs in the same commit:

| Change type | Update docs |
|-------------|-------------|
| New API endpoint | `docs/protocol.md` |
| Schema change | `docs/data-model.md`, `docs/migrations.md` |
| Deploy change | `docs/deployment-vercel-neon.md` |
| Security change | `docs/security.md` |
| Agent instruction change | `docs/agent-instructions.md` |

## Common pitfalls to avoid

### Pitfall 1: Accidentally exposing topic fields to AI

**Wrong:**
```typescript
// AI receives topic_id in response
return { sessionId, topicId, messages };
```

**Correct:**
```typescript
// AI only sees session_id, never topic_id
return { sessionId, messages };
```

### Pitfall 2: Allowing message updates

**Wrong:**
```typescript
// AI tries to "correct" a message
await db.messages.update({ where: { id }, data: { content: "corrected" } });
```

**Correct:**
```typescript
// Append correction as new message
await db.messages.insert({
  sessionId,
  role: "correction",
  content: "Correction to message X: ...",
  metadata: { corrects_message_id: "msg_..." }
});
```

### Pitfall 3: Token leakage in logs

**Wrong:**
```typescript
console.log("Token received:", token);
```

**Correct:**
```typescript
console.log("Token received:", token ? "present" : "missing");
// Store hash only
const tokenHash = await hashToken(token);
```

### Pitfall 4: Breaking migrations

**Wrong:**
```sql
-- Destructive: deletes all messages
DROP TABLE messages;
```

**Correct:**
```sql
-- Safe: adds column, preserves data
ALTER TABLE messages ADD COLUMN metadata_json JSONB DEFAULT '{}';
```

## File locations

- **Setup wizard**: `src/app/setup/*`
- **Admin UI**: `src/app/(admin)/*`
- **API routes**: `src/app/api/v1/*`
- **DB schema**: `drizzle/schema.ts`
- **Migrations**: `drizzle/000*.sql`
- **Tests**: `tests/`

## Questions to ask the user

Before proceeding, if uncertain:

1. "Should I push to GitHub or just commit locally?"
2. "Is this scope correct, or should I focus on X first?"
3. "Do you want me to run migrations locally to test?"
4. "Should I write tests for this feature?"

When in doubt, ask. Better to clarify than to build the wrong thing.

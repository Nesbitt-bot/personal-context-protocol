# PCP Security Model

This document describes the security architecture, threat model, and mitigations for Personal Context Protocol.

## Overview

PCP is designed with a **minimal trust** philosophy:

- External AI agents are useful but untrusted
- Tokens are scoped to minimum necessary access
- Data is immutable once recorded
- All actions are audited
- Human retains ultimate control

## Threat model

### Assumptions

1. **External AI is not trusted**:
   - Prompt injection is possible
   - Model may be compromised
   - Outputs may contain malicious instructions
   - Model may attempt to escalate privileges

2. **Network is secure but not trusted**:
   - HTTPS is used everywhere
   - Tokens may be intercepted if not properly scoped
   - Man-in-the-middle attacks are possible

3. **Database is trusted**:
   - Serverless Postgres (Neon) is assumed secure
   - Connection strings are protected
   - Data at rest is encrypted (Neon default)

4. **User is trusted**:
   - Single-user application
   - User has full access to all data
   - No multi-tenant isolation needed

### Attack surfaces

| Surface | Threat | Mitigation |
|---------|--------|------------|
| AI token | Token theft/leak | Scoped to single session, revocable |
| AI token | Unauthorized access | Hash storage, validation on every request |
| AI token | Privilege escalation | Cannot access topic routes, cannot manage other sessions |
| Message injection | Prompt injection via content | Content stored as-is, never executed |
| Message injection | Malicious instructions in messages | Messages are read-only records, not executable |
| API | SQL injection | Parameterized queries (Drizzle ORM) |
| API | XSS | Content-Type headers, no eval of stored content |
| API | CSRF | Bearer token auth, no cookies |
| API | Rate limiting | Rate limits per token |
| Database | Data breach | Hash tokens, no plaintext secrets |

## Token security

### Token generation

All tokens use cryptographically secure random generation:

```typescript
// Example (using Node.js crypto)
import crypto from 'crypto';
const token = crypto.randomBytes(32).toString('hex');
// Result: 64-character hex string (256 bits of entropy)
```

### Token storage

Tokens are NEVER stored in plaintext:

```typescript
// Correct: store only hash
import { argon2id } from '@node-rs/argon2';
const salt = crypto.randomBytes(16).toString('hex');
const hash = await argon2id.hash(token + salt);
// Store: { token_hash: hash, salt: salt }
// Token is shown to user once, then discarded
```

```typescript
// WRONG: never do this
// Store: { token: token } // NEVER
```

### Token validation

Every API request validates the token:

```typescript
async function validateSessionToken(token: string, sessionId: string) {
  // 1. Lookup token by hash
  const stored = await db.sessionTokens.find({
    where: { token_hash: hashToken(token) }
  });
  
  // 2. Check token exists
  if (!stored) {
    throw new AuthError('Invalid token');
  }
  
  // 3. Check not revoked
  if (stored.revoked) {
    throw new AuthError('Token revoked');
  }
  
  // 4. Check not expired
  if (stored.expires_at && stored.expires_at < now()) {
    throw new AuthError('Token expired');
  }
  
  // 5. Check session match
  if (stored.session_id !== sessionId) {
    throw new AuthError('Token not valid for this session');
  }
  
  // 6. Check capabilities
  return {
    sessionId: stored.session_id,
    canRenameSession: stored.can_rename_session
  };
}
```

### Token lifecycle

```
Generation → Show once → Hash stored → Used for requests → Revoked (optional)
```

**Never**:
- Return token after generation
- Log token (even partially)
- Store token in browser localStorage (use session storage or in-memory)
- Send token in URLs (use Authorization header)

## Message immutability

### Design principle

Messages are **append-only records**. Corrections are new messages.

### Why immutable?

1. **Audit trail**: Can trace exactly what was said when
2. **Dispute resolution**: Original message preserved
3. **Prompt injection resistance**: Cannot rewrite history to hide malicious instructions
4. **Simplicity**: No UPDATE/DELETE logic needed

### Implementation

```typescript
// Correct: append new message
await db.messages.insert({
  session_id: sessionId,
  role: 'correction',
  content: 'Correction to message #5: The date is June 22, not June 21.',
  metadata: {
    corrects_message_id: 'msg_1719099910_xxx'
  }
});
```

```typescript
// WRONG: never update existing messages
// await db.messages.update({ where: { id }, data: { content: 'new content' } });
```

## Topic isolation

### AI cannot manage topics

AI session tokens are scoped to:
- One session
- One topic (via session)

AI **cannot**:
- Create topics
- Rename topics
- Archive topics
- List topics
- Access topic metadata

### Implementation

```typescript
// AI request body validation
const schema = z.object({
  messages: z.array(messageSchema),
  suggested_session_title: z.string().optional()
  // NO topic_id field allowed
});
```

```typescript
// Token capability check
if (token.role === 'ai' && route.startsWith('/api/v1/topics')) {
  return res.status(403).json({
    error: 'Forbidden: AI tokens cannot access topic management routes',
    code: 'FORBIDDEN'
  });
}
```

## Audit logging

### All actions are logged

Every state-changing action creates an event:

| Action | Event | Actor |
|--------|-------|-------|
| Session created | `session.created` | human |
| Session renamed | `session.renamed` | human or ai:<session_id> |
| Token created | `token.created` | human |
| Token revoked | `token.revoked` | human |
| Message appended | `message.appended` | ai:<session_id> |
| Topic created | `topic.created` | human |

### Event structure

```typescript
{
  id: 'evt_1719099900_xxx',
  session_id: 'ses_1719099903_xxx',
  topic_id: 'topic_1719099900_xxx',
  action: 'message.appended',
  actor: 'ai:ses_1719099903_xxx',
  details: {
    message_count: 2
  },
  created_at: '2026-06-22T22:50:00Z'
}
```

### Why audit?

1. **Forensics**: What happened, when, by whom
2. **Debugging**: Trace issues back to source
3. **Compliance**: Meet data retention requirements
4. **Trust**: Human can verify AI behavior

## CORS configuration

### Restrict to app domain

```typescript
// Next.js middleware or API route
export const config = {
  headers: {
    'Access-Control-Allow-Origin': process.env.PCP_APP_URL,
    'Access-Control-Allow-Methods': 'GET, POST',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Credentials': 'false'
  }
};
```

### Why?

- Prevents other domains from calling your API
- Tokens cannot be stolen via CORS-based attacks
- Browser enforces same-origin policy

## Rate limiting

### Recommended limits

| Endpoint | Limit | Window |
|----------|-------|--------|
| AI message append | 100 | 1 hour |
| Admin read/write | 1000 | 1 hour |
| Health check | unlimited | - |

### Implementation

```typescript
// Example using Upstash Redis or similar
async function rateLimit(token: string, limit: number, windowMs: number) {
  const key = `rate_limit:${token}`;
  const count = await redis.incr(key);
  
  if (count === 1) {
    await redis.expire(key, Math.floor(windowMs / 1000));
  }
  
  if (count > limit) {
    throw new RateLimitError('Rate limit exceeded');
  }
}
```

## Input validation

### All input is validated

```typescript
// Zod schema for message append
const messageSchema = z.object({
  role: z.enum(['user', 'assistant', 'system', 'tool', 'correction']),
  content: z.string().min(1).max(10000),
  provider: z.string().max(100).optional(),
  base_model: z.string().max(100).optional(),
  provider_timestamp: z.string().datetime().optional()
});

const appendMessagesSchema = z.object({
  messages: z.array(messageSchema).min(1).max(100),
  suggested_session_title: z.string().max(200).optional()
});
```

### Rejection rules

- Invalid role: 400
- Empty content: 400
- Content too long: 400
- Too many messages: 400
- Topic field present: 400 (AI cannot specify topic)

## Error handling

### No information leakage

Error messages must not reveal:
- Database schema
- Token structure
- Internal paths
- Version numbers (unless public)

### Consistent error format

```json
{
  "error": "Unable to append messages: session token validation — token revoked or expired. Please generate a new token.",
  "code": "TOKEN_REVOKED"
}
```

**Good**:
- Consequence: "Unable to append messages"
- Module: "session token validation"
- Cause: "token revoked or expired"
- Action: "Please generate a new token"

**Bad**:
- "Token invalid" (too vague)
- "Error: undefined is not a function at validateToken (/app/api/v1/messages/route.ts:42)" (exposes internals)

## Secrets management

### What must NEVER be committed

- `.env` files with real values
- Database connection strings with passwords
- `PCP_INSTANCE_SECRET`
- Any API keys
- Token values (even in examples)

### What is safe to commit

- `.env.example` with placeholder values
- Schema definitions
- API route structures
- Test fixtures (without real secrets)

### Environment variable naming

```bash
# .env.example (safe to commit)
DATABASE_URL=postgresql://user:PASSWORD_PLACEHOLDER@host:5432/db?sslmode=require
PCP_INSTANCE_SECRET=GENERATE_RANDOM_SECRET_HERE
PCP_APP_URL=https://your-app.vercel.app
```

## Data protection

### What is stored

| Data | Encryption | Retention |
|------|------------|-----------|
| Messages | Postgres default (at rest) | Indefinite |
| Tokens (hash) | Argon2 hash | Until revoked |
| User content | Postgres default (at rest) | Indefinite |

### What is NOT stored

| Data | Reason |
|------|--------|
| Raw tokens | Shown once, only hash stored |
| User passwords | Single-user, no password needed |
| AI API keys | AI accesses via PCP token, not directly |
| Provider secrets | Never enter PCP system |

### Export security

- Export requires UI token (admin auth)
- Export includes all data (user-owned)
- Export is unencrypted (user's responsibility)
- Export should be stored securely by user

## Security testing

### Required tests

1. **Token validation tests**
   - Invalid token → 401
   - Revoked token → 401
   - Expired token → 401
   - Wrong session token → 403
   - Valid token → 200

2. **Token scoping tests**
   - AI token cannot call topic routes → 403
   - AI token cannot access other sessions → 403
   - AI token can append to correct session → 200

3. **Immutability tests**
   - Cannot UPDATE messages → 405/403
   - Cannot DELETE messages → 405/403
   - Corrections create new messages → 200

4. **Validation tests**
   - Missing required fields → 400
   - Invalid role → 400
   - Topic field in AI request → 400
   - Content too long → 400

5. **Rate limit tests**
   - Over limit → 429
   - Under limit → 200

### Penetration testing checklist

- [ ] Attempt SQL injection in all string fields
- [ ] Attempt XSS via message content
- [ ] Attempt token reuse after revocation
- [ ] Attempt cross-session access with valid token
- [ ] Attempt topic management with AI token
- [ ] Attempt to bypass rate limits
- [ ] Attempt to access admin routes without auth
- [ ] Verify all error messages don't leak internals

## Security updates

### Monitoring

- Track security advisories for dependencies
- Monitor Vercel security dashboard
- Monitor Neon security dashboard
- Review OWASP LLM security updates

### Response plan

1. **Vulnerability discovered**
   - Assess severity
   - Check if exploit is possible in PCP architecture
   - If exploitable: patch immediately, rotate affected tokens
   - Document incident

2. **Token leak suspected**
   - Revoke affected token immediately
   - Generate new token
   - Review audit logs for unauthorized access
   - If compromise confirmed: rotate `PCP_INSTANCE_SECRET`, re-initialize

3. **Data breach**
   - Assess scope
   - Notify affected parties (if multi-user in future)
   - Export all data for user review
   - Consider rotating all tokens
   - Document incident

## Compliance considerations

### Data ownership

- User owns all data
- PCP is a tool, not a service provider
- User can export all data at any time
- User can delete account (drop database)

### Data retention

- Messages retained until user deletes topic/session
- Audit events retained indefinitely
- Tokens retained until revoked

### Privacy

- Single-user design (no multi-tenant concerns)
- No third-party analytics (optional)
- No external data sharing
- No data selling

## Future security improvements

### v0.2+ considerations

- [ ] Multi-factor authentication for UI access
- [ ] Token expiration enforcement
- [ ] IP allowlisting for AI tokens
- [ ] Encrypted message storage
- [ ] Signed message verification
- [ ] Automated security scanning
- [ ] Bug bounty program

## References

- [OWASP Top 10 for LLM Applications](https://owasp.org/www-project-top-10-for-large-language-model-applications/)
- [NIST AI Risk Management Framework](https://www.nist.gov/ai-risk-management-framework)
- [Argon2 specification](https://github.com/PHCon/argon2)

## Summary

PCP's security model is based on:

1. **Least privilege**: Tokens scoped to minimum necessary
2. **Defense in depth**: Multiple layers of validation
3. **Immutable records**: Append-only message storage
4. **Audit trail**: All actions logged
5. **Human control**: User retains ultimate authority

No system is perfectly secure, but these principles minimize the impact of compromised AI agents, leaked tokens, and attempted privilege escalation.

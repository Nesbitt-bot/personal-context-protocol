# Security Model

PCP limits what an AI session token can do.

## Token Rules

- UI token is created during setup and shown once.
- Session tokens are generated per session.
- Token values are stored as salted hashes.
- Session token validation checks token hash, revocation flag, expiration field, and session scope.
- Plaintext tokens must not be logged or returned after creation, except the PCP-generated zero-config first-login admin token. That generated token is printed once in deployment function logs and must be changed immediately after first login. User-supplied admin tokens and Settings-rotated tokens must never be printed.

## AI Boundaries

AI session tokens can:

- Append messages to their assigned session.
- Suggest a session title only when the token allows it.

AI session tokens cannot:

- Create, rename, list, or archive topics.
- Access another session.
- Edit or delete messages.
- Provide topic fields in append requests.

## Message Records

Messages are immutable. Corrections are appended as new messages with `role: "correction"` or `role: "system"`.

## Audit Events

The app records events for topic creation, session creation/archive, token creation, message append, and AI title suggestions.

## Secrets

Do not commit:

- `.env` files with real values
- Neon connection strings
- `PCP_INSTANCE_SECRET`
- UI tokens
- Session tokens

Commit only placeholder examples such as `.env.example`.

## Diagnostics

Errors and logs must include:

1. Consequence
2. Module/process
3. Cause

Shape:

```text
Unable to append messages: AI session recording / append message transaction - session lookup failed
```

Future hardening work is tracked in [TODO.md](TODO.md).

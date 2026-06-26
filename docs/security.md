# Security Model

PCP limits what an AI session token can do.

## Token Rules

- UI token is created during deploy initialization or fallback setup.
- Session tokens are generated per session.
- Token values are stored as salted hashes.
- Session token validation checks token hash, revocation flag, expiration field, and session scope.
- Plaintext tokens must not be logged or returned after creation, except the PCP-generated zero-config first-login admin token. That generated token is printed once in build/start logs and must be changed immediately after first login. User-supplied admin tokens and Settings-rotated tokens must never be printed.

## AI Boundaries

AI session tokens can:

- Append messages to their assigned session.
- Suggest a session title only when the token allows it.

AI session tokens cannot:

- Create, rename, list, or archive topics.
- Access another session.
- Edit or delete messages.
- Provide topic fields in append requests.

## Tokens vs message content

- Access tokens are credentials for **transport only**. They must never become
  archived message content and are never included in exported session JSON or in
  generated copy-paste fallback prompts. Only the MCP/direct upload prompt — which
  the admin intentionally copies once — contains the visible one-time token.
- `strict` mode controls **conversation-content fidelity** (how exactly visible
  message text is preserved), not token handling. Strict export reproduces stored
  message text exactly and may contain secrets if the user recorded them; the UI
  warns about this. It never exposes the access token.

## No automatic continuous recording from prompt-only agents

Copy-paste fallback prompts never ask an agent to "keep recording future
messages" or to upload. Continuous recording only happens when an agent has an
explicit HTTP/MCP tool and the admin chose a direct/MCP prompt.

## Message Records

Messages are append-only for AI tokens; corrections are appended as new messages
with `role: "correction"` or `role: "system"`. A human admin (UI token) may edit
or delete messages to fix wrongly-recorded/imported entries, which is audited.
AI session tokens cannot rewrite or delete messages, manage topics, move
sessions, or search other sessions.

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

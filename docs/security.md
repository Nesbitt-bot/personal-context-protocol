# Security Model

PCP limits what an AI session token can do, and (since v0.2.0) which human
can see which session.

## Human Sign-in

- People sign in with Casdoor OIDC (authorization code + state + nonce + PKCE
  S256). ID tokens are verified against the issuer's JWKS (asymmetric
  algorithms only), issuer, audience, expiry and nonce. See
  [auth-oidc.md](auth-oidc.md).
- Sign-in requires `PCP_OIDC_REQUIRED_GROUP`; `PCP_OIDC_ADMIN_GROUP` members are
  admins. Groups are re-read at every login.
- Missing OIDC configuration disables sign-in (fail closed).
- Browser sessions are server-side (`web_sessions`, hashed ids, 12-hour TTL),
  regenerated on every login, in `__Host-` HttpOnly/Secure/SameSite=Lax
  cookies. Cookie-authenticated writes need the `X-PCP-CSRF` header.
- Admins see all sessions. Other members see only sessions they own or whose
  principal is linked to them; unowned and group sessions are admin-only;
  everything else returns 403.
- The single admin token is a break-glass path, disabled unless
  `PCP_BREAK_GLASS_ADMIN_LOGIN=1`.
- Claim codes (identity linking) are single-use, expire after 15 minutes, are
  stored only as SHA-256 hashes, are rate limited per user, and grant nothing
  outside the signed-in web UI.

## Service Credentials and Turn Grants

- Channel plugins use `pcps_` service credentials (salted scrypt hash, shown
  once, admin-minted, revocable). They are accepted only on
  `/api/v1/service/*`, never as admin, UI login or agent recording token.
- Each credential may assert only principals under its configured prefixes.
- What a turn may read is a server-side grant (readable session set, TTL,
  bound to the credential and the OpenClaw session key). Plugins never pass
  session ids they want to read beyond that set; models never see a grant.
- Group turns read only the group's own session; unlinked direct chats read
  only their own session. Writes go only to the grant's home session.
  See [service-sync.md](service-sync.md).

## PCP Broker (AstrBot)

- The broker binds loopback only (it refuses other addresses) and must never
  be published or tunnelled. It alone holds the OpenClaw gateway token and
  its broker credential, as mounted secret files.
- AstrBot holds only the ingress credential and its signing key. PCP accepts
  a turn only with both, a fresh timestamp (±120 s) and an unseen nonce and
  platform message; otherwise `401`. `astrbot:` principals exist only behind
  such a stamp; channel credentials can never assert them.
- The agent (`relay` / `relay-owner`) and the readable sessions are decided
  by PCP from the attested sender, before the message text is read. Groups
  never read outside the group's own session.
- Broker grants are read-only for the OpenClaw plugin (the broker's
  delegate) and end with the turn. See [broker.md](broker.md).

## Projects and Sync

- Project, workspace and session-context writes from agents and plugins need a
  **global** scoped token with `manage_projects` (reads: `read_all` or
  `manage_projects`). Folder and session tokens, service credentials, session
  recording tokens, web sessions and the admin token are refused on
  `/api/v1/manager/projects*`, `/manager/sessions/by-key/:key/context`,
  `/merge-messages` and `/manager/merge-tasks*`.
- `manage_projects` is never implied for a token minted before v0.2.2.
- On the web UI, non-admins see only projects they own or that contain a
  session visible to them, and only those sessions. Creating or editing
  projects, workspaces, session-project links, conflicts and merge requests is
  admin-only and CSRF-checked.
- Merge tasks only store both versions; PCP never sends content to a model.
- These writes never delete rows or change message content.

## Token Rules

- UI token (break-glass admin token) is created during deploy initialization or fallback setup. It only opens the UI while `PCP_BREAK_GLASS_ADMIN_LOGIN=1`.
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
- `PCP_OIDC_CLIENT_SECRET` or any other deploy env value

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

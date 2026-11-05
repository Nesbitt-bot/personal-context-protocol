# Human sign-in (Casdoor OIDC) and identity claims

Since v0.2.0 people sign in to the PCP web UI with an OpenID Connect provider
(Casdoor). Agent credentials are unchanged: per-session recording tokens,
recording URLs and scoped manager tokens keep working exactly as before and are
never accepted by the web UI routes.

## Environment variables

All six `PCP_OIDC_*` variables are required. If any is missing or malformed,
sign-in is **disabled** and the login page names the missing variables (never
their values). Nothing falls back to an open or token-only login.

| Name | Example | Purpose |
|---|---|---|
| `PCP_OIDC_ISSUER` | `https://auth.trance-0.com` | Issuer URL (https). Discovery is read from `<issuer>/.well-known/openid-configuration` and its `issuer` must match. |
| `PCP_OIDC_CLIENT_ID` | Casdoor application client id | Also the required ID-token audience. |
| `PCP_OIDC_CLIENT_SECRET` | (secret) | Client secret for the token exchange. Keep it in the private deploy env only. |
| `PCP_OIDC_REDIRECT_URI` | `https://pcp.trance-0.com/auth/callback` | Must use the `/auth/callback` path and be registered in Casdoor. Its origin is also used for post-login redirects. |
| `PCP_OIDC_REQUIRED_GROUP` | `trance-0/app-pcp` | Group required to sign in at all. |
| `PCP_OIDC_ADMIN_GROUP` | `trance-0/admin-pcp` | Group whose members are PCP admins (they must also be in the required group). |
| `PCP_BREAK_GLASS_ADMIN_LOGIN` | unset | Set to `1` only to re-enable the legacy admin-token login in an emergency. |

`docker-compose.yml` passes all of these through to the app container.

## Casdoor application setup

1. Application (e.g. `admin/pcp`): add the redirect URL
   `https://<pcp-host>/auth/callback`.
2. Token format: a JWT whose ID token carries a `groups` array claim with
   values like `trance-0/app-pcp` (Casdoor "JWT-Custom" with the `groups`
   field). PCP reads `displayName`, `name`, `preferred_username` and `email`
   when present.
3. Signing: an asymmetric certificate (Casdoor's default RS256). HS* and
   unsigned tokens are rejected.
4. Grant type: authorization code. PCP always sends PKCE (S256) and a nonce.

## Login flow

1. `/login` shows "Continue with Casdoor", which goes to `GET /auth/login`.
2. PCP creates random `state`, `nonce` and PKCE verifier, stores them in
   `oidc_login_states` keyed by the SHA-256 of a random value held in the
   HttpOnly `__Host-pcp_oidc` cookie (10-minute TTL), and redirects to Casdoor.
3. `GET /auth/callback` deletes that row in the same statement that reads it
   (single use), checks `state`, exchanges the code with the verifier and
   verifies the ID token: JWKS signature, issuer, audience (`azp` when there
   are several), expiry/not-before (60 s skew), nonce.
4. Without the required group the user is sent back to
   `/login?auth_error=GROUP_REQUIRED`; no user row or session is created.
5. Otherwise the `users` row is upserted by (issuer, `sub`) with the display
   name, a snapshot of the groups and `is_admin` (admin group present). Any
   existing session cookie is revoked and a brand-new session is issued.

Sessions (`web_sessions`) last 12 hours. The cookie holds a random 256-bit
value and only its SHA-256 is stored. Cookies use the `__Host-` prefix, are
`Secure`, `SameSite=Lax`, `Path=/`; the session cookie is `HttpOnly`. Group
membership and admin status are re-read at every login, so removing someone
from a Casdoor group takes effect at their next login (at most 12 hours).
Sign-out (`POST /auth/logout`) deletes the server-side session.

### CSRF

Every session has a CSRF token. The browser reads it from the non-HttpOnly
`__Host-pcp_csrf` cookie and sends it as `X-PCP-CSRF` on `POST`, `PATCH` and
`DELETE`; the server compares it (constant time, by hash) with the session's
value. Requests without it get `403 CSRF_REJECTED`. `SameSite=Lax` is a second
layer. Break-glass Bearer requests are not CSRF-prone because browsers never
attach that header on their own.

## Authorization model

| Caller | Sees |
|---|---|
| Admin group member, or break-glass admin | Every session, topic, token and event |
| Required-group member | Sessions they own, plus non-group sessions whose `principal` is linked to them |
| Anyone else | Nothing (`401`) |

Sessions carry `owner_user_id`, `principal` (platform identity such as
`telegram:8627151333`, `openclaw-weixin:<id>`, `astrbot:qq:<id>`) and `class`:

- `trusted` — a verified one-to-one identity, or a session created by a
  signed-in user (who becomes its owner);
- `unattributed` — no verified identity (the default for existing sessions);
- `group` — a shared group chat. Admin-only, never claimable.

Unowned sessions without a linked principal are therefore admin-only. Topic
(folder) management, permanent deletion, message edit/delete, the scoped token
manager, export, global events, diagnostics and claim issuing are admin-only.

## Identity claims

A claim links a platform principal to a signed-in user:

1. A claim is issued for a session and principal (today by an admin through
   `POST /api/v1/sessions/:id/claims`; in a later phase by the OpenClaw plugin
   in the first reply of a new trusted DM). The response contains the code and
   a `https://<pcp-host>/claim?code=...` link, once.
2. The user opens the link (or types the code on `/claim`) after signing in
   and confirms. PCP links the principal to the user, makes them the owner of
   that session and marks the claim redeemed.
3. Later sessions with the same principal are visible to that user, and a
   session that later gets the principal attached is owned automatically.

Codes are 20 Crockford base32 characters (100 random bits), stored only as a
SHA-256 hash, expire after 15 minutes, work once, and redemption is limited to
10 failed attempts per user per 15 minutes. A principal already linked to
someone else cannot be claimed (an admin can unlink it with
`DELETE /api/v1/identities`). Codes grant nothing outside the signed-in web UI;
pasting one into a chat does nothing.

## Break-glass admin login

The old single admin token (`ui_auth`, `PCP_ADMIN_TOKEN`, deploy-generated
token) is still created and rotated exactly as before, but it no longer opens
the UI unless `PCP_BREAK_GLASS_ADMIN_LOGIN=1`. Use it only when Casdoor is
unavailable: set the flag, redeploy, sign in with the token on `/login`, then
remove the flag and redeploy. While the flag is off, `/api/v1/auth/check` and
every web UI route reject the token with `401 BREAK_GLASS_DISABLED`, and the
login page clears any token a browser saved earlier.

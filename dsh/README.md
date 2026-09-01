# DSH ↔ PCP sync integration

This documents how the DeepSeek Harness (DSH) live-syncs its session context into
Personal Context Protocol (PCP), and how the feature set added in this branch is
wired together.

## What was added (branch `feat/scoped-tokens`)

| Capability | Endpoint(s) | Auth |
|---|---|---|
| Unified scoped tokens (global/folder/session + permission flags) | `GET/POST/PATCH/DELETE /api/v1/tokens` | admin (UI) |
| Global token manager UI (file-tree scope selector + create/delete-folder/session toggles) | `Tokens` button in top nav → `scoped-token-manager.tsx` | admin |
| Scope-bounded folder/session tree | `GET /api/v1/manager/tree` | scoped (`read_all`) |
| Create session + mint (least privilege) | `POST /api/v1/manager/sessions` | scoped (`create_sessions`, `mint_tokens`) |
| Mint a token for an existing session | `POST /api/v1/manager/sessions/:id/tokens` | scoped (`mint_tokens`) |
| Session-to-session links | `GET/POST/DELETE /api/v1/manager/sessions/:id/links` (+ admin `…/sessions/:id/links`) | scoped / admin |
| Self-hosted retrieval ("RAG", zero external cost) | `POST /api/v1/manager/search` | scoped (`read_all`) |
| Per-session recording | `POST /api/v1/agent/sessions/:id/messages` | session token |

Migrations `008_scoped_tokens` and `009_session_links` are additive and idempotent;
existing `ui_auth` and `session_tokens` are untouched, so existing data is preserved.

## Setup

1. Deploy PCP (Vercel or Docker) and log in with the admin token.
2. Open **Tokens** (top nav) → **New scoped token** → scope `Global (full access)`,
   name it e.g. `dsh-sync`. Copy the token once.
3. Give the DSH worker that token plus your PCP base URL.

## DSH plugin — dynamic (validate now)

The plugin is defined as a dynamic Host plugin (`pcp-1`). It:

- listens to the cross-session `session/event` feed and records `user`/`assistant`/`tool`
  messages into PCP (batched ≤40, debounced 3s, drop-oldest cap, safe retries);
- exposes model tools: `pcp_tree`, `pcp_create_session`, `pcp_select`, `pcp_link`, `pcp_search`.

Edit the two config constants at the top of the Host code and `cordis_run` it:

```js
const PCP_BASE_URL = 'https://pcp.trance-0.com'  // no trailing slash
const PCP_SCOPED_TOKEN = '<global-scope scoped token>'
```

## DSH plugin — permanent (env config)

A dynamic plugin cannot read `process.env`, which is why the dynamic form uses
constants. For a permanent, env-configured install, package the same Host code as
a plugin package (e.g. `@trance-0/dsh-pcp-sync`) and add it to the DSH **host
composition** (it is host-plane: it reads every session's events, not one
session's). The row reads credentials from the environment:

```yaml
- id: pcp-sync
  name: '@trance-0/dsh-pcp-sync'
  config:
    baseUrl: !!js process.env.PCP_BASE_URL
    scopedToken: !!js process.env.PCP_SCOPED_TOKEN
    provider: deepseek
    baseModel: deepseek-v4-pro
```

Then set `PCP_BASE_URL` and `PCP_SCOPED_TOKEN` in the harness environment. The
scoped token's permission flags let you dial the worker down to exactly
`create_sessions` + `mint_tokens` + `read_all` (no folder/session deletion, no
admin).

## Model-directed routing

`pcp_select` sets which PCP session a DSH session records into (a per-DSH-session
override, or a global default); `pcp_link` connects related sessions (e.g. the
`dsh` root session and a `pcp` session); `pcp_search` retrieves relevant past
messages so the model can pull context on demand instead of re-reading whole
histories.

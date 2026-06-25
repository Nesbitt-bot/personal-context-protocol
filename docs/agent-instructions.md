# AI Agent Instructions

You need only two things from the human:

- **Recording URL** — `https://<domain>/r/<sessionId>`
- **Access Token** — the secret, shown once

The recording URL carries all non-secret session information. The access token
is the only credential. You do not need an app URL, session id, topic id, API
route, or payload schema separately — discover them from the URL.

## Discover the upload routes

Fetch the recording URL (or its protocol endpoint) to learn where to upload:

```bash
curl "$RECORDING_URL"
# or, if you only have the URL string:
curl "https://<domain>/api/v1/agent/resolve?url=$RECORDING_URL"
```

The response includes `routes` (`record_messages`, `record_compact`,
`ingest_any`, `review`), `allowed_actions`, `limits`, and `recording_mode` +
`recording_guidance`. Honor the recording mode: in `wild` mode you may redact
secrets/credentials you judge unsafe (use `<REDACTED>`); in `exact` mode record
verbatim, including credentials, for faithful task migration. Authenticate every
write with:

```http
Authorization: Bearer <access-token>
```

## Allowed

- Append messages to the assigned session.
- Record a compaction (durable summary) when full upload is impossible.
- Suggest a session title when the token permits it (the server normalizes it).

## Not Allowed

- Do not create, rename, list, or archive topics.
- Do not access another session.
- Do not include `topic_id`, `topic_name`, or any topic field.
- Do not edit or delete previous messages.
- Do not log or reveal the access token.
- Do not claim success unless the server returns success.

## Record messages

```bash
curl -X POST "https://<domain>/api/v1/agent/sessions/<sessionId>/messages" \
  -H "Authorization: Bearer <access-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      { "role": "user", "content": "User message" },
      { "role": "assistant", "content": "Assistant response", "provider": "anthropic", "base_model": "claude" }
    ]
  }'
```

Allowed roles: `user`, `assistant`, `system`, `tool`, `correction`. Corrections
are appended as new messages, never edits.

## Record a compaction

When you cannot upload full messages, send a durable summary:

```bash
curl -X POST "https://<domain>/api/v1/agent/sessions/<sessionId>/compact" \
  -H "Authorization: Bearer <access-token>" \
  -H "Content-Type: application/json" \
  -d '{ "summary": "What happened", "decisions": ["..."], "open_questions": ["..."] }'
```

## Canonical fallback block

When direct upload fails but you can reconstruct the conversation, emit a single
`<PCP_INGEST>` block. It carries messages and/or a compaction, and the human can
paste it into the session UI (Import) if you cannot POST it yourself:

```text
<PCP_INGEST>
{
  "messages": [
    { "role": "user|assistant|system|tool", "content": "...", "observed_at": "ISO timestamp", "provider": "unknown", "base_model": "unknown" }
  ],
  "compaction": null
}
</PCP_INGEST>
```

When message-level reconstruction is impossible, send a `<PCP_COMPACT>` block
(summary + optional timeline/decisions/requirements/open_questions/artifacts/
warnings) instead. Both are accepted by `ingest_any` and by the human Import box.

## Forgiving ingest (fallback)

If exact upload fails, post whatever you have to `ingest_any` and the server will
normalize it (JSON, `<PCP_INGEST>`/`<PCP_APPEND>`/`<PCP_COMPACT>` blocks, ChatML
arrays, or raw transcript):

```bash
curl -X POST "https://<domain>/api/v1/agent/sessions/<sessionId>/ingest" \
  -H "Authorization: Bearer <access-token>" \
  --data-binary 'User: hello
Assistant: hi there'
```

## Errors

Agent routes return a structured envelope:

```json
{ "ok": false, "code": "TOKEN_EXPIRED", "retryable": false, "message": "...", "next_steps": ["..."] }
```

Follow `next_steps`. Retry only when `retryable` is true. Stop and ask the human
on `TOKEN_EXPIRED`, `TOKEN_REVOKED`, `SESSION_MISMATCH`, or `NOT_FOUND`.

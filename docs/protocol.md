# PCP Protocol Specification (v0.1)

## Overview

This document specifies the Personal Context Protocol API for both human administrators and AI agents.

## Base URL

All API endpoints are relative to the app URL:

```
https://your-app.vercel.app/api/v1/...
```

## Authentication

### UI Admin Token

- Used for: Admin UI, topic management, session management
- Header: `Authorization: Bearer <ui_token>`
- Obtained: During setup, shown once
- Stored: Salted hash only

### AI Session Token

- Used for: Appending messages to a specific session
- Header: `Authorization: Bearer <session_token>`
- Obtained: Generated per session
- Stored: Salted hash only
- Scope: Single session only

## Error responses

All errors return JSON with consistent structure:

```json
{
  "error": "Unable to append messages: session token validation — token revoked or expired. Please generate a new token.",
  "code": "TOKEN_REVOKED",
  "details": {
    "token_id": "tok_1719099900_xxx",
    "session_id": "ses_1719099900_xxx"
  }
}
```

### Error codes

| Code | HTTP | Description |
|------|------|-------------|
| `UNAUTHORIZED` | 401 | Missing or invalid token |
| `FORBIDDEN` | 403 | Token lacks permission for this action |
| `NOT_FOUND` | 404 | Resource not found |
| `VALIDATION_ERROR` | 400 | Request body validation failed |
| `TOKEN_EXPIRED` | 401 | Token has expired |
| `TOKEN_REVOKED` | 401 | Token has been revoked |
| `SESSION_MISMATCH` | 403 | Token not valid for this session |
| `INTERNAL_ERROR` | 500 | Internal server error |

## Public endpoints

### GET /api/v1/health

Check if the API is healthy.

**Request**: No auth required

**Response**:
```json
{
  "status": "ok",
  "version": "0.1.0",
  "database": "connected"
}
```

### GET /api/v1/protocol

Return this protocol specification (or a summary).

**Request**: No auth required

**Response**: JSON with protocol metadata

### GET /api/v1/setup/status

Check if the app has been initialized.

**Request**: No auth required

**Response**:
```json
{
  "initialized": false,
  "needs_migration": false
}
```

## Setup endpoints

### POST /api/v1/setup/init

Initialize the database and create the first UI admin token.

**Request**:
- No auth required (only works if not initialized)
- Body: empty or `{}`

**Response**:
```json
{
  "success": true,
  "ui_token": "ui_1719099900_a3f2b1c4d5e6...",
  "message": "Store this token securely. It will not be shown again."
}
```

**Notes**:
- UI token is shown ONLY in this response
- User must save it or they cannot access admin UI
- If lost, user must rotate (which generates new token)

### POST /api/v1/auth/unlock

Unlock the admin UI with a UI token.

**Request**:
- No auth header (this is the login endpoint)
- Body:
  ```json
  {
    "ui_token": "ui_1719099900_a3f2b1c4d5e6..."
  }
  ```

**Response** (success):
```json
{
  "success": true,
  "session_id": "admin_session_xxx",
  "expires_at": "2026-06-23T22:45:00Z"
}
```

**Response** (failure - 401):
```json
{
  "error": "Unable to log in: user authentication — invalid UI token",
  "code": "UNAUTHORIZED"
}
```

### POST /api/v1/auth/rotate-ui-token

Rotate the UI admin token.

**Request**:
- Auth: `Authorization: Bearer <ui_token>`
- Body: empty or `{}`

**Response**:
```json
{
  "success": true,
  "ui_token": "ui_1719099901_b4g3c2d1e0f9...",
  "message": "Old token is now invalid. Store this token securely."
}
```

**Notes**:
- Invalidates all previous UI tokens
- New token shown only in this response

## Topic endpoints (admin only)

### GET /api/v1/topics

List all topics (including archived).

**Request**:
- Auth: `Authorization: Bearer <ui_token>`

**Response**:
```json
{
  "topics": [
    {
      "id": "topic_1719099900_xxx",
      "title": "work-notes",
      "description": "Work meeting notes",
      "archived": false,
      "created_at": "2026-06-22T22:45:00Z",
      "session_count": 3
    },
    {
      "id": "topic_1719099800_yyy",
      "title": "personal",
      "description": null,
      "archived": true,
      "created_at": "2026-06-21T10:00:00Z",
      "session_count": 0
    }
  ]
}
```

### POST /api/v1/topics

Create a new topic.

**Request**:
- Auth: `Authorization: Bearer <ui_token>`
- Body:
  ```json
  {
    "title": "new-topic",
    "description": "Optional description"
  }
  ```

**Response**:
```json
{
  "id": "topic_1719099902_xxx",
  "title": "new-topic",
  "description": "Optional description",
  "archived": false,
  "created_at": "2026-06-22T22:45:02Z"
}
```

**Validation**:
- `title`: required, unique (non-archived), alphanumeric + hyphens
- `description`: optional, max 500 chars

### GET /api/v1/topics/:id

Get a specific topic.

**Request**:
- Auth: `Authorization: Bearer <ui_token>`

**Response**:
```json
{
  "id": "topic_1719099900_xxx",
  "title": "work-notes",
  "description": "Work meeting notes",
  "archived": false,
  "created_at": "2026-06-22T22:45:00Z",
  "sessions": [
    {
      "id": "ses_1719099901_xxx",
      "title": "Meeting with team",
      "archived": false,
      "created_at": "2026-06-22T22:46:00Z"
    }
  ]
}
```

### POST /api/v1/topics/:id/rename

Rename a topic.

**Request**:
- Auth: `Authorization: Bearer <ui_token>`
- Body:
  ```json
  {
    "title": "new-topic-name"
  }
  ```

**Response**:
```json
{
  "success": true,
  "id": "topic_1719099900_xxx",
  "title": "new-topic-name"
}
```

**Notes**:
- AI tokens receive 403 Forbidden
- New title must be unique (non-archived)

### POST /api/v1/topics/:id/archive

Archive a topic (soft delete).

**Request**:
- Auth: `Authorization: Bearer <ui_token>`

**Response**:
```json
{
  "success": true,
  "id": "topic_1719099900_xxx",
  "archived": true
}
```

**Notes**:
- AI tokens receive 403 Forbidden
- Does not delete sessions or messages

## Session endpoints

### POST /api/v1/topics/:topicId/sessions

Create a new session within a topic.

**Request**:
- Auth: `Authorization: Bearer <ui_token>`
- Body:
  ```json
  {
    "title": "My conversation"
  }
  ```

**Response**:
```json
{
  "id": "ses_1719099903_xxx",
  "topic_id": "topic_1719099900_xxx",
  "title": "My conversation",
  "archived": false,
  "created_at": "2026-06-22T22:47:00Z",
  "last_message_at": null
}
```

### GET /api/v1/sessions/:id

Get a specific session (admin view).

**Request**:
- Auth: `Authorization: Bearer <ui_token>`

**Response**:
```json
{
  "id": "ses_1719099903_xxx",
  "topic_id": "topic_1719099900_xxx",
  "topic_title": "work-notes",
  "title": "My conversation",
  "archived": false,
  "created_at": "2026-06-22T22:47:00Z",
  "last_message_at": "2026-06-22T23:00:00Z",
  "message_count": 12,
  "tokens": [
    {
      "id": "tok_1719099904_xxx",
      "name": "Claude session",
      "revoked": false,
      "created_at": "2026-06-22T22:48:00Z",
      "last_used_at": "2026-06-22T23:00:00Z"
    }
  ]
}
```

**Notes**:
- AI tokens receive 403 Forbidden (cannot list their own session via this route)

### GET /api/v1/sessions/:id/review

Get session for review (includes all messages).

**Request**:
- Auth: `Authorization: Bearer <ui_token>`

**Response**:
```json
{
  "session": {
    "id": "ses_1719099903_xxx",
    "title": "My conversation",
    "topic_title": "work-notes"
  },
  "messages": [
    {
      "id": "msg_1719099910_xxx",
      "ordinal": 1,
      "role": "user",
      "content": "Hello",
      "provider": "unknown",
      "base_model": "unknown",
      "observed_at": "2026-06-22T22:50:00Z"
    },
    {
      "id": "msg_1719099911_xxx",
      "ordinal": 2,
      "role": "assistant",
      "content": "Hi there!",
      "provider": "anthropic",
      "base_model": "claude-3-5-sonnet",
      "observed_at": "2026-06-22T22:50:01Z"
    }
  ],
  "events": [
    {
      "id": "evt_1719099903_xxx",
      "action": "session.created",
      "actor": "human",
      "created_at": "2026-06-22T22:47:00Z"
    },
    {
      "id": "evt_1719099904_xxx",
      "action": "token.created",
      "actor": "human",
      "created_at": "2026-06-22T22:48:00Z"
    },
    {
      "id": "evt_1719099912_xxx",
      "action": "message.appended",
      "actor": "ai:ses_1719099903_xxx",
      "created_at": "2026-06-22T22:50:01Z"
    }
  ]
}
```

### POST /api/v1/sessions/:id/rename

Rename a session.

**Request**:
- Auth: `Authorization: Bearer <ui_token>` OR `Authorization: Bearer <session_token>` (if can_rename_session)
- Body:
  ```json
  {
    "title": "New title"
  }
  ```

**Response**:
```json
{
  "success": true,
  "id": "ses_1719099903_xxx",
  "title": "New title"
}
```

**Notes**:
- AI tokens can only rename if `can_rename_session = true`
- AI cannot rename via this route; they should send `suggested_session_title` when appending messages

### POST /api/v1/sessions/:id/archive

Archive a session.

**Request**:
- Auth: `Authorization: Bearer <ui_token>`

**Response**:
```json
{
  "success": true,
  "id": "ses_1719099903_xxx",
  "archived": true
}
```

**Notes**:
- AI tokens receive 403 Forbidden

## Token endpoints

### POST /api/v1/sessions/:id/tokens

Generate a session token for an AI agent.

**Request**:
- Auth: `Authorization: Bearer <ui_token>`
- Body:
  ```json
  {
    "name": "Claude session",
    "can_rename_session": false
  }
  ```

**Response**:
```json
{
  "token": "tok_1719099905_a3f2b1c4d5e6...",
  "session_id": "ses_1719099903_xxx",
  "name": "Claude session",
  "can_rename_session": false,
  "created_at": "2026-06-22T22:48:00Z"
}
```

**Notes**:
- Token is shown ONLY in this response
- User must copy it immediately
- Token can be revoked but never recovered
- Provide these instructions to AI:
  ```
  Use this token to record messages:
  - APP_URL: https://your-app.vercel.app
  - SESSION_ID: ses_1719099903_xxx
  - SESSION_TOKEN: tok_1719099905_a3f2b1c4d5e6...
  
  POST messages to:
  POST <APP_URL>/api/v1/sessions/<SESSION_ID>/messages
  Authorization: Bearer <SESSION_TOKEN>
  ```

### POST /api/v1/session-tokens/:id/revoke

Revoke a session token.

**Request**:
- Auth: `Authorization: Bearer <ui_token>`

**Response**:
```json
{
  "success": true,
  "id": "tok_1719099905_xxx",
  "revoked": true
}
```

**Notes**:
- Token immediately becomes invalid
- Token cannot be un-revoked
- New token must be generated for AI to continue

## Message endpoints

### POST /api/v1/sessions/:sessionId/messages

Append messages to a session (AI write).

**Request**:
- Auth: `Authorization: Bearer <session_token>`
- Body:
  ```json
  {
    "messages": [
      {
        "role": "user",
        "content": "What's the weather like?",
        "provider": "unknown",
        "base_model": "unknown",
        "provider_timestamp": null
      },
      {
        "role": "assistant",
        "content": "The weather is sunny and 72°F.",
        "provider": "anthropic",
        "base_model": "claude-3-5-sonnet",
        "provider_timestamp": "2026-06-22T22:50:00Z"
      }
    ],
    "suggested_session_title": "Weather conversation"
  }
  ```

**Body fields**:
- `messages`: required, array of message objects
- `messages[].role`: required, one of `user`, `assistant`, `system`, `tool`, `correction`
- `messages[].content`: required, string
- `messages[].provider`: optional, string (e.g., "anthropic", "openai")
- `messages[].base_model`: optional, string (e.g., "claude-3-5-sonnet")
- `messages[].provider_timestamp`: optional, ISO timestamp
- `suggested_session_title`: optional, string (only if token has `can_rename_session`)

**Notes**:
- AI tokens must match the `sessionId` in URL
- `topic_id` is resolved internally from session, NOT accepted in request
- Messages are assigned sequential ordinals automatically
- Event logged for each message append

**Response**:
```json
{
  "success": true,
  "messages": [
    {
      "id": "msg_1719099920_xxx",
      "session_id": "ses_1719099903_xxx",
      "ordinal": 3,
      "created_at": "2026-06-22T22:52:00Z"
    },
    {
      "id": "msg_1719099921_xxx",
      "session_id": "ses_1719099903_xxx",
      "ordinal": 4,
      "created_at": "2026-06-22T22:52:00Z"
    }
  ],
  "session": {
    "id": "ses_1719099903_xxx",
    "title": "Weather conversation",
    "last_message_at": "2026-06-22T22:52:00Z"
  }
}
```

**Response** (401 - invalid token):
```json
{
  "error": "Unable to append messages: session token validation — invalid token signature",
  "code": "UNAUTHORIZED"
}
```

**Response** (403 - wrong session):
```json
{
  "error": "Unable to append messages: session token validation — token is scoped to session ses_1719099900_xxx, not ses_1719099903_xxx",
  "code": "SESSION_MISMATCH"
}
```

**Response** (403 - topic field in request):
```json
{
  "error": "Unable to append messages: message validation — topic fields not allowed in AI requests",
  "code": "VALIDATION_ERROR"
}
```

### GET /api/v1/sessions/:id/messages

Get all messages for a session (admin read).

**Request**:
- Auth: `Authorization: Bearer <ui_token>`

**Response**:
```json
{
  "messages": [
    {
      "id": "msg_1719099910_xxx",
      "ordinal": 1,
      "role": "user",
      "content": "Hello",
      "provider": "unknown",
      "base_model": "unknown",
      "observed_at": "2026-06-22T22:50:00Z"
    },
    {
      "id": "msg_1719099911_xxx",
      "ordinal": 2,
      "role": "assistant",
      "content": "Hi there!",
      "provider": "anthropic",
      "base_model": "claude-3-5-sonnet",
      "observed_at": "2026-06-22T22:50:01Z"
    }
  ]
}
```

## Event endpoints

### GET /api/v1/sessions/:id/events

Get audit events for a session.

**Request**:
- Auth: `Authorization: Bearer <ui_token>`

**Response**:
```json
{
  "events": [
    {
      "id": "evt_1719099903_xxx",
      "action": "session.created",
      "actor": "human",
      "details": {
        "title": "My conversation"
      },
      "created_at": "2026-06-22T22:47:00Z"
    },
    {
      "id": "evt_1719099912_xxx",
      "action": "message.appended",
      "actor": "ai:ses_1719099903_xxx",
      "details": {
        "message_count": 2
      },
      "created_at": "2026-06-22T22:52:00Z"
    }
  ]
}
```

## Import/Export endpoints (admin only)

### GET /api/v1/export

Export all data as JSON.

**Request**:
- Auth: `Authorization: Bearer <ui_token>`

**Response**: `application/json` with full database dump

### POST /api/v1/import/pcp-json

Import data from PCP JSON export.

**Request**:
- Auth: `Authorization: Bearer <ui_token>`
- Body: PCP JSON format (see `docs/export-format.md`)

**Response**:
```json
{
  "success": true,
  "imported": {
    "topics": 2,
    "sessions": 5,
    "messages": 42
  }
}
```

### POST /api/v1/import/pcp-jsonl

Import data from PCP JSONL format.

**Request**:
- Auth: `Authorization: Bearer <ui_token>`
- Body: JSONL (one JSON object per line)

**Response**: Same as PCP JSON import

### POST /api/v1/import/generic-transcript

Import a generic transcript format.

**Request**:
- Auth: `Authorization: Bearer <ui_token>`
- Body:
  ```json
  {
    "topic_id": "topic_1719099900_xxx",
    "session_title": "Imported conversation",
    "messages": [
      {
        "role": "user",
        "content": "Hello",
        "timestamp": "2026-06-22T22:00:00Z"
      },
      {
        "role": "assistant",
        "content": "Hi!",
        "timestamp": "2026-06-22T22:00:01Z"
      }
    ]
  }
  ```

**Response**:
```json
{
  "success": true,
  "session_id": "ses_1719099906_xxx",
  "message_count": 2
}
```

## PCP_APPEND format (offline fallback)

If the API is unavailable, AI agents can output a `PCP_APPEND` block:

```xml
<PCP_APPEND>
{
  "schema_version": "0.1",
  "session_id": "ses_1719099903_xxx",
  "messages": [
    {
      "role": "user",
      "content": "Hello",
      "provider": "unknown",
      "base_model": "unknown"
    },
    {
      "role": "assistant",
      "content": "Hi there!",
      "provider": "anthropic",
      "base_model": "claude-3-5-sonnet"
    }
  ],
  "suggested_session_title": "Greeting conversation"
}
</PCP_APPEND>
```

**Rules**:
- No `topic_id` or topic fields
- Valid JSON inside the block
- Human will later import this via UI or API

## AI agent instructions

Generated when creating a session token. See [`docs/agent-instructions.md`](agent-instructions.md).

## Rate limits

- AI endpoints: 100 requests/hour per token
- Admin endpoints: 1000 requests/hour per UI token
- No rate limit on health check

## CORS

- Allowed origins: app domain only
- Allowed methods: GET, POST
- Allowed headers: Authorization, Content-Type
- Credentials: not allowed

## Versioning

Current version: `0.1`

API routes include version in path: `/api/v1/...`

Breaking changes will increment major version: `/api/v2/...`

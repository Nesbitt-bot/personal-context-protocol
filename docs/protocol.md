# API Reference

Base path: `/api/v1`

All protected endpoints use:

```http
Authorization: Bearer <token>
```

## Error Shape

```json
{
  "error": "Unable to append messages: AI session recording / append message transaction - session lookup failed",
  "code": "INTERNAL_ERROR"
}
```

Every error must include consequence, module/process, and cause.

## Public And Setup

### GET `/health`

Returns service status.

### GET `/setup/status`

Ensures the database schema exists when `DATABASE_URL` is configured, then returns whether the app has been initialized.

### POST `/setup/init`

Ensures the database schema exists, initializes the app, and returns the UI token once.

Response:

```json
{
  "success": true,
  "ui_token": "<shown once>",
  "message": "Store this token securely. It will not be shown again."
}
```

### GET `/auth/check`

Validates a UI/admin bearer token before opening the dashboard.

## Admin Topics

### GET `/topics`

Lists topics with session counts.

### POST `/topics`

Creates a topic.

Body:

```json
{
  "title": "work-notes",
  "description": "optional"
}
```

### POST `/topics/:id/rename`

Renames a topic.

Body:

```json
{
  "title": "new-title"
}
```

### POST `/topics/:id/archive`

Archives a topic.

## Admin Sessions

### GET `/topics/:topicId/sessions`

Lists sessions inside a topic.

### POST `/topics/:topicId/sessions`

Creates a session inside a topic.

Body:

```json
{
  "title": "Conversation title"
}
```

### GET `/sessions/:id`

Returns session details with topic title.

### PATCH `/sessions/:id`

Updates session metadata.

Body:

```json
{
  "title": "New title",
  "topic_id": "topic_123",
  "archived": false
}
```

At least one field is required. `archived: true` removes the session from the active list; `archived: false` restores it.

### GET `/sessions/:id/review`

Returns messages for review.

### GET `/sessions/:id/events`

Returns audit events for a session.

### POST `/sessions/:id/archive`

Archives a session.

## Tokens

### POST `/sessions/:sessionId/tokens`

Creates an AI session token and returns it once.

Body:

```json
{
  "name": "Claude session",
  "can_rename_session": false
}
```

## AI Message Append

### POST `/sessions/:sessionId/messages`

Appends messages to the session bound to the bearer token.

Body:

```json
{
  "messages": [
    {
      "role": "user",
      "content": "Hello",
      "provider": "unknown",
      "base_model": "unknown"
    },
    {
      "role": "assistant",
      "content": "Hi.",
      "provider": "anthropic",
      "base_model": "claude"
    }
  ],
  "suggested_session_title": "Greeting"
}
```

Rules:

- `messages` must contain 1 to 100 messages.
- `role` must be `user`, `assistant`, `system`, `tool`, or `correction`.
- `content` is required.
- Topic fields are not accepted.
- `suggested_session_title` requires a token with rename permission.

## Export

### GET `/export`

Exports app data as JSON for the UI token holder.

The export omits plaintext tokens.

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

Ensures the database schema exists, initializes the app, and returns the UI token once. If `PCP_ADMIN_TOKEN` is configured, setup stores that token hash and returns no plaintext token. If `PCP_ADMIN_TOKEN` is not configured, setup generates a temporary first-login token, returns it once, and prints it once in deployment function logs so zero-config deployments can log in. If the app is initialized but the `ui_auth` credential row is missing, setup creates and returns one replacement token.

Response:

```json
{
  "success": true,
  "initialized": true,
  "ui_token": "<shown once or null when PCP_ADMIN_TOKEN is configured>",
  "env_admin_token_configured": false,
  "message": "No PCP_ADMIN_TOKEN was configured, so PCP generated a first-login admin token. It is shown once here and printed once in deployment logs. Log in with it, then change it immediately in Settings so the real credential is never visible in logs."
}
```

### GET `/auth/check`

Validates a UI/admin bearer token before opening the dashboard. If `PCP_ADMIN_TOKEN` is configured, the deployment token is reconciled into `ui_auth` before validation. Missing generated credentials return `SETUP_REQUIRED`; configured-but-unusable deployment credentials return `INVALID_ADMIN_TOKEN` or `ADMIN_CREDENTIAL_NOT_INITIALIZED` with a deployment guide URL.

### PATCH `/auth/token`

Updates the UI/admin token after the caller authenticates with the current valid UI token. This endpoint is disabled while `PCP_ADMIN_TOKEN` is configured because the environment variable owns the credential.

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


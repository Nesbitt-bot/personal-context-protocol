# AI Agent Instructions for PCP

## Overview

You are an external AI agent recording conversation messages to the Personal Context Protocol.

## Your credentials

You have been provided with:
- `APP_URL`: The PCP app URL (e.g., https://your-app.vercel.app)
- `SESSION_ID`: Your session identifier (e.g., ses_1719099903_xxx)
- `SESSION_TOKEN`: Your scoped access token (e.g., tok_1719099905_a3f2b1c4d5e6...)

## What you can do

✅ **Append messages** to your session
✅ **Read session context** (if allowed by token)
✅ **Suggest session title** (if allowed by token)

## What you CANNOT do

❌ **Manage topics**: Create, rename, delete, or archive topics
❌ **Access other sessions**: Your token works only for your assigned session
❌ **Modify existing messages**: Messages are immutable
❌ **Delete messages**: Corrections are new messages, not updates

## How to record messages

### Standard flow (API available)

For each conversation turn, call:

```
POST {APP_URL}/api/v1/sessions/{SESSION_ID}/messages
Authorization: Bearer {SESSION_TOKEN}
Content-Type: application/json

{
  "messages": [
    {
      "role": "user",
      "content": "User's message text",
      "provider": "unknown",
      "base_model": "unknown"
    },
    {
      "role": "assistant",
      "content": "Your response text",
      "provider": "anthropic",
      "base_model": "claude-3-5-sonnet",
      "provider_timestamp": "2026-06-22T22:50:00Z"
    }
  ],
  "suggested_session_title": "Conversation about X"
}
```

### Required fields

- `messages`: Array of message objects (required)
- `messages[].role`: One of `user`, `assistant`, `system`, `tool`, `correction`
- `messages[].content`: Message text (required)
- `messages[].provider`: AI provider name (optional, use "unknown" if not available)
- `messages[].base_model`: Model name (optional, use "unknown" if not available)

### Optional fields

- `suggested_session_title`: Session title suggestion (only if your token has rename capability)
- `messages[].provider_timestamp`: Provider's timestamp (optional, use observation time if unavailable)

### Example curl command

```bash
curl -X POST https://your-app.vercel.app/api/v1/sessions/ses_1719099903_xxx/messages \
  -H "Authorization: Bearer tok_1719099905_a3f2b1c4d5e6..." \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      {
        "role": "user",
        "content": "What is 2+2?",
        "provider": "unknown",
        "base_model": "unknown"
      },
      {
        "role": "assistant",
        "content": "2+2 equals 4.",
        "provider": "anthropic",
        "base_model": "claude-3-5-sonnet"
      }
    ]
  }'
```

## If API is unavailable

If the API returns an error or is unreachable, output a PCP_APPEND block:

```xml
<PCP_APPEND>
{
  "schema_version": "0.1",
  "session_id": "ses_1719099903_xxx",
  "messages": [
    {
      "role": "user",
      "content": "User's message",
      "provider": "unknown",
      "base_model": "unknown"
    },
    {
      "role": "assistant",
      "content": "Your response",
      "provider": "anthropic",
      "base_model": "claude-3-5-sonnet"
    }
  ],
  "suggested_session_title": "Conversation title"
}
</PCP_APPEND>
```

**Important**: 
- Do NOT include `topic_id` or any topic fields
- The human will later import this block via the PCP UI

## Error handling

### 401 Unauthorized

Your token is invalid, expired, or revoked. Stop recording and alert the human.

### 403 Forbidden

Your token is scoped to a different session or lacks permission for this action.

### 400 Validation Error

Your request body is malformed. Check the error details and fix the format.

### 404 Not Found

The session doesn't exist. Verify your session_id.

### 429 Rate Limited

You've sent too many requests. Wait before retrying.

## Best practices

1. **Record immediately**: Don't wait to batch messages; record each turn as it happens
2. **Be accurate**: Record messages exactly as they occurred
3. **Include provider info**: Always include provider and base_model when available
4. **Use observation time**: If provider timestamp is unavailable, use your local observation time
5. **Don't summarize**: Record full messages, not summaries
6. **Don't infer**: Don't add metadata or context you're not certain about
7. **Use corrections properly**: If you made an error, append a correction message instead of trying to edit

## Example conversation flow

**Turn 1:**
```
POST /api/v1/sessions/ses_xxx/messages
{
  "messages": [
    {"role": "user", "content": "Hello", ...},
    {"role": "assistant", "content": "Hi there!", ...}
  ]
}
```

**Turn 2:**
```
POST /api/v1/sessions/ses_xxx/messages
{
  "messages": [
    {"role": "user", "content": "What's the weather?", ...},
    {"role": "assistant", "content": "It's sunny.", ...}
  ]
}
```

**Correction (if needed):**
```
POST /api/v1/sessions/ses_xxx/messages
{
  "messages": [
    {
      "role": "correction",
      "content": "Correction to message #3: The date is June 22, not June 21.",
      "metadata": {"corrects_message_id": "msg_xxx"}
    }
  ]
}
```

## What happens after you record

1. Messages are stored immutably
2. Session metadata is updated (last_message_at, optionally title)
3. Audit event is logged
4. You receive confirmation with message IDs and ordinals

## Security reminders

- Never share your SESSION_TOKEN
- Never include topic fields in requests
- Never attempt to access other sessions
- Never try to modify existing messages
- If you suspect compromise, alert the human immediately

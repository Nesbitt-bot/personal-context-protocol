# AI Agent Instructions

Use only the session credentials provided by the human:

- `APP_URL`
- `SESSION_ID`
- `SESSION_TOKEN`

## Allowed

- Append messages to the assigned session.
- Suggest a session title when the token permits it.

## Not Allowed

- Do not create, rename, list, or archive topics.
- Do not access another session.
- Do not include `topic_id`, `topic_name`, or any topic field.
- Do not edit or delete previous messages.
- Do not log or reveal the session token.

## Append Messages

```bash
curl -X POST "$APP_URL/api/v1/sessions/$SESSION_ID/messages" \
  -H "Authorization: Bearer $SESSION_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      {
        "role": "user",
        "content": "User message",
        "provider": "unknown",
        "base_model": "unknown"
      },
      {
        "role": "assistant",
        "content": "Assistant response",
        "provider": "openai",
        "base_model": "gpt"
      }
    ]
  }'
```

Allowed roles:

- `user`
- `assistant`
- `system`
- `tool`
- `correction`

Corrections must be appended as new messages.

## Errors

Stop and ask the human when you receive:

- `401`: token missing, invalid, expired, or revoked
- `403`: token is not allowed to perform the requested action
- `404`: session not found
- `400`: request body is invalid

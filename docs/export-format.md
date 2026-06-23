# Export Format

`GET /api/v1/export` returns a JSON snapshot for the UI token holder.

Top-level fields:

```json
{
  "export_version": "0.1",
  "exported_at": "2026-06-23T00:00:00.000Z",
  "app_instance": {},
  "topics": [],
  "sessions": [],
  "messages": [],
  "session_tokens": [],
  "events": []
}
```

Plaintext UI tokens and session tokens are not exported.

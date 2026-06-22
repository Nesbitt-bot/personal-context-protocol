# PCP Export Format

## Overview

PCP supports exporting and importing data in JSON and JSONL formats.

## Export structure

### Full export (GET /api/v1/export)

```json
{
  "export_version": "0.1",
  "exported_at": "2026-06-22T22:50:00Z",
  "app_instance": {
    "id": "instance_1",
    "version": "0.1.0",
    "initialized_at": "2026-06-22T22:45:00Z"
  },
  "topics": [
    {
      "id": "topic_1719099900_xxx",
      "title": "work-notes",
      "description": "Work meeting notes",
      "archived": false,
      "created_at": "2026-06-22T22:45:00Z"
    }
  ],
  "sessions": [
    {
      "id": "ses_1719099903_xxx",
      "topic_id": "topic_1719099900_xxx",
      "title": "Meeting with team",
      "archived": false,
      "created_at": "2026-06-22T22:47:00Z",
      "last_message_at": "2026-06-22T23:00:00Z"
    }
  ],
  "messages": [
    {
      "id": "msg_1719099910_xxx",
      "session_id": "ses_1719099903_xxx",
      "topic_id": "topic_1719099900_xxx",
      "ordinal": 1,
      "role": "user",
      "content": "Hello",
      "content_type": "markdown",
      "provider": "unknown",
      "base_model": "unknown",
      "observed_at": "2026-06-22T22:50:00Z"
    }
  ],
  "session_tokens": [
    {
      "id": "tok_1719099905_xxx",
      "session_id": "ses_1719099903_xxx",
      "name": "Claude session",
      "can_rename_session": false,
      "revoked": false,
      "created_at": "2026-06-22T22:48:00Z"
      // Note: token_hash and salt are NOT included
    }
  ],
  "events": [
    {
      "id": "evt_1719099903_xxx",
      "session_id": "ses_1719099903_xxx",
      "topic_id": "topic_1719099900_xxx",
      "action": "session.created",
      "actor": "human",
      "details": {},
      "created_at": "2026-06-22T22:47:00Z"
    }
  ]
}
```

### Import formats

#### PCP JSON import

Same structure as export. Replaces existing data (use with caution).

#### PCP JSONL import

One JSON object per line, each representing a single record:

```json
{"type": "topic", "data": {"id": "topic_xxx", "title": "work", ...}}
{"type": "session", "data": {"id": "ses_xxx", "topic_id": "topic_xxx", ...}}
{"type": "message", "data": {"id": "msg_xxx", "session_id": "ses_xxx", ...}}
```

#### Generic transcript import

Import conversations from other sources:

```json
{
  "topic_id": "topic_xxx",
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

## Security notes

- Export contains all data - store securely
- Tokens are NOT exported (only metadata)
- Import requires admin authentication
- Import may fail if conflicting IDs exist
- Always backup before importing

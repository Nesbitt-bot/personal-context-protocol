# Session files and paste recording

Use the clipboard button beside Session settings to open **Paste fallback to
record**. The dialog accepts the same fallback blocks and plain transcripts as
before. It closes with Escape or Close and returns focus to the button; the
message pane no longer contains a permanent paste composer.

In **Session settings → Import / Export**, **Download JSON** downloads the full
stored session and **Upload JSON** opens a JSON file picker. A successful
upload refreshes the messages and reports new and skipped message counts.

The file uses the content fields from the OpenSearch session document:

```json
{
  "sid": "ses_source",
  "title": "Example session",
  "summary": "Recorded context and summaries",
  "messages": [
    { "ordinal": 1, "role": "user", "content": "Question" },
    { "ordinal": 2, "role": "assistant", "content": "Answer" }
  ]
}
```

Exports are plain JSON, without PCP markup wrappers, and come from PostgreSQL
so they include the latest messages even before the search index refreshes.
Content is preserved exactly, including repeated turns and whitespace. The
format contains transcript content, not attachment bytes, provider usage,
credentials, ownership, task links or operation history. Store the downloaded
file as privately as the source session.

Upload also accepts an OpenSearch GET/search hit's `_source` wrapper. Derived
`fingerprint`, `ready` and `passages` fields are ignored; the backend indexer
rebuilds them. The source `sid` never changes which destination you can access.

Upload merges messages into the selected session in source ordinal order.
Matching existing turns are reused one by one, so repeated turns are retained
and retries or concurrent imports do not duplicate them. New messages receive
new destination ordinals. An empty session adopts the file's title and summary;
a session with existing content keeps its title and summary. Category, task,
owner and access settings remain those of the selected session. The import
is audited and committed atomically; read-only sessions cannot be imported into.

Limits: 20 MiB per file, 10,000 messages, 100,000 characters per message and
2,000,000 summary characters. The export endpoint refuses sessions exceeding
these limits rather than silently producing a partial file. Invalid or oversized
uploads show an error and leave the destination unchanged.

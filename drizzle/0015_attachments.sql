CREATE TABLE IF NOT EXISTS attachments (
  id text PRIMARY KEY,
  session_id text NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  message_id text NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  external_key text NOT NULL,
  blob_sha256 text NOT NULL,
  upload_sha256 text NOT NULL,
  size_bytes integer NOT NULL,
  mime_type text NOT NULL,
  filename text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(session_id, external_key)
);
CREATE INDEX IF NOT EXISTS attachments_message_idx ON attachments(message_id);
CREATE INDEX IF NOT EXISTS attachments_blob_idx ON attachments(blob_sha256);

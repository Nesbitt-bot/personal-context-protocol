CREATE TABLE IF NOT EXISTS import_compaction_receipts (
  session_id text NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  ordinal integer NOT NULL,
  original_id text NOT NULL,
  role text NOT NULL,
  provider_timestamp timestamptz NOT NULL,
  content_sha256 text NOT NULL,
  removed boolean NOT NULL,
  PRIMARY KEY (session_id, ordinal)
);

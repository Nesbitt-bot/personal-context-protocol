CREATE TABLE IF NOT EXISTS session_presence (
  session_id text NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  reporter text NOT NULL,
  run_id text NOT NULL,
  state text NOT NULL,
  seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, reporter)
);

-- 009_session_links: undirected, optionally labelled links between sessions.
-- session_a/session_b are stored in normalized order (a <= b) by the write path.

CREATE TABLE IF NOT EXISTS session_links (
  id text PRIMARY KEY,
  session_a text NOT NULL REFERENCES sessions(id),
  session_b text NOT NULL REFERENCES sessions(id),
  label text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_a, session_b)
);

CREATE INDEX IF NOT EXISTS session_links_a_idx ON session_links(session_a);
CREATE INDEX IF NOT EXISTS session_links_b_idx ON session_links(session_b);

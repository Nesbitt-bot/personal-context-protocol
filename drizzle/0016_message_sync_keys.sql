CREATE TABLE IF NOT EXISTS message_sync_keys (
    session_id text NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    external_id text NOT NULL,
    message_id text NOT NULL UNIQUE REFERENCES messages(id) ON DELETE CASCADE,
    PRIMARY KEY (session_id, external_id)
);

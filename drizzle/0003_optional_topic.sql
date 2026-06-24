-- Migration: 004_optional_topic
-- Description: Allow uncategorized sessions — sessions (and their denormalized
-- messages) may have no topic. Idempotent and data-preserving: DROP NOT NULL is
-- a no-op when the column is already nullable, and existing rows keep their
-- topic_id. The foreign key remains; NULL is simply allowed.

ALTER TABLE sessions ALTER COLUMN topic_id DROP NOT NULL;
ALTER TABLE messages ALTER COLUMN topic_id DROP NOT NULL;

INSERT INTO schema_migrations (version, checksum)
VALUES ('004_optional_topic', 'nullable_session_and_message_topic')
ON CONFLICT (version) DO NOTHING;

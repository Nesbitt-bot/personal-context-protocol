-- 020_session_task_topic_invariant: enforce that a session's category always
-- follows its parent task's category (and vice versa). A session "sees" only
-- its parent task; a task "sees" its parent category. Moving either one keeps
-- the whole tree consistent, so a session can never be moved while its task is
-- left behind (or uncreated) and thus invisible on the board.

CREATE OR REPLACE FUNCTION sync_session_topic_from_task() RETURNS trigger AS $$
BEGIN
  UPDATE sessions SET topic_id = NEW.topic_id, updated_at = now()
  WHERE task_id = NEW.id AND topic_id IS DISTINCT FROM NEW.topic_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS task_topic_sync_sessions ON tasks;
CREATE TRIGGER task_topic_sync_sessions
  AFTER UPDATE OF topic_id ON tasks
  FOR EACH ROW EXECUTE FUNCTION sync_session_topic_from_task();

CREATE OR REPLACE FUNCTION sync_task_topic_from_session() RETURNS trigger AS $$
BEGIN
  IF NEW.task_id IS NOT NULL THEN
    UPDATE tasks SET topic_id = NEW.topic_id, updated_at = now()
    WHERE id = NEW.task_id AND topic_id IS DISTINCT FROM NEW.topic_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS session_topic_sync_task ON sessions;
CREATE TRIGGER session_topic_sync_task
  AFTER UPDATE OF topic_id ON sessions
  FOR EACH ROW EXECUTE FUNCTION sync_task_topic_from_session();

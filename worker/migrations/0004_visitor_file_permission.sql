ALTER TABLE visitor_sessions ADD COLUMN allow_files INTEGER NOT NULL DEFAULT 0;

UPDATE visitor_sessions
SET allow_files = 1
WHERE id IN (SELECT visitor_id FROM tickets WHERE allow_files = 1 AND visitor_id IS NOT NULL);

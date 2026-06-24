ALTER TABLE visitor_sessions ADD COLUMN ping_disabled INTEGER NOT NULL DEFAULT 0;

UPDATE visitor_sessions SET allow_files = 0;
UPDATE tickets SET allow_files = 0 WHERE status = 'open';

UPDATE visitor_sessions
SET ping_disabled = 1
WHERE id IN (SELECT visitor_id FROM tickets WHERE ping_disabled = 1 AND visitor_id IS NOT NULL);

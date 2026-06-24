ALTER TABLE tickets ADD COLUMN allow_files INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tickets ADD COLUMN ping_disabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE messages ADD COLUMN attachment_name TEXT;
ALTER TABLE messages ADD COLUMN attachment_type TEXT;
ALTER TABLE messages ADD COLUMN staff_name TEXT;
ALTER TABLE messages ADD COLUMN staff_role TEXT;
ALTER TABLE messages ADD COLUMN staff_avatar_url TEXT;
ALTER TABLE messages ADD COLUMN staff_role_color TEXT;

CREATE TABLE IF NOT EXISTS support_restrictions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  visitor_id TEXT NOT NULL,
  device_hash TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  user_agent_hash TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('timeout', 'ban')),
  expires_at TEXT,
  created_at TEXT NOT NULL,
  created_by_ticket TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS support_restrictions_identity
  ON support_restrictions(visitor_id, device_hash, expires_at);

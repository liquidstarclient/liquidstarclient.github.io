PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS tickets (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL UNIQUE,
  visitor_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('open', 'closed')),
  token_hash TEXT NOT NULL,
  device_hash TEXT NOT NULL,
  session_hash TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  user_agent_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  closed_at TEXT,
  close_reason TEXT,
  allow_files INTEGER NOT NULL DEFAULT 0,
  ping_disabled INTEGER NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX IF NOT EXISTS one_open_ticket_per_device
  ON tickets(device_hash)
  WHERE status = 'open';

CREATE INDEX IF NOT EXISTS tickets_thread_id ON tickets(thread_id);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  author TEXT NOT NULL CHECK (author IN ('visitor', 'staff', 'system')),
  content TEXT NOT NULL,
  image_url TEXT,
  attachment_name TEXT,
  attachment_type TEXT,
  staff_name TEXT,
  staff_role TEXT,
  staff_avatar_url TEXT,
  staff_role_color TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS messages_ticket_time
  ON messages(ticket_id, created_at);

CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  window_started INTEGER NOT NULL,
  count INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS security_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  created_at TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  user_agent_hash TEXT NOT NULL,
  details TEXT
);

CREATE INDEX IF NOT EXISTS security_events_created_at
  ON security_events(created_at);

CREATE TABLE IF NOT EXISTS visitor_sessions (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL,
  device_hash TEXT NOT NULL,
  session_hash TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  user_agent_hash TEXT NOT NULL,
  browser TEXT NOT NULL,
  allow_files INTEGER NOT NULL DEFAULT 0,
  ping_disabled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS visitor_sessions_device
  ON visitor_sessions(device_hash, expires_at);

CREATE TABLE IF NOT EXISTS processed_discord_messages (
  message_id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL,
  command TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS processed_discord_messages_created
  ON processed_discord_messages(created_at);

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

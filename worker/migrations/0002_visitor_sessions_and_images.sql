ALTER TABLE tickets ADD COLUMN visitor_id TEXT;
ALTER TABLE messages ADD COLUMN image_url TEXT;

CREATE TABLE IF NOT EXISTS visitor_sessions (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL,
  device_hash TEXT NOT NULL,
  session_hash TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  user_agent_hash TEXT NOT NULL,
  browser TEXT NOT NULL,
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

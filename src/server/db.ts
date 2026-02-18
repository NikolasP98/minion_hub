import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const DB_DIR = './data';
const DB_PATH = join(DB_DIR, 'minion_hub.db');

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS chat_messages (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id     TEXT    NOT NULL,
  session_key  TEXT    NOT NULL,
  role         TEXT    NOT NULL CHECK (role IN ('user', 'assistant')),
  content      TEXT    NOT NULL,
  run_id       TEXT,
  timestamp    INTEGER NOT NULL,
  created_at   INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
);
CREATE INDEX IF NOT EXISTS idx_chat_by_agent ON chat_messages (agent_id, session_key, timestamp);

CREATE TABLE IF NOT EXISTS connection_events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type   TEXT    NOT NULL,
  host_name    TEXT,
  host_url     TEXT,
  duration_ms  INTEGER,
  reason       TEXT,
  occurred_at  INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
);
`;

// Dynamic import to avoid build errors when better-sqlite3 isn't present
let db: import('better-sqlite3').Database | null = null;

async function initDb() {
  try {
    if (!existsSync(DB_PATH)) return null;
    mkdirSync(DB_DIR, { recursive: true });
    const { default: Database } = await import('better-sqlite3');
    const instance = new Database(DB_PATH);
    instance.exec(SCHEMA_SQL);
    return instance;
  } catch {
    return null;
  }
}

export async function getDb() {
  if (db === undefined) db = await initDb();
  return db;
}

export { DB_PATH };

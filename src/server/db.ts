import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Agent } from '$lib/types/gateway';
import type { Host } from '$lib/types/host';

const DB_DIR = './data';
const DB_PATH = join(DB_DIR, 'minion_hub.db');

export interface SkillRow {
  skill_key: string;
  name: string;
  description?: string;
  emoji?: string;
  bundled?: boolean;
  disabled?: boolean;
  eligible?: boolean;
  [key: string]: unknown;
}

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

CREATE TABLE IF NOT EXISTS servers (
  id                 TEXT    PRIMARY KEY,
  name               TEXT    NOT NULL,
  url                TEXT    NOT NULL,
  token              TEXT    NOT NULL DEFAULT '',
  last_connected_at  INTEGER,
  created_at         INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
  updated_at         INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
);

CREATE TABLE IF NOT EXISTS agents (
  id           TEXT    NOT NULL,
  server_id    TEXT    NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  name         TEXT,
  emoji        TEXT,
  description  TEXT,
  model        TEXT,
  raw_json     TEXT    NOT NULL,
  last_seen_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
  PRIMARY KEY (id, server_id)
);

CREATE TABLE IF NOT EXISTS skills (
  skill_key    TEXT    NOT NULL,
  server_id    TEXT    NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  name         TEXT    NOT NULL,
  description  TEXT,
  emoji        TEXT,
  bundled      INTEGER NOT NULL DEFAULT 0,
  disabled     INTEGER NOT NULL DEFAULT 0,
  eligible     INTEGER NOT NULL DEFAULT 0,
  raw_json     TEXT    NOT NULL,
  last_seen_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
  PRIMARY KEY (skill_key, server_id)
);

CREATE TABLE IF NOT EXISTS settings (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  server_id  TEXT    NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  section    TEXT    NOT NULL,
  value      TEXT    NOT NULL,
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
  UNIQUE (server_id, section)
);
CREATE INDEX IF NOT EXISTS idx_settings_server ON settings (server_id);
`;

// Dynamic import to avoid build errors when better-sqlite3 isn't present
let db: import('better-sqlite3').Database | null = null;
let dbInitialized = false;

async function initDb() {
  try {
    mkdirSync(DB_DIR, { recursive: true });
    const { default: Database } = await import('better-sqlite3');
    const instance = new Database(DB_PATH);
    instance.pragma('journal_mode = WAL');
    instance.exec(SCHEMA_SQL);
    return instance;
  } catch {
    return null; // graceful no-op on Vercel where native module isn't available
  }
}

export async function getDb() {
  if (!dbInitialized) {
    db = await initDb();
    dbInitialized = true;
  }
  return db;
}

// ── Servers ──────────────────────────────────────────────────────────────────

export async function upsertServer(s: Host): Promise<void> {
  const instance = await getDb();
  if (!instance) return;
  instance
    .prepare(
      `INSERT INTO servers (id, name, url, token, last_connected_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         url = excluded.url,
         token = excluded.token,
         last_connected_at = excluded.last_connected_at,
         updated_at = excluded.updated_at`,
    )
    .run(s.id, s.name, s.url, s.token, s.lastConnectedAt ?? null, Date.now());
}

export async function listServers(): Promise<Host[]> {
  const instance = await getDb();
  if (!instance) return [];
  const rows = instance
    .prepare(`SELECT id, name, url, token, last_connected_at FROM servers ORDER BY created_at ASC`)
    .all() as Array<{
    id: string;
    name: string;
    url: string;
    token: string;
    last_connected_at: number | null;
  }>;
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    url: r.url,
    token: r.token,
    lastConnectedAt: r.last_connected_at,
  }));
}

export async function deleteServer(id: string): Promise<void> {
  const instance = await getDb();
  if (!instance) return;
  instance.prepare(`DELETE FROM servers WHERE id = ?`).run(id);
}

// ── Agents ───────────────────────────────────────────────────────────────────

export async function upsertAgents(serverId: string, agents: Agent[]): Promise<void> {
  const instance = await getDb();
  if (!instance) return;
  const stmt = instance.prepare(
    `INSERT INTO agents (id, server_id, name, emoji, description, model, raw_json, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id, server_id) DO UPDATE SET
       name = excluded.name,
       emoji = excluded.emoji,
       description = excluded.description,
       model = excluded.model,
       raw_json = excluded.raw_json,
       last_seen_at = excluded.last_seen_at`,
  );
  const now = Date.now();
  const upsertMany = instance.transaction((list: Agent[]) => {
    for (const a of list) {
      stmt.run(a.id, serverId, a.name ?? null, a.emoji ?? null, a.description ?? null, a.model ?? null, JSON.stringify(a), now);
    }
  });
  upsertMany(agents);
}

export async function listAgents(serverId: string): Promise<Agent[]> {
  const instance = await getDb();
  if (!instance) return [];
  const rows = instance
    .prepare(`SELECT raw_json FROM agents WHERE server_id = ? ORDER BY rowid ASC`)
    .all(serverId) as Array<{ raw_json: string }>;
  return rows.map((r) => JSON.parse(r.raw_json) as Agent);
}

// ── Skills ───────────────────────────────────────────────────────────────────

export async function upsertSkills(serverId: string, skills: SkillRow[]): Promise<void> {
  const instance = await getDb();
  if (!instance) return;
  const stmt = instance.prepare(
    `INSERT INTO skills (skill_key, server_id, name, description, emoji, bundled, disabled, eligible, raw_json, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(skill_key, server_id) DO UPDATE SET
       name = excluded.name,
       description = excluded.description,
       emoji = excluded.emoji,
       bundled = excluded.bundled,
       disabled = excluded.disabled,
       eligible = excluded.eligible,
       raw_json = excluded.raw_json,
       last_seen_at = excluded.last_seen_at`,
  );
  const now = Date.now();
  const upsertMany = instance.transaction((list: SkillRow[]) => {
    for (const s of list) {
      stmt.run(
        s.skill_key,
        serverId,
        s.name,
        s.description ?? null,
        s.emoji ?? null,
        s.bundled ? 1 : 0,
        s.disabled ? 1 : 0,
        s.eligible ? 1 : 0,
        JSON.stringify(s),
        now,
      );
    }
  });
  upsertMany(skills);
}

export async function listSkills(serverId: string): Promise<SkillRow[]> {
  const instance = await getDb();
  if (!instance) return [];
  const rows = instance
    .prepare(`SELECT raw_json FROM skills WHERE server_id = ? ORDER BY skill_key ASC`)
    .all(serverId) as Array<{ raw_json: string }>;
  return rows.map((r) => JSON.parse(r.raw_json) as SkillRow);
}

// ── Settings ─────────────────────────────────────────────────────────────────

export async function upsertSettings(serverId: string, section: string, value: unknown): Promise<void> {
  const instance = await getDb();
  if (!instance) return;
  instance
    .prepare(
      `INSERT INTO settings (server_id, section, value, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(server_id, section) DO UPDATE SET
         value = excluded.value,
         updated_at = excluded.updated_at`,
    )
    .run(serverId, section, JSON.stringify(value), Date.now());
}

export async function getSettings(serverId: string): Promise<Record<string, unknown>> {
  const instance = await getDb();
  if (!instance) return {};
  const rows = instance
    .prepare(`SELECT section, value FROM settings WHERE server_id = ?`)
    .all(serverId) as Array<{ section: string; value: string }>;
  return Object.fromEntries(rows.map((r) => [r.section, JSON.parse(r.value)]));
}

export async function getSettingsSection(serverId: string, section: string): Promise<unknown> {
  const instance = await getDb();
  if (!instance) return null;
  const row = instance
    .prepare(`SELECT value FROM settings WHERE server_id = ? AND section = ?`)
    .get(serverId, section) as { value: string } | undefined;
  return row ? JSON.parse(row.value) : null;
}

export { DB_PATH };

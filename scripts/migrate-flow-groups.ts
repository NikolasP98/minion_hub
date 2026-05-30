/**
 * One-off, idempotent schema migration for flow groups.
 *
 * The hub schema is hand-managed and the local .env points at PROD Turso, so we
 * NEVER use drizzle-kit push. This applies exactly two additive changes:
 *   1. CREATE TABLE IF NOT EXISTS flow_groups
 *   2. ALTER TABLE flows ADD COLUMN group_id (guarded — skipped if it exists)
 *
 * Run: bun run scripts/migrate-flow-groups.ts
 */
import { createClient } from '@libsql/client';

const url = process.env.TURSO_DB_URL;
const authToken = process.env.TURSO_DB_AUTH_TOKEN;
if (!url) throw new Error('TURSO_DB_URL not set');

const client = createClient({ url, authToken });

async function columnExists(table: string, column: string): Promise<boolean> {
  const res = await client.execute(`PRAGMA table_info(${table})`);
  return res.rows.some((r) => (r as Record<string, unknown>).name === column);
}

async function main() {
  await client.execute(`
    CREATE TABLE IF NOT EXISTS flow_groups (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      user_id TEXT,
      tenant_id TEXT,
      plugin_id TEXT,
      disabled INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);
  console.log('✓ flow_groups table ensured');

  await client.execute(
    `CREATE INDEX IF NOT EXISTS flow_groups_owner_idx ON flow_groups (user_id, tenant_id)`,
  );
  console.log('✓ flow_groups_owner_idx ensured');

  if (await columnExists('flows', 'group_id')) {
    console.log('✓ flows.group_id already exists — skipping');
  } else {
    await client.execute(`ALTER TABLE flows ADD COLUMN group_id TEXT`);
    console.log('✓ flows.group_id added');
  }
  console.log('migration complete');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });

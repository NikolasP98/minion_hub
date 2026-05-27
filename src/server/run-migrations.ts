import fs from 'fs';
import path from 'path';
import { createClient } from '@libsql/client';

const DRIZZLE_DIR = path.resolve('./drizzle');
const db = createClient({
  url: process.env.TURSO_DB_URL ?? 'file:./data/minion_hub.db',
  authToken: process.env.TURSO_DB_AUTH_TOKEN,
});

async function runMigrations() {
  console.log('Running migrations from', DRIZZLE_DIR);

  // Get all .sql migration files
  const files = fs.readdirSync(DRIZZLE_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const filePath = path.join(DRIZZLE_DIR, file);
    const sql = fs.readFileSync(filePath, 'utf-8');

    console.log(`Applying ${file}...`);
    try {
      // Split by semicolon to handle multiple statements
      const statements = sql.split(';').map(s => s.trim()).filter(s => s.length > 0);
      for (const stmt of statements) {
        await db.execute(stmt);
      }
      console.log(`  ✓ ${file}`);
    } catch (err: any) {
      // Ignore "already exists" errors for idempotency
      if (err.message?.includes('already exists') || err.message?.includes('duplicate')) {
        console.log(`  ⊘ ${file} (already applied)`);
      } else {
        console.error(`  ✗ ${file} failed:`, err.message);
        throw err;
      }
    }
  }

  console.log('Migrations complete');
}

runMigrations().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});

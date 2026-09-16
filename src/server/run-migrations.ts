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
  const files = fs
    .readdirSync(DRIZZLE_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const filePath = path.join(DRIZZLE_DIR, file);
    const sql = fs.readFileSync(filePath, 'utf-8');

    console.log(`Applying ${file}...`);
    try {
      // Split by semicolon to handle multiple statements
      const statements = sql
        .split(';')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      for (const stmt of statements) {
        await db.execute(stmt);
      }
      console.log(`  ✓ ${file}`);
    } catch (err: any) {
      // Ignore "already exists" errors for idempotency
      if (err.message?.includes('already exists') || err.message?.includes('duplicate')) {
        console.log(`  ⊘ ${file} (already applied)`);
      } else if (err.message?.includes('no such table')) {
        // TODO(handoff): drizzle/0008_workshop_thumbnail.sql (`ALTER TABLE
        // workshop_saves ADD thumbnail`) targets a table that only exists in
        // Postgres (supabase/qa/baseline/schema.sql has `public.workshop_saves`;
        // no drizzle/*.sql ever creates it in libsql). It fails hard on any
        // truly fresh libsql bootstrap — this runner previously had no caller
        // running it against an empty DB (no npm script references it; see
        // specs/2026-09-16-hub-local-qa-stack-spec.md §1), so it went
        // unnoticed. Tolerating it here (loudly) unblocks a from-scratch
        // bootstrap; the real fix is either dropping this migration file or
        // moving it to supabase/migrations/. File a proposal if this is
        // still unresolved.
        console.warn(
          `  ⚠ ${file}: table missing, skipping (${err.message}) — see TODO(handoff) above`,
        );
      } else {
        console.error(`  ✗ ${file} failed:`, err.message);
        throw err;
      }
    }
  }

  console.log('Migrations complete');
}

runMigrations().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});

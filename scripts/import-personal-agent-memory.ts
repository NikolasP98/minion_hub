#!/usr/bin/env bun
/** Run only after reviewing the org-labeled gateway export. Defaults to validation/dry-run. */
import { readFileSync, statSync } from 'node:fs';
import postgres from 'postgres';
import { importPersonalMemory } from '../src/server/services/canonical-memory-import';
const args = process.argv.slice(2),
  path = args[args.indexOf('--file') + 1];
if (!args.includes('--file') || !path)
  throw new Error(
    'Usage: bun scripts/import-personal-agent-memory.ts --file reviewed-export.json [--apply]',
  );
if (statSync(path).size > 32 * 1024 * 1024) throw new Error('Export exceeds 32 MiB');
const url = process.env.SUPABASE_DB_URL;
if (!url) throw new Error('SUPABASE_DB_URL required; no environment file is loaded');
const db = postgres(url, { max: 1, prepare: false, connection: { statement_timeout: 60000 } });
try {
  console.log(
    JSON.stringify(
      await importPersonalMemory(
        db,
        JSON.parse(readFileSync(path, 'utf8')),
        args.includes('--apply'),
      ),
      null,
      2,
    ),
  );
} finally {
  await db.end();
}

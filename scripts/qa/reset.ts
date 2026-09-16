#!/usr/bin/env bun
/**
 * `bun run qa:reset` — spec §5. Drops and recreates the `public` schema on
 * the running QA database, then re-runs the same bootstrap + seed pipeline
 * as qa:up, without touching containers. Use after checking out a branch
 * that adds migrations: `db-bootstrap.ts` restores the baseline again (its
 * `hub_migrations` presence check is now false) and applies every migration,
 * including the new one.
 *
 * Never-prod guard: only ever opens the QA stack's fixed loopback DB port.
 */
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import postgres from 'postgres';
import { validateQaDatabaseUrl } from './qa-database-guard';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const DEFAULT_DB_URL = 'postgresql://postgres:postgres@127.0.0.1:54422/postgres';

async function main(): Promise<void> {
  const url = validateQaDatabaseUrl(DEFAULT_DB_URL);
  const dbUrl = url.toString();

  console.log('qa:reset — dropping and recreating the public schema…');
  const sql = postgres(dbUrl, { prepare: false, max: 1, onnotice: () => {} });
  try {
    await sql.unsafe('drop schema public cascade');
    await sql.unsafe('create schema public');
  } finally {
    await sql.end({ timeout: 5 });
  }

  console.log('qa:reset — re-bootstrapping (baseline restore + migration runner)…');
  const bootstrap = spawnSync('bun', [join('scripts', 'qa', 'db-bootstrap.ts')], {
    cwd: ROOT,
    stdio: 'inherit',
  });
  if (bootstrap.status !== 0) throw new Error('db-bootstrap.ts failed — reset incomplete');

  const seedIndex = join(ROOT, 'scripts', 'qa', 'seed', 'index.ts');
  if (!existsSync(seedIndex)) {
    console.warn('qa:reset — scripts/qa/seed/index.ts not found yet — skipping seed');
    return;
  }
  console.log('qa:reset — re-seeding…');
  const seed = spawnSync('bun', [seedIndex], { cwd: ROOT, stdio: 'inherit' });
  if (seed.status !== 0) throw new Error('seed run failed — reset incomplete');

  console.log('qa:reset — done');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    console.error(`qa:reset FAILED — ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  });
}

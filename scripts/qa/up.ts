#!/usr/bin/env bun
/**
 * `bun run qa:up [--ttl 2h] [--no-seed] [--fresh]` — spec §5.
 *
 * 1. Never-prod guard on any SUPABASE_DB_URL/PUBLIC_SUPABASE_URL in the shell.
 * 2. `supabase start` if the QA project isn't already running (`--fresh` stops
 *    + drops its volumes first).
 * 3. `bun scripts/qa/db-bootstrap.ts --json` — fails closed on non-zero pending.
 * 4. `bun scripts/qa/seed/index.ts` unless `--no-seed` — reported, not fatal,
 *    if the seed script is missing or fails (S3 may still be landing it).
 * 5. `bun scripts/qa/env.ts` writes `.env.qa` for the app container.
 * 6. `docker compose -f docker-compose.qa.yml up -d --wait`.
 * 7. Arms the TTL and prints the URL, TTL, teardown time and personas.
 *
 * Steps 1-5 are shared with `dev:local` (dev.ts) via backend.ts — keep both
 * entrypoints' printed output in sync when editing either.
 */
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { armTtl, formatDuration, parseTtl } from './ttl';
import {
  ignoreInheritedBackendEnv,
  bootstrapDatabase,
  ensureSupabaseStack,
  printPersonas,
  run,
  seedDatabase,
  writeEnvQa,
} from './backend';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const COMPOSE_FILE = join(ROOT, 'docker-compose.qa.yml');
const APP_URL = 'http://127.0.0.1:5199';
const TAG = 'qa:up';

const argv = process.argv.slice(2);
const noSeed = argv.includes('--no-seed');
const fresh = argv.includes('--fresh');
const ttlArgIdx = argv.indexOf('--ttl');
const ttlSeconds = parseTtl(ttlArgIdx === -1 ? undefined : argv[ttlArgIdx + 1]);

async function main(): Promise<void> {
  ignoreInheritedBackendEnv(TAG);

  ensureSupabaseStack(ROOT, COMPOSE_FILE, { tag: TAG, fresh });
  bootstrapDatabase(ROOT, TAG);
  seedDatabase(ROOT, TAG, noSeed);
  writeEnvQa(ROOT, TAG);

  run(ROOT, `${TAG} — starting the app container (docker compose up -d --wait)`, 'docker', [
    'compose',
    '-f',
    COMPOSE_FILE,
    'up',
    '-d',
    '--wait',
  ]);

  const { deadline } = armTtl(ttlSeconds);

  console.log('\n=== hub QA stack is up ===');
  console.log(`  URL:      ${APP_URL}`);
  console.log(`  TTL:      ${formatDuration(ttlSeconds)}`);
  console.log(`  Teardown: ${deadline.toLocaleString()} (${deadline.toISOString()})`);
  printPersonas(ROOT);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    console.error(`qa:up FAILED — ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  });
}

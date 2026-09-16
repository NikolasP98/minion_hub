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
 */
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { armTtl, formatDuration, parseTtl } from './ttl';
import { parseEnvFile } from './snapshot-env';
import { spawnSupabaseCli } from './supabase-cli';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const COMPOSE_FILE = join(ROOT, 'docker-compose.qa.yml');
const APP_URL = 'http://127.0.0.1:5199';

const argv = process.argv.slice(2);
const noSeed = argv.includes('--no-seed');
const fresh = argv.includes('--fresh');
const ttlArgIdx = argv.indexOf('--ttl');
const ttlSeconds = parseTtl(ttlArgIdx === -1 ? undefined : argv[ttlArgIdx + 1]);

function run(
  label: string,
  cmd: string,
  args: string[],
  opts: { env?: NodeJS.ProcessEnv } = {},
): void {
  console.log(`\nqa:up — ${label}`);
  const result = spawnSync(cmd, args, {
    cwd: ROOT,
    stdio: 'inherit',
    env: opts.env ?? process.env,
  });
  if (result.status !== 0) {
    throw new Error(`${label} failed (exit ${result.status})`);
  }
}

/** Refuses to proceed if the shell already points a Supabase var at a non-loopback host. */
function assertLoopbackIfSet(varName: string): void {
  const raw = process.env[varName];
  if (!raw) return;
  let hostname: string;
  try {
    hostname = new URL(raw).hostname;
  } catch {
    throw new Error(`qa:up refuses to start — $${varName} is set to an unparseable URL: "${raw}"`);
  }
  const LOOPBACK = new Set(['127.0.0.1', '::1', '[::1]', 'localhost']);
  if (!LOOPBACK.has(hostname)) {
    throw new Error(
      `qa:up refuses to start — $${varName}="${raw}" points at a non-loopback host. ` +
        'The QA stack must never reuse credentials with a real database. Unset it and retry.',
    );
  }
}

function supabaseRunning(): boolean {
  const result = spawnSupabaseCli(['status'], ROOT, { stdio: 'ignore' });
  return result.status === 0;
}

function printPersonas(): void {
  const path = join(ROOT, '.env.qa.local');
  if (!existsSync(path)) {
    console.log(
      '\n(no .env.qa.local yet — seed has not run; personas unavailable, pass --no-seed to skip this step deliberately)',
    );
    return;
  }
  const vars = parseEnvFile(readFileSync(path, 'utf8'));
  const personas = Object.keys(vars).filter(
    (k) => k.endsWith('_EMAIL') && (k.startsWith('QA_') || k.startsWith('E2E_')),
  );
  console.log('\nPersonas (.env.qa.local):');
  for (const emailKey of personas) {
    const base = emailKey.slice(0, -'_EMAIL'.length);
    console.log(
      `  ${base}: ${vars[emailKey]} / ${vars[`${base}_PASSWORD`] ?? '(see .env.qa.local)'}`,
    );
  }
}

async function main(): Promise<void> {
  assertLoopbackIfSet('SUPABASE_DB_URL');
  assertLoopbackIfSet('PUBLIC_SUPABASE_URL');

  if (fresh) {
    console.log('qa:up — --fresh: stopping the stack and dropping volumes first');
    spawnSync('docker', ['compose', '-f', COMPOSE_FILE, 'down', '-v'], {
      cwd: ROOT,
      stdio: 'inherit',
    });
    spawnSupabaseCli(['stop', '--no-backup'], ROOT, { stdio: 'inherit' });
  }

  if (!supabaseRunning()) {
    console.log('\nqa:up — starting the local Supabase stack (supabase start)');
    const start = spawnSupabaseCli(['start'], ROOT, { stdio: 'inherit' });
    if (start.status !== 0) throw new Error(`supabase start failed (exit ${start.status})`);
  } else {
    console.log('qa:up — Supabase stack already running, reusing it');
  }

  run('bootstrapping the database (roles, baseline, migration runner)', 'bun', [
    join('scripts', 'qa', 'db-bootstrap.ts'),
  ]);

  const seedIndex = join(ROOT, 'scripts', 'qa', 'seed', 'index.ts');
  if (noSeed) {
    console.log('qa:up — --no-seed: skipping scripts/qa/seed/index.ts');
  } else if (!existsSync(seedIndex)) {
    console.warn(
      'qa:up — scripts/qa/seed/index.ts not found yet — skipping seed (non-fatal, pass --no-seed to silence this)',
    );
  } else {
    const seed = spawnSync('bun', [seedIndex], { cwd: ROOT, stdio: 'inherit' });
    if (seed.status !== 0) {
      console.warn(
        'qa:up — seed run failed (non-fatal) — the stack is up but may be missing fixtures',
      );
    }
  }

  run('writing .env.qa', 'bun', [join('scripts', 'qa', 'env.ts')]);

  run('starting the app container (docker compose up -d --wait)', 'docker', [
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
  printPersonas();
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    console.error(`qa:up FAILED — ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  });
}

/**
 * Shared steps for bringing up the QA backend (Supabase + bootstrap + seed +
 * `.env.qa`), used by both `qa:up` (up.ts, which also starts the app
 * container) and `dev:local` (dev.ts, which runs the app on the host
 * instead). Extracted from up.ts so the two entrypoints can't drift.
 */
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { parseEnvFile } from './snapshot-env';
import { spawnSupabaseCli } from './supabase-cli';

/** Runs `cmd` with output streamed to the terminal; throws on non-zero exit. */
export const LOCAL_DB_URL = 'postgresql://postgres:postgres@127.0.0.1:54422/postgres';

export function run(root: string, label: string, cmd: string, args: string[]): void {
  console.log(`\n${label}`);
  const result = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', env: process.env });
  if (result.status !== 0) {
    throw new Error(`${label} failed (exit ${result.status})`);
  }
}

/** Refuses to proceed if the shell already points a Supabase var at a non-loopback host. */
/** Host-only rendering of a URL so a guard message never echoes credentials. */
export function redactUrl(raw: string): string {
  try {
    const u = new URL(raw);
    return `${u.protocol}//${u.username ? '***@' : ''}${u.host}${u.pathname}`;
  } catch {
    return '<unparseable url>';
  }
}

export function assertLoopbackIfSet(tag: string, varName: string): void {
  const raw = process.env[varName];
  if (!raw) return;
  let hostname: string;
  try {
    hostname = new URL(raw).hostname;
  } catch {
    throw new Error(`${tag} refuses to start — $${varName} is set to an unparseable URL`);
  }
  if (!isLoopbackHostname(hostname)) {
    throw new Error(
      `${tag} refuses to start — $${varName}=${redactUrl(raw)} points at a non-loopback host. ` +
        'The QA stack must never reuse credentials with a real database. Unset it and retry.',
    );
  }
}

/** Every backend variable `.env.qa` owns. Bun auto-loads the checkout's
 *  `.env`/`.env.local` into this very process, so on a machine also set up
 *  for `--prd` these arrive pointing at PRODUCTION before any script code
 *  runs. The QA pipeline never uses them: it always talks to the local stack. */
export const BACKEND_ENV_KEYS = [
  'SUPABASE_DB_URL',
  'PUBLIC_SUPABASE_URL',
  'PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'TURSO_DB_URL',
  'TURSO_DB_AUTH_TOKEN',
] as const;

/** Drops inherited backend variables from `env` (default: this process) so
 *  every child step — bootstrap, seed, env.ts, the dev server — resolves the
 *  local stack. Returns the names that were dropped; logs hosts only. */
export function ignoreInheritedBackendEnv(
  tag: string,
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const dropped: string[] = [];
  for (const key of BACKEND_ENV_KEYS) {
    const raw = env[key];
    if (raw === undefined) continue;
    const where = key.endsWith('_URL') ? ` (${redactUrl(raw)})` : '';
    console.log(
      `${tag} — ignoring inherited $${key}${where}: the QA pipeline only uses the local stack`,
    );
    delete env[key];
    dropped.push(key);
  }
  return dropped;
}

const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', '::1', '[::1]', 'localhost']);

/** Pure: true iff `hostname` (as returned by `new URL(...).hostname`) is loopback. */
export function isLoopbackHostname(hostname: string): boolean {
  return LOOPBACK_HOSTNAMES.has(hostname);
}

export function supabaseRunning(root: string): boolean {
  const result = spawnSupabaseCli(['status'], root, { stdio: 'ignore' });
  return result.status === 0;
}

/** `--fresh` wipe (if requested) then `supabase start` unless already running. */
export function ensureSupabaseStack(
  root: string,
  composeFile: string,
  opts: { tag: string; fresh: boolean },
): void {
  if (opts.fresh) {
    console.log(`${opts.tag} — --fresh: stopping the stack and dropping volumes first`);
    spawnSync('docker', ['compose', '-f', composeFile, 'down', '-v'], {
      cwd: root,
      stdio: 'inherit',
    });
    spawnSupabaseCli(['stop', '--no-backup'], root, { stdio: 'inherit' });
  }

  if (!supabaseRunning(root)) {
    console.log(`\n${opts.tag} — starting the local Supabase stack (supabase start)`);
    const start = spawnSupabaseCli(['start'], root, { stdio: 'inherit' });
    if (start.status !== 0) throw new Error(`supabase start failed (exit ${start.status})`);
  } else {
    console.log(`${opts.tag} — Supabase stack already running, reusing it`);
  }
}

export function bootstrapDatabase(root: string, tag: string): void {
  run(root, `${tag} — bootstrapping the database (roles, baseline, migration runner)`, 'bun', [
    join('scripts', 'qa', 'db-bootstrap.ts'),
  ]);
}

/** Reported, not fatal, if the seed script is missing or fails. */
export function seedDatabase(root: string, tag: string, noSeed: boolean): void {
  const seedIndex = join(root, 'scripts', 'qa', 'seed', 'index.ts');
  if (noSeed) {
    console.log(`${tag} — --no-seed: skipping scripts/qa/seed/index.ts`);
    return;
  }
  if (!existsSync(seedIndex)) {
    console.warn(
      `${tag} — scripts/qa/seed/index.ts not found yet — skipping seed (non-fatal, pass --no-seed to silence this)`,
    );
    return;
  }
  // The seed reads SUPABASE_DB_URL and refuses anything off loopback; it runs
  // BEFORE .env.qa exists, so on a fresh shell nothing sets it — default to the
  // local stack (same URL db-bootstrap.ts defaults to) instead of failing.
  const seed = spawnSync('bun', [seedIndex], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, SUPABASE_DB_URL: process.env.SUPABASE_DB_URL ?? LOCAL_DB_URL },
  });
  if (seed.status !== 0) {
    console.warn(
      `${tag} — seed run failed (non-fatal) — the stack is up but may be missing fixtures`,
    );
  }
}

export function writeEnvQa(root: string, tag: string): void {
  run(root, `${tag} — writing .env.qa`, 'bun', [join('scripts', 'qa', 'env.ts')]);
}

export function printPersonas(root: string): void {
  const path = join(root, '.env.qa.local');
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

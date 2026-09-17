#!/usr/bin/env bun
/**
 * `bun run dev:local [--ttl 2h] [--no-seed] [--fresh]` — spec §2.4.
 *
 * Runs the Hub dev server on the HOST against the containerized, seeded QA
 * backend (Supabase in Docker) instead of `qa:up`'s fully-containerized app.
 * Gives hot reload while still exercising the real GoTrue/Postgres backend.
 *
 * 1-4. Same as `qa:up` (backend.ts): loopback guard, `supabase start` if not
 *    running, db-bootstrap, seed, write `.env.qa`.
 * 5. If the `qa:up` app container is holding :5199, stop it (Supabase stays up
 *    — it may be shared with another checkout).
 * 6. Arm the TTL exactly like `qa:up` (Supabase teardown only).
 * 7. Print a banner, then run `vite dev` on the host in the foreground with
 *    `.env.qa`'s values forced into the child's environment so a developer's
 *    `.env.local` (which Vite/SvelteKit still load) can never win — see
 *    isolation proof below. Ctrl-C stops only this dev server: the Supabase
 *    containers and the TTL timer are separate processes untouched by it.
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { armTtl, formatDuration, parseTtl } from './ttl';
import { parseEnvFile } from './snapshot-env';
import {
  bootstrapDatabase,
  ensureSupabaseStack,
  migrateLibsql,
  ignoreInheritedBackendEnv,
  isLoopbackHostname,
  redactUrl,
  seedDatabase,
  writeEnvQa,
} from './backend';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const COMPOSE_FILE = join(ROOT, 'docker-compose.qa.yml');
const ENV_QA_PATH = join(ROOT, '.env.qa');
const APP_URL = 'http://127.0.0.1:5199';
const TAG = 'qa:dev';
const SEED_PASSWORD_ENV_VAR = 'QA_SEED_PASSWORD';

const argv = process.argv.slice(2);
const noSeed = argv.includes('--no-seed');
const fresh = argv.includes('--fresh');
const ttlArgIdx = argv.indexOf('--ttl');
const ttlSeconds = parseTtl(ttlArgIdx === -1 ? undefined : argv[ttlArgIdx + 1]);

/** Stops the compose-managed `hub` app container only if it's actually running (holding :5199). Leaves Supabase untouched. */
export function stopAppContainerIfRunning(root: string, composeFile: string): void {
  const ps = spawnSync('docker', ['compose', '-f', composeFile, 'ps', '-q', 'hub'], {
    cwd: root,
    encoding: 'utf8',
  });
  const containerId = ps.stdout?.trim();
  if (!containerId) {
    console.log(`${TAG} — no running compose app container found holding :5199`);
    return;
  }
  console.log(
    `${TAG} — stopping the compose app container (${containerId.slice(0, 12)}) so the host dev server can bind :5199`,
  );
  const stop = spawnSync('docker', ['compose', '-f', composeFile, 'stop', 'hub'], {
    cwd: root,
    stdio: 'inherit',
  });
  if (stop.status !== 0) {
    throw new Error(`${TAG} — failed to stop the compose app container (exit ${stop.status})`);
  }
}

/** Pure: `.env.qa`'s values placed last so they always win over an inherited env. */
export function mergeQaEnvOverride(
  base: NodeJS.ProcessEnv,
  qaVars: Record<string, string>,
): NodeJS.ProcessEnv {
  return { ...base, ...qaVars };
}

/**
 * Pure: the isolation proof (spec §2.4/§6). Resolves `varName` from the
 * merged env and throws unless its host is loopback — this is what stops a
 * developer's `.env.local` production values (Vite loads `.env.local`
 * unconditionally, regardless of --mode) from ever reaching the DEV backend,
 * because these are the values actually handed to the child process, and
 * both Bun's own dotenv loading and SvelteKit's `loadEnv()` give an
 * already-set process.env entry priority over anything parsed from a file.
 */
export function assertResolvedLoopback(varName: string, env: NodeJS.ProcessEnv): string {
  const raw = env[varName];
  if (!raw) {
    throw new Error(
      `${TAG} refuses to start — $${varName} is missing from the resolved env (was .env.qa written?)`,
    );
  }
  let hostname: string;
  try {
    hostname = new URL(raw).hostname;
  } catch {
    throw new Error(`${TAG} refuses to start — $${varName} is set to an unparseable URL`);
  }
  if (!isLoopbackHostname(hostname)) {
    throw new Error(
      `${TAG} refuses to start — resolved $${varName}=${redactUrl(raw)} is NOT loopback ("${hostname}"). ` +
        "A developer's .env.local must never leak into the DEV backend. Refusing to start.",
    );
  }
  return hostname;
}

async function main(): Promise<void> {
  // A developer's .env/.env.local (production for `--prd`) is auto-loaded by
  // Bun into THIS process; drop it so no step below can see it (spec §2.4).
  ignoreInheritedBackendEnv(TAG);

  ensureSupabaseStack(ROOT, COMPOSE_FILE, { tag: TAG, fresh });
  bootstrapDatabase(ROOT, TAG);
  writeEnvQa(ROOT, TAG); // before the seed: it needs the stack's URL + keys
  migrateLibsql(ROOT, TAG);
  seedDatabase(ROOT, TAG, noSeed);

  stopAppContainerIfRunning(ROOT, COMPOSE_FILE);

  const { deadline } = armTtl(ttlSeconds);

  if (!existsSync(ENV_QA_PATH)) {
    throw new Error(
      `${TAG} refuses to start — ${ENV_QA_PATH} does not exist (env.ts step above should have written it)`,
    );
  }
  const qaVars = parseEnvFile(readFileSync(ENV_QA_PATH, 'utf8'));
  mkdirSync(join(ROOT, 'data', 'qa'), { recursive: true }); // libsql file lives here
  const childEnv = mergeQaEnvOverride(process.env, qaVars);

  const apiHost = assertResolvedLoopback('PUBLIC_SUPABASE_URL', childEnv);
  const dbHost = assertResolvedLoopback('SUPABASE_DB_URL', childEnv);

  console.log('\n=== hub dev:local — DEV backend (host Vite + containerized seeded Supabase) ===');
  console.log(`  URL:              ${APP_URL}`);
  console.log(`  Backend:          DEV (containerized, seeded)`);
  console.log(`  Supabase API:     ${childEnv.PUBLIC_SUPABASE_URL} (loopback host: ${apiHost})`);
  console.log(`  Supabase DB:      loopback host: ${dbHost}`);
  console.log(
    `  Personas:         .env.qa.local (seed password env var: ${SEED_PASSWORD_ENV_VAR})`,
  );
  console.log(`  TTL:              ${formatDuration(ttlSeconds)}`);
  console.log(`  Teardown:         ${deadline.toLocaleString()} (${deadline.toISOString()})`);
  console.log('  Ctrl-C stops only this dev server; Supabase keeps running until the TTL fires.\n');

  const child = spawn(
    'bun',
    ['run', 'dev', '--', '--port', '5199', '--strictPort', '--host', '127.0.0.1'],
    {
      cwd: ROOT,
      stdio: 'inherit',
      env: childEnv,
      // Own process group so Ctrl-C / SIGTERM reach `bun run dev` AND the vite
      // process it spawns — otherwise vite outlives us and keeps :5199 bound.
      detached: true,
    },
  );
  const forward = (sig: NodeJS.Signals) => () => {
    if (child.pid) {
      try {
        process.kill(-child.pid, sig);
      } catch {
        child.kill(sig);
      }
    }
  };
  process.on('SIGINT', forward('SIGINT'));
  process.on('SIGTERM', forward('SIGTERM'));

  await new Promise<void>((resolve, reject) => {
    child.on('exit', (code) => {
      process.exitCode = code ?? 0;
      resolve();
    });
    child.on('error', reject);
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    console.error(`${TAG} FAILED — ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  });
}

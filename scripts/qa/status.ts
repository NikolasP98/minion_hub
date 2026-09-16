#!/usr/bin/env bun
/**
 * `bun run qa:status` — spec §5. Prints container state, DB pending-migration
 * count, TTL remaining and a live app-health probe. Read-only.
 */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { formatDuration, remainingTtl } from './ttl';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const COMPOSE_FILE = join(ROOT, 'docker-compose.qa.yml');
const DB_URL = 'postgresql://postgres:postgres@127.0.0.1:54422/postgres';
const APP_URL = 'http://127.0.0.1:5199/en/login';

function section(title: string): void {
  console.log(`\n-- ${title} --`);
}

async function main(): Promise<void> {
  section('Containers');
  const ps = spawnSync('docker', ['compose', '-f', COMPOSE_FILE, 'ps'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  console.log(ps.stdout?.trim() || '(docker compose ps returned nothing — is the stack up?)');

  section('Migrations (scripts/db-status.ts)');
  const dbStatus = spawnSync('bun', [join('scripts', 'db-status.ts')], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, SUPABASE_DB_URL: DB_URL },
  });
  if (dbStatus.status === 0) {
    const pendingLine = dbStatus.stdout.trim().split('\n').at(-1);
    console.log(pendingLine ?? dbStatus.stdout);
  } else {
    console.log(`(could not reach the QA database: ${dbStatus.stderr?.trim() || 'unknown error'})`);
  }

  section('TTL');
  const ttl = remainingTtl();
  if (!ttl.armed) {
    console.log('not armed (qa:up or qa:extend to start the teardown timer)');
  } else {
    console.log(`${formatDuration(ttl.seconds ?? 0)} remaining (${ttl.mode} timer)`);
  }

  section('App health');
  try {
    const res = await fetch(APP_URL, { signal: AbortSignal.timeout(3000) });
    console.log(`${APP_URL} -> ${res.status}`);
  } catch (err) {
    console.log(`${APP_URL} -> unreachable (${err instanceof Error ? err.message : String(err)})`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main();
}

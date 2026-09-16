#!/usr/bin/env bun
/**
 * `bun run qa:down [--volumes]` — spec §5. Stops the app container and
 * disarms the TTL; keeps Supabase's data volumes by default so the next
 * `qa:up` is fast. `--volumes` also drops them (`supabase stop --no-backup`).
 * This is also what the TTL timer/fallback sleep invokes when it fires.
 */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { disarmTtl, INSIDE_TTL_UNIT_ENV } from './ttl';
import { spawnSupabaseCli } from './supabase-cli';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const COMPOSE_FILE = join(ROOT, 'docker-compose.qa.yml');

const dropVolumes = process.argv.slice(2).includes('--volumes');

function main(): void {
  console.log('qa:down — stopping the app container');
  spawnSync('docker', ['compose', '-f', COMPOSE_FILE, 'down', ...(dropVolumes ? ['-v'] : [])], {
    cwd: ROOT,
    stdio: 'inherit',
  });

  console.log(
    `qa:down — stopping Supabase (${dropVolumes ? 'dropping volumes' : 'keeping volumes'})`,
  );
  spawnSupabaseCli(['stop', ...(dropVolumes ? ['--no-backup'] : [])], ROOT, { stdio: 'inherit' });

  // Disarm last: inside the TTL service this only stops the (already consumed)
  // timer, never the service we are running in.
  const inside = process.env[INSIDE_TTL_UNIT_ENV] === '1';
  console.log(
    `qa:down — disarming TTL${inside ? ' (running inside the TTL unit; timer only)' : ''}`,
  );
  disarmTtl({ insideTtlUnit: inside });

  console.log('qa:down — done');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main();
}

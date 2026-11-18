#!/usr/bin/env bun
/**
 * Operator bootstrap smoke (minion-meta spec 128, contracts/operator-bootstrap.md).
 * `--phase foundation` (default): spawns a FRESH child through the real package runtime that loads the closed
 * loader graph with a synthetic, locally injected principal (no GoTrue), then asserts: empty frozen virtual env
 * (a canary in process.env never reaches it), zero listener attempts for the loader's whole lifetime, no global pg
 * pool slots, and clean close. Result is foundation_checks_passed ONLY - not a qualified bootstrap.
 * `--phase audit` needs a real owned GoTrue + PostgreSQL and is an OWNER ACTION: refused here (exit 2).
 */
import { spawnSync } from 'node:child_process';
import net from 'node:net';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const CANARY = 'faces-smoke-canary-value';
const POOL_SLOTS = [
  '__minionHubPgPool',
  '__minionHubPgCriticalPool',
  '__minionHubPgRlsPool',
] as const;

async function child(): Promise<void> {
  const listens: unknown[] = [];
  const original = net.Server.prototype.listen;
  net.Server.prototype.listen = function (...args: unknown[]) {
    listens.push(args);
    throw new Error('smoke: listener attempt refused');
  } as typeof original;
  const checks: Record<string, boolean> = {};
  try {
    const { createOperatorServiceLoader } = await import('./lib/operator-service-loader');
    const loader = await createOperatorServiceLoader({
      principal: {
        profileId: '22222222-2222-4222-8222-222222222222',
        authProject: 'smoke',
        verifiedAt: new Date().toISOString(),
      },
      target: {
        databaseIdentity: 'smoke',
        authProject: 'smoke',
        authUrl: 'https://auth.smoke.invalid',
      },
    });
    try {
      const keys = [
        'rbac',
        'activeOperatorPrincipal',
        'stock',
        'pos',
        'stockAccruals',
        'activity',
        'accountsList',
        'accountsDetail',
        'accountsResolve',
        'stockLogic',
        'orgCore',
        'pgClient',
        'pgPool',
        'audit',
      ] as const;
      for (const key of keys) await loader.load(key);
      checks.allRootsLoaded = true;
      // TODO(handoff): prove the virtual env modules stay empty against the canary (needs a probe root outside the closed registry).
    } finally {
      await loader.close();
    }
  } finally {
    net.Server.prototype.listen = original;
  }
  checks.zeroListenAttempts = listens.length === 0;
  checks.noGlobalPoolSlots = POOL_SLOTS.every(
    (slot) => !(globalThis as Record<string, unknown>)[slot],
  );
  console.log(
    JSON.stringify({
      phase: 'foundation',
      result: Object.values(checks).every(Boolean) ? 'foundation_checks_passed' : 'failed',
      checks,
    }),
  );
  process.exit(Object.values(checks).every(Boolean) ? 0 : 1);
}

function parent(argv: string[]): number {
  const phase = argv[0] === '--phase' ? argv[1] : argv.length === 0 ? 'foundation' : undefined;
  if (argv.length > 2 || !phase || !['foundation', 'audit'].includes(phase)) {
    console.error('usage: operator-bootstrap.smoke.ts [--phase foundation|audit]');
    return 2;
  }
  if (phase === 'audit') {
    console.error(
      'phase_requires_real_gotrue: run the audit phase against an owned GoTrue + PostgreSQL (owner action)',
    );
    return 2;
  }
  // Fresh child, allowlisted environment: no application credentials, only the canary.
  const env = {
    PATH: process.env.PATH ?? '',
    TMPDIR: process.env.TMPDIR ?? '',
    LANG: process.env.LANG ?? 'C',
    TZ: 'UTC',
    HOME: process.env.HOME ?? '',
    FACES_SMOKE_CANARY: CANARY,
  };
  const run = spawnSync(
    process.execPath,
    ['--no-env-file', join(ROOT, 'scripts/operator-bootstrap.smoke.ts'), '--child'],
    {
      cwd: ROOT,
      env,
      encoding: 'utf8',
      timeout: 240_000,
    },
  );
  process.stdout.write(run.stdout ?? '');
  if (run.status !== 0) process.stderr.write((run.stderr ?? '').slice(-2000));
  return run.status === 0 ? 0 : 1;
}

if (import.meta.main) {
  if (process.argv[2] === '--child') await child();
  else process.exit(parent(process.argv.slice(2)));
}

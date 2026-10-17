#!/usr/bin/env bun
/**
 * `bun run audit:ui:sweep [--full] [--routes a,b] [--update-ledger] [--ci] [--dry-run]`
 *
 * The one mechanical page sweep (spec 014). Every step prints its outcome:
 *   1. stack reachable on loopback (`supabase status -o env`; skipped when
 *      E2E_BASE_URL is given, but PUBLIC_SUPABASE_URL must still be loopback)
 *   2. `.env.qa` from the running stack (scripts/qa/env.ts → buildEnvQa)
 *   3. audit personas + dynamic fixtures (scripts/ui-audit-seed.ts, loopback only)
 *   4. serve: E2E_BASE_URL, else `vite dev` on 5187 with `.env.qa` forced into the child
 *   5. the matrix: owner-admin × {compact-390 coarse, wide-1440 fine}; `--full` = all
 *      personas × all viewports × both pointers; one route-audit run per entry
 *   6. `ui-audit-conformance.mjs --compare --summary` (+ `--ci`, `--update-ledger`)
 *
 * `--ci`: default matrix, improvements do not fail, never starts a server
 * (E2E_BASE_URL required), never seeds a non-loopback host. `--dry-run` prints
 * the plan and exits without touching the stack, the browser or the ledger.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, openSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { AUDIT_VIEWPORTS, type AuditViewportId } from '../tests/e2e/ui-audit/viewports';
import { writeEnvQa } from './qa/backend';
import { assertResolvedLoopback, mergeQaEnvOverride } from './qa/dev';
import { parseSupabaseStatusEnv } from './qa/env';
import { parseEnvFile } from './qa/snapshot-env';
import { spawnSupabaseCli } from './qa/supabase-cli';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const TAG = 'audit:ui:sweep';
const SWEEP_PORT = 5187;
const SPEC = 'tests/e2e/ui-audit/route-audit.spec.ts';
const OUTPUT_DIR = join(ROOT, 'test-results', 'ui-audit');

export interface SweepOptions {
  full: boolean;
  routes: string[];
  updateLedger: boolean;
  ci: boolean;
  dryRun: boolean;
}

export interface MatrixEntry {
  /** E2E_UI_AUDIT_PERSONAS value: one id or `all`. */
  personas: string;
  viewport: AuditViewportId;
  pointer: 'coarse' | 'fine';
}

export const DEFAULT_MATRIX: readonly MatrixEntry[] = [
  { personas: 'owner-admin', viewport: 'compact-390', pointer: 'coarse' },
  { personas: 'owner-admin', viewport: 'wide-1440', pointer: 'fine' },
];

/** Pure. */
export function parseSweepArgs(argv: readonly string[]): SweepOptions {
  const routesIdx = argv.indexOf('--routes');
  const routes =
    routesIdx === -1
      ? []
      : (argv[routesIdx + 1] ?? '')
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean);
  return {
    full: argv.includes('--full'),
    routes,
    updateLedger: argv.includes('--update-ledger'),
    ci: argv.includes('--ci'),
    dryRun: argv.includes('--dry-run'),
  };
}

/** Pure: `--full` widens to every persona, viewport and pointer; `--ci` always uses the default. */
export function expandMatrix(options: Pick<SweepOptions, 'full' | 'ci'>): MatrixEntry[] {
  if (!options.full || options.ci) return [...DEFAULT_MATRIX];
  return (Object.keys(AUDIT_VIEWPORTS) as AuditViewportId[]).flatMap((viewport) =>
    (['coarse', 'fine'] as const).map((pointer) => ({ personas: 'all', viewport, pointer })),
  );
}

export function runId(entry: MatrixEntry): string {
  return `sweep--${entry.viewport}--${entry.pointer}`;
}

export function artifactPath(entry: MatrixEntry): string {
  return join(OUTPUT_DIR, `run-${runId(entry)}.json`);
}

/** Ratchet rows are measured in the default populated state (spec 014 edge cases). */
export const RATCHET_STATES = 'populated,default';

/**
 * Playwright wipes its `outputDir` (`test-results/`) at the start of every invocation, which
 * would delete the previous viewport's run artifact; each run gets its own output directory.
 */
export function playwrightArgs(entry: MatrixEntry): string[] {
  return [
    'playwright',
    'test',
    SPEC,
    '--output',
    join('test-results', `playwright-${runId(entry)}`),
  ];
}

/** Pure: the child env for one route-audit invocation; fixtures and sweep flags win over the base. */
export function assembleRunEnv(
  base: NodeJS.ProcessEnv,
  entry: MatrixEntry,
  context: {
    baseUrl: string;
    routes: readonly string[];
    fixtures: Record<string, string>;
    /** Ratchet matrix = default populated states only; `--full` leaves it unset (every declared state). */
    states?: string;
  },
): NodeJS.ProcessEnv {
  return {
    ...base,
    ...context.fixtures,
    ...(context.states ? { E2E_UI_AUDIT_STATES: context.states } : {}),
    E2E_UI_AUDIT: '1',
    E2E_UI_AUDIT_CONFORMANCE: '1',
    // Blocked rows are the ledger's business (verdict `blocked`), not a reason to stop the matrix.
    E2E_UI_AUDIT_ALLOW_BLOCKED: '1',
    E2E_UI_AUDIT_VIEWPORT: entry.viewport,
    E2E_UI_AUDIT_POINTER: entry.pointer,
    E2E_UI_AUDIT_PERSONAS: entry.personas,
    E2E_UI_AUDIT_ROUTES: context.routes.join(','),
    E2E_UI_AUDIT_RUN_ID: runId(entry),
    E2E_BASE_URL: context.baseUrl,
  };
}

/** The seed and the dev server only ever see a loopback Supabase (FR-013). */
export function requireLoopbackSupabase(env: NodeJS.ProcessEnv): string {
  return assertResolvedLoopback('PUBLIC_SUPABASE_URL', env);
}

export function compareArgs(options: SweepOptions, artifacts: readonly string[]): string[] {
  return [
    'scripts/ui-audit-conformance.mjs',
    '--compare',
    '--summary',
    ...(options.ci ? ['--ci'] : []),
    ...(options.updateLedger ? ['--update-ledger'] : []),
    ...artifacts,
  ];
}

class Blocked extends Error {}

function step(n: number, label: string, outcome: string): void {
  console.log(`${TAG} [${n}/6] ${label} — ${outcome}`);
}

async function waitFor(url: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url)).status === 200) return true;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  return false;
}

function printPlan(options: SweepOptions, matrix: MatrixEntry[], baseUrl: string): void {
  console.log(`${TAG} — dry run (nothing executed)`);
  console.log(
    `  serve:    ${process.env.E2E_BASE_URL ? `E2E_BASE_URL=${baseUrl}` : `vite dev on ${baseUrl}`}`,
  );
  console.log(
    `  routes:   ${options.routes.length ? options.routes.join(',') : 'all manifest screens'}`,
  );
  console.log(
    `  ledger:   ${options.updateLedger ? 'ratchet (--update-ledger)' : 'compare only'}${options.ci ? ', --ci' : ''}`,
  );
  console.log('  steps:    1 stack · 2 .env.qa · 3 seed · 4 serve · 5 matrix · 6 compare+summary');
  for (const entry of matrix) {
    console.log(
      `  run:      E2E_UI_AUDIT=1 E2E_UI_AUDIT_CONFORMANCE=1 E2E_UI_AUDIT_PERSONAS=${entry.personas} ` +
        (options.full ? '' : `E2E_UI_AUDIT_STATES=${RATCHET_STATES} `) +
        `E2E_UI_AUDIT_VIEWPORT=${entry.viewport} E2E_UI_AUDIT_POINTER=${entry.pointer} bunx playwright test ${SPEC}` +
        ` → ${relative(ROOT, artifactPath(entry))}`,
    );
  }
  console.log(
    `  compare:  node ${compareArgs(
      options,
      matrix.map((e) => relative(ROOT, artifactPath(e))),
    ).join(' ')}`,
  );
}

async function main(): Promise<void> {
  const options = parseSweepArgs(process.argv.slice(2));
  const matrix = expandMatrix(options);
  const externalBase = process.env.E2E_BASE_URL;
  const baseUrl = externalBase ?? `http://127.0.0.1:${SWEEP_PORT}`;
  if (options.dryRun) return printPlan(options, matrix, baseUrl);
  if (options.ci && !externalBase)
    throw new Blocked('--ci never starts a server; set E2E_BASE_URL');

  // 1. stack
  let env: NodeJS.ProcessEnv = process.env;
  if (externalBase) {
    step(
      1,
      'stack',
      `E2E_BASE_URL given; PUBLIC_SUPABASE_URL loopback host ${requireLoopbackSupabase(env)}`,
    );
  } else {
    const status = spawnSupabaseCli(['status', '-o', 'env'], ROOT, { encoding: 'utf8' });
    if (status.status !== 0)
      throw new Blocked(`stack — supabase status failed; start the QA stack (bun run qa:up)`);
    const parsed = parseSupabaseStatusEnv(String(status.stdout));
    step(
      1,
      'stack',
      `reachable at ${parsed.apiUrl} (loopback ${requireLoopbackSupabase({ PUBLIC_SUPABASE_URL: parsed.apiUrl })})`,
    );
  }

  // 2. .env.qa
  if (externalBase) {
    step(2, '.env.qa', 'skipped (server already running against its own env)');
  } else {
    writeEnvQa(ROOT, TAG);
    env = mergeQaEnvOverride(
      process.env,
      parseEnvFile(readFileSync(join(ROOT, '.env.qa'), 'utf8')),
    );
    step(2, '.env.qa', 'written and forced into the child env');
  }

  // 3. seed (the seed asserts loopback itself; assert here too so --ci can never reach a hosted project)
  requireLoopbackSupabase(env);
  const seed = spawnSync('bun', ['scripts/ui-audit-seed.ts'], { cwd: ROOT, env, stdio: 'inherit' });
  if (seed.status !== 0) throw new Blocked(`seed — scripts/ui-audit-seed.ts exited ${seed.status}`);
  const fixtures = parseEnvFile(readFileSync(join(ROOT, '.env.ui-audit.local'), 'utf8'));
  step(
    3,
    'seed',
    `${JSON.parse(fixtures.E2E_UI_AUDIT_FIXTURES ?? '[]').length} dynamic fixtures loaded`,
  );

  // 4. serve
  mkdirSync(OUTPUT_DIR, { recursive: true });
  let server: ReturnType<typeof spawn> | undefined;
  process.once('SIGINT', onInterrupt);
  try {
    if (!externalBase) {
      const log = openSync(join(OUTPUT_DIR, 'sweep-server.log'), 'w');
      server = spawn(
        'bun',
        ['run', 'dev', '--', '--host', '127.0.0.1', '--port', String(SWEEP_PORT), '--strictPort'],
        { cwd: ROOT, env, stdio: ['ignore', log, log], detached: true },
      );
    }
    if (!(await waitFor(`${baseUrl}/en/login`, 120_000))) {
      throw new Blocked(
        `serve — ${baseUrl}/en/login never answered 200${server ? ' (see test-results/ui-audit/sweep-server.log)' : ''}`,
      );
    }
    step(
      4,
      'serve',
      `${baseUrl} answers /en/login 200${server ? ` (vite dev pid ${server.pid})` : ' (external)'}`,
    );

    // 5. matrix
    const artifacts: string[] = [];
    for (const entry of matrix) {
      const artifact = artifactPath(entry);
      rmSync(artifact, { force: true });
      const run = spawnSync('bunx', playwrightArgs(entry), {
        cwd: ROOT,
        env: assembleRunEnv(env, entry, {
          baseUrl,
          routes: options.routes,
          fixtures,
          states: options.full ? undefined : RATCHET_STATES,
        }),
        stdio: 'inherit',
      });
      if (!existsSync(artifact))
        throw new Blocked(
          `matrix — ${runId(entry)} produced no run artifact (playwright exit ${run.status})`,
        );
      artifacts.push(artifact);
      step(
        5,
        `matrix ${runId(entry)}`,
        `artifact written (playwright exit ${run.status}; blocked/failed rows are judged by the compare)`,
      );
    }

    // 6. compare + summary (+ ratchet)
    const compare = spawnSync('node', compareArgs(options, artifacts), {
      cwd: ROOT,
      stdio: 'inherit',
    });
    step(6, 'compare+summary', compare.status === 0 ? 'ok' : `exit ${compare.status}`);
    process.exitCode = compare.status ?? 1;
  } finally {
    stopServer();
    process.off('SIGINT', onInterrupt);
  }

  function stopServer(): void {
    if (!server?.pid) return;
    try {
      process.kill(-server.pid, 'SIGTERM');
    } catch {
      server.kill('SIGTERM');
    }
  }

  // Ctrl-C during a spawnSync never reaches `finally`; stop the detached vite group explicitly.
  function onInterrupt(): void {
    stopServer();
    process.exit(130);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      err instanceof Blocked ? `${TAG} blocked: ${message}` : `${TAG} FAILED — ${message}`,
    );
    process.exitCode = 1;
  });
}

#!/usr/bin/env bun
/**
 * OWNER-ONLY — never run by an agent. See specs/2026-09-16-hub-local-qa-stack-spec.md §3.
 *
 * Reads production's public schema (read-only, never writes to the source)
 * and writes the committed QA baseline that scripts/qa/db-bootstrap.ts
 * restores locally before replaying scripts/db-migrate.ts:
 *
 *   supabase/qa/baseline/schema.sql    — pg_dump --schema-only --schema=public --no-owner
 *   supabase/qa/baseline/ledger.sql    — pg_dump --data-only --inserts --table=public.hub_migrations
 *     (--inserts, not the COPY-format default: postgres.js's `unsafe()` can't
 *     speak the COPY protocol, and this keeps db-bootstrap.ts's psql-less
 *     fallback path working everywhere. db-bootstrap.ts also tolerates an
 *     older COPY-format ledger.sql, in case one is ever checked out.)
 *   supabase/qa/baseline/baseline.json — { snapshotAt, pgVersion, pgVersionFull, maxLedgerVersion, migrationFilesAtSnapshot }
 *
 * SUPABASE_DB_URL is read from `.env.local` in the CURRENT working directory
 * by parsing the file's text directly — never from the shell environment —
 * so this is the one script in the QA pipeline allowed to touch that file.
 *
 * Usage: bun run qa:snapshot --confirm-prod-read
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import postgres from 'postgres';
import { parseEnvFile, redactUrl, toSessionPoolerUrl } from './snapshot-env';
import { sanitizeDump } from './snapshot-sanitize';

/** True if the binary exists on PATH (spawnSync sets .error with ENOENT when it doesn't). */
function binaryExists(bin: string): boolean {
  const result = spawnSync(bin, ['--version'], { stdio: 'ignore' });
  return result.error === undefined || (result.error as NodeJS.ErrnoException).code !== 'ENOENT';
}

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..'); // scripts/qa -> repo root
const BASELINE_DIR = join(ROOT, 'supabase', 'qa', 'baseline');
const MIGRATIONS_DIR = join(ROOT, 'supabase', 'migrations');

function fail(message: string): never {
  console.error(`qa:snapshot FAILED — ${message}`);
  process.exit(1);
}

if (!process.argv.includes('--confirm-prod-read')) {
  fail(
    'refusing to read production without --confirm-prod-read. This script opens a single read-only ' +
      'transaction plus pg_dump reads and never writes to the source, but it does need real production ' +
      'credentials — pass the flag deliberately.',
  );
}

const envPath = join(process.cwd(), '.env.local');
if (!existsSync(envPath)) {
  fail(
    `${envPath} not found — SUPABASE_DB_URL is read from .env.local directly, never from the shell env`,
  );
}
const env = parseEnvFile(readFileSync(envPath, 'utf8'));
const rawUrl = env.SUPABASE_DB_URL;
if (!rawUrl) fail('.env.local has no SUPABASE_DB_URL');

const { url, rewritten } = toSessionPoolerUrl(rawUrl);
console.log(
  `qa:snapshot — source ${redactUrl(url)}` +
    (rewritten
      ? ' (rewritten from the transaction pooler port 6543 to the session pooler port 5432 — pg_dump needs session mode)'
      : ''),
);

// ---- metadata via one read-only transaction; never writes to the source ----
const sql = postgres(url, { prepare: false, max: 1, onnotice: () => {} });
let pgVersionFull = '';
let maxLedgerVersion: string | null = null;
try {
  await sql.begin('read only', async (tx) => {
    const [versionRow] = await tx<{ version: string }[]>`select version()`;
    pgVersionFull = versionRow.version;
    const [ledgerRow] = await tx<
      { max: string | null }[]
    >`select max(version) as max from public.hub_migrations`;
    maxLedgerVersion = ledgerRow.max;
  });
} catch (err) {
  fail(`read-only metadata query failed: ${err instanceof Error ? err.message : err}`);
} finally {
  await sql.end({ timeout: 5 });
}
const pgVersion = pgVersionFull.match(/PostgreSQL (\d+)/)?.[1] ?? 'unknown';

// ---- pg_dump: local binary preferred, dockerized fallback ----
function runPgDump(args: string[]): string {
  if (binaryExists('pg_dump')) {
    const result = spawnSync('pg_dump', [...args, url], {
      encoding: 'utf8',
      maxBuffer: 1024 * 1024 * 256,
    });
    if (result.status !== 0) fail(`pg_dump ${args.join(' ')} failed: ${result.stderr}`);
    return result.stdout;
  }
  if (!binaryExists('docker')) {
    fail('neither pg_dump nor docker is available locally — install postgresql-client or Docker');
  }
  for (const image of ['supabase/postgres:15.8.1.085', 'postgres:16']) {
    const inspect = spawnSync('docker', ['image', 'inspect', image], { stdio: 'ignore' });
    const ready =
      inspect.status === 0 ||
      spawnSync('docker', ['pull', image], { stdio: 'ignore' }).status === 0;
    if (!ready) continue;
    console.log(`qa:snapshot — no local pg_dump binary; using dockerized pg_dump from ${image}`);
    const result = spawnSync(
      'docker',
      ['run', '--rm', '--network', 'host', image, 'pg_dump', ...args, url],
      {
        encoding: 'utf8',
        maxBuffer: 1024 * 1024 * 256,
      },
    );
    if (result.status !== 0) fail(`dockerized pg_dump (${image}) failed: ${result.stderr}`);
    return result.stdout;
  }
  fail(
    'no usable pg_dump found: no local binary, and neither supabase/postgres:15.8.1.085 nor postgres:16 could ' +
      'be found/pulled via docker',
  );
}

console.log('qa:snapshot — dumping schema (--schema-only --schema=public --no-owner)…');
const schemaSql = sanitizeDump(runPgDump(['--schema-only', '--schema=public', '--no-owner']));
console.log('qa:snapshot — dumping public.hub_migrations (--data-only --inserts)…');
const ledgerSql = sanitizeDump(
  runPgDump(['--data-only', '--inserts', '--table=public.hub_migrations']),
);

// ---- write baseline ----
mkdirSync(BASELINE_DIR, { recursive: true });
const schemaPath = join(BASELINE_DIR, 'schema.sql');
const ledgerPath = join(BASELINE_DIR, 'ledger.sql');
const baselineJsonPath = join(BASELINE_DIR, 'baseline.json');

let diffLineCount: number | null = null;
if (existsSync(schemaPath)) {
  const previous = readFileSync(schemaPath, 'utf8');
  if (previous !== schemaSql) {
    if (binaryExists('diff')) {
      const prevTmp = join(BASELINE_DIR, '.schema.prev.tmp');
      const nextTmp = join(BASELINE_DIR, '.schema.next.tmp');
      writeFileSync(prevTmp, previous);
      writeFileSync(nextTmp, schemaSql);
      const result = spawnSync('diff', ['-u', prevTmp, nextTmp], { encoding: 'utf8' });
      diffLineCount = result.stdout
        .split('\n')
        .filter((line) => /^[+-]/.test(line) && !/^(\+\+\+|---)/.test(line)).length;
      unlinkSync(prevTmp);
      unlinkSync(nextTmp);
    }
  } else {
    diffLineCount = 0;
  }
}

const migrationFilesAtSnapshot = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort();

const baseline = {
  snapshotAt: new Date().toISOString(),
  pgVersion,
  pgVersionFull,
  maxLedgerVersion,
  migrationFilesAtSnapshot,
};

writeFileSync(schemaPath, schemaSql);
writeFileSync(ledgerPath, ledgerSql);
writeFileSync(baselineJsonPath, JSON.stringify(baseline, null, 2) + '\n');

console.log('qa:snapshot — wrote:');
console.log(`  ${schemaPath} (${schemaSql.split('\n').length} lines)`);
console.log(`  ${ledgerPath} (${ledgerSql.split('\n').length} lines)`);
console.log(`  ${baselineJsonPath}`);
console.log(
  `qa:snapshot — pgVersion=${pgVersion} maxLedgerVersion=${maxLedgerVersion ?? '(none)'}`,
);
if (diffLineCount !== null) {
  console.log(
    `qa:snapshot — schema.sql changed ${diffLineCount} diff line(s) vs the previous committed baseline`,
  );
} else if (existsSync(schemaPath)) {
  console.log('qa:snapshot — no previous baseline diff available (diff binary not found)');
} else {
  console.log('qa:snapshot — no previous baseline existed; this is the first snapshot');
}

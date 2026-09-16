#!/usr/bin/env bun
/**
 * Sanity-checks the committed baseline (spec §7 S4 deliverable 3) without a
 * database: pure filesystem/text checks, cheap enough for the `test` CI job.
 *
 *   1. baseline.json.maxLedgerVersion names a file that still exists in
 *      supabase/migrations/.
 *   2. Every file in baseline.json.migrationFilesAtSnapshot still exists
 *      there too (migrationFilesAtSnapshot ⊆ current files).
 *   3. ledger.sql's INSERT count equals migrationFilesAtSnapshot.length —
 *      the ledger snapshot must record exactly one row per migration file
 *      that existed at snapshot time, no more, no fewer.
 *   4. schema.sql contains no top-level INSERT/COPY data statement — the
 *      schema-only guarantee (spec §1: "the baseline therefore has to be a
 *      schema-only snapshot"). Indented statements inside a function body
 *      ($$ ... $$) are not data-loading and are intentionally not flagged.
 *
 * Usage: bun scripts/qa/check-baseline.ts
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { copyBlocksToInserts } from './copy-to-inserts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BASELINE_DIR = join(ROOT, 'supabase', 'qa', 'baseline');
const MIGRATIONS_DIR = join(ROOT, 'supabase', 'migrations');

export interface BaselineJson {
  maxLedgerVersion: string;
  migrationFilesAtSnapshot: readonly string[];
}

export interface CheckBaselineInput {
  baselineJson: BaselineJson;
  currentMigrationFiles: readonly string[];
  ledgerSql: string;
  schemaSql: string;
}

export interface CheckBaselineResult {
  ok: boolean;
  errors: readonly string[];
}

const versionOf = (file: string): string => file.replace(/_.*/, '');

/** Counts data rows a ledger.sql (COPY or --inserts format) would restore. Same
 *  approach as db-bootstrap.ts's countLedgerRows — kept independent (no shared
 *  import) since that function isn't exported and this check must stay a pure,
 *  DB-free filesystem check. */
function countLedgerInserts(ledgerSql: string): number {
  const asInserts = ledgerSql.includes('FROM stdin;') ? copyBlocksToInserts(ledgerSql) : ledgerSql;
  return (asInserts.match(/^INSERT INTO\b/gim) ?? []).length;
}

/** pg_dump emits top-level statements flush against column 0; anything indented
 *  is inside a function/procedure body ($$ ... $$) and is not a dump-level data
 *  statement, so only column-0 matches count here. */
function findSchemaDataStatements(schemaSql: string): string[] {
  const hits: string[] = [];
  for (const line of schemaSql.split('\n')) {
    if (/^INSERT INTO\b/.test(line) || /^COPY\s+\S+.*FROM stdin;/.test(line)) {
      hits.push(line.trim());
    }
  }
  return hits;
}

/** Pure: the four checks above, no filesystem or process access. */
export function checkBaseline({
  baselineJson,
  currentMigrationFiles,
  ledgerSql,
  schemaSql,
}: CheckBaselineInput): CheckBaselineResult {
  const errors: string[] = [];
  const currentVersions = new Set(currentMigrationFiles.map(versionOf));
  const currentFiles = new Set(currentMigrationFiles);

  if (!currentVersions.has(baselineJson.maxLedgerVersion)) {
    errors.push(
      `baseline.json.maxLedgerVersion "${baselineJson.maxLedgerVersion}" does not correspond ` +
        'to any file currently in supabase/migrations/ — the baseline may have been snapshotted ' +
        'from a branch with a migration file since renamed or removed',
    );
  }

  const missingFiles = baselineJson.migrationFilesAtSnapshot.filter((f) => !currentFiles.has(f));
  if (missingFiles.length > 0) {
    errors.push(
      `baseline.json.migrationFilesAtSnapshot lists ${missingFiles.length} file(s) no longer ` +
        `present in supabase/migrations/: ${missingFiles.join(', ')}`,
    );
  }

  const ledgerInsertCount = countLedgerInserts(ledgerSql);
  if (ledgerInsertCount !== baselineJson.migrationFilesAtSnapshot.length) {
    errors.push(
      `ledger.sql has ${ledgerInsertCount} INSERT row(s) but baseline.json.migrationFilesAtSnapshot ` +
        `lists ${baselineJson.migrationFilesAtSnapshot.length} file(s) — they must match ` +
        '(one hub_migrations row per migration file that existed at snapshot time)',
    );
  }

  const dataStatements = findSchemaDataStatements(schemaSql);
  if (dataStatements.length > 0) {
    errors.push(
      `schema.sql contains ${dataStatements.length} top-level data statement(s) — it must be ` +
        `schema-only: ${dataStatements.slice(0, 5).join(' | ')}` +
        (dataStatements.length > 5 ? ' | …' : ''),
    );
  }

  return { ok: errors.length === 0, errors };
}

async function main(): Promise<void> {
  const baselineJsonPath = join(BASELINE_DIR, 'baseline.json');
  const ledgerPath = join(BASELINE_DIR, 'ledger.sql');
  const schemaPath = join(BASELINE_DIR, 'schema.sql');
  for (const p of [baselineJsonPath, ledgerPath, schemaPath]) {
    if (!existsSync(p)) {
      console.error(`qa:check-baseline FAILED — missing ${p}`);
      process.exit(1);
    }
  }

  const baselineJson = JSON.parse(readFileSync(baselineJsonPath, 'utf8')) as BaselineJson;
  const currentMigrationFiles = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql'));
  const ledgerSql = readFileSync(ledgerPath, 'utf8');
  const schemaSql = readFileSync(schemaPath, 'utf8');

  const result = checkBaseline({ baselineJson, currentMigrationFiles, ledgerSql, schemaSql });
  if (!result.ok) {
    console.error('qa:check-baseline FAILED:');
    for (const e of result.errors) console.error(`  - ${e}`);
    process.exit(1);
  }
  console.log(
    `qa:check-baseline OK — maxLedgerVersion ${baselineJson.maxLedgerVersion} exists, ` +
      `${baselineJson.migrationFilesAtSnapshot.length} snapshot file(s) still present, ` +
      'ledger row count matches, schema.sql is data-free.',
  );
}

if (import.meta.main) await main();

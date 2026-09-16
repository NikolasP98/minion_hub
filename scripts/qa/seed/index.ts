#!/usr/bin/env bun
/**
 * QA seed orchestrator — `bun run qa:seed [-- --dry-run] [-- --only <domain>]`.
 *
 * Loopback guard -> schema preflight -> one transaction per domain module (in
 * dependency order) -> matrix coverage check -> `.env.qa.local`. Idempotent:
 * every module writes `on conflict ... do update/nothing`, so a second run
 * changes nothing (see `runSeed()`'s exported use in the contract test).
 */
import postgres from 'postgres';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { createClient as createLibsqlClient } from '@libsql/client';
import { assertLoopback, SEEDED_TABLES, type SeedContext, type Register, type RowRef } from './db';
import { MATRIX, MATRIX_VERSION } from './matrix';
import { QA_PASSWORD } from './ids';
import { writeQaEnv } from './env';

import * as tenancy from './tenancy';
import * as crm from './crm';
import * as catalog from './catalog';
import * as stock from './stock';
import * as finances from './finances';
import * as scheduling from './scheduling';
import * as pos from './pos';
import * as attachments from './attachments';
import * as jobsBrains from './jobs-brains';
import * as gatewayLibsql from './gateway-libsql';
import * as uiAuditCompat from './ui-audit-compat';

const MODULES: ReadonlyArray<{
  domain: string;
  label: string;
  seed: (ctx: SeedContext) => Promise<void>;
}> = [
  { domain: 'tenancy', label: 'tenancy', seed: tenancy.seed },
  { domain: 'crm', label: 'crm', seed: crm.seed },
  { domain: 'catalog', label: 'catalog', seed: catalog.seed },
  { domain: 'stock', label: 'stock', seed: stock.seed },
  { domain: 'finances', label: 'finances', seed: finances.seed },
  { domain: 'scheduling', label: 'scheduling', seed: scheduling.seed },
  { domain: 'pos', label: 'pos', seed: pos.seed },
  { domain: 'attachments', label: 'attachments', seed: attachments.seed },
  { domain: 'jobs', label: 'jobs-brains', seed: jobsBrains.seed },
  { domain: 'gateway', label: 'gateway-libsql', seed: gatewayLibsql.seed },
  // Not a matrix domain — keeps the ui-audit-seed.ts personas alive on the same stack.
  { domain: 'ui-audit', label: 'ui-audit-compat', seed: uiAuditCompat.seed },
];

async function preflight(sql: ReturnType<typeof postgres>): Promise<void> {
  const rows = await sql<{ table_name: string }[]>`
    select table_name from information_schema.tables where table_schema = 'public'
  `;
  const present = new Set(rows.map((r) => r.table_name));
  const missing = SEEDED_TABLES.filter((t) => !present.has(t));
  if (missing.length > 0) {
    throw new Error(
      `QA database is missing ${missing.length} table(s) the seed writes to: ${missing.join(', ')}. ` +
        'Run scripts/qa/db-bootstrap.ts (baseline restore + migration runner) first.',
    );
  }
}

function buildContext(register: Register): SeedContext {
  const dbUrl = assertLoopback(process.env.SUPABASE_DB_URL, 'SUPABASE_DB_URL');
  const supabaseUrl = assertLoopback(process.env.PUBLIC_SUPABASE_URL, 'PUBLIC_SUPABASE_URL');
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required');
  const tursoUrl = assertLoopback(
    process.env.TURSO_DB_URL ?? 'file:./data/qa/minion_hub.db',
    'TURSO_DB_URL',
  );

  const sql = postgres(dbUrl, {
    prepare: false,
    max: 5,
    connection: { application_name: 'minion-qa-seed' },
  });
  const admin = createSupabaseClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const libsql = createLibsqlClient({ url: tursoUrl, authToken: process.env.TURSO_DB_AUTH_TOKEN });

  return { sql, admin, libsql, now: new Date(), password: QA_PASSWORD, register };
}

/**
 * Runs every domain module (or just `only`, for iteration) and returns the
 * matrix ids that were never registered. Exported so `seed.contract.test.ts`
 * can call it twice in the same process for the idempotency assertion.
 */
export async function runSeed(options: { only?: string; dryRun?: boolean } = {}): Promise<{
  registered: ReadonlyMap<string, RowRef>;
  missing: readonly string[];
}> {
  const registered = new Map<string, RowRef>();
  const register: Register = (matrixId, ref) => registered.set(matrixId, ref);
  const modules = options.only ? MODULES.filter((m) => m.domain === options.only) : MODULES;
  if (options.only && modules.length === 0) {
    throw new Error(
      `Unknown --only domain "${options.only}". Known: ${[...new Set(MODULES.map((m) => m.domain))].join(', ')}`,
    );
  }

  if (options.dryRun) {
    console.log(`[qa:seed] dry run — would seed: ${modules.map((m) => m.label).join(', ')}`);
    console.log(`[qa:seed] matrix version ${MATRIX_VERSION}, ${MATRIX.length} entries`);
    return { registered, missing: [] };
  }

  const ctx = buildContext(register);
  try {
    await preflight(ctx.sql);
    for (const mod of modules) {
      const startedAt = Date.now();
      await mod.seed(ctx);
      console.log(`[qa:seed] ${mod.label} done (${Date.now() - startedAt}ms)`);
    }
  } finally {
    await ctx.sql.end({ timeout: 5 });
    ctx.libsql.close();
  }

  const relevantMatrixIds = options.only
    ? MATRIX.filter((e) => e.domain === options.only).map((e) => e.id)
    : MATRIX.map((e) => e.id);
  const missing = relevantMatrixIds.filter((id) => !registered.has(id));
  return { registered, missing };
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const onlyIndex = args.indexOf('--only');
  const only = onlyIndex >= 0 ? args[onlyIndex + 1] : undefined;

  const { registered, missing } = await runSeed({ only, dryRun });
  if (dryRun) return;

  if (!only) await writeQaEnv();

  const domains = [...new Set(MATRIX.map((e) => e.domain))];
  for (const domain of domains) {
    const ids = MATRIX.filter((e) => e.domain === domain).map((e) => e.id);
    const count = ids.filter((id) => registered.has(id)).length;
    console.log(`[qa:seed]   ${domain}: ${count}/${ids.length} registered`);
  }
  console.log(
    `[qa:seed] matrix coverage: ${registered.size}/${MATRIX.length} registered` +
      (only ? ` (--only ${only})` : ''),
  );
  if (missing.length > 0) {
    console.error(
      `[qa:seed] ${missing.length} matrix id(s) were never registered by a seed module:`,
    );
    for (const id of missing) console.error(`  - ${id}`);
    process.exitCode = 1;
    return;
  }
  console.log('[qa:seed] every matrix id for this run is registered.');
}

if (import.meta.main) await main();

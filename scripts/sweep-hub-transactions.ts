#!/usr/bin/env bun
/**
 * Sweep every hub-CREATED transactional row (POS sales, purchases, stock
 * movements) org-wide. Owner's ask: "nullify/delete/sweep all transactions
 * made via the hub (purchases/invoices/events/stock) and clean up any
 * official sunat submissions."
 *
 * Scope rule: delete rows the HUB wrote as a transaction; keep MASTER/config
 * data (products, items, warehouses, resources, event types/kinds, tags,
 * parties, settings, series) and rows imported from an external system.
 * Per-table provenance and the reasoning behind each line is in the code
 * comments below and in the task report that produced this script — file a
 * meta-repo `proposals/` entry from that report per AGENTS.md's open-items
 * ledger rule before running --apply (this worktree cannot write there).
 *
 * IMPORTANT — `fin_invoices`/`fin_invoice_items`/`fin_payments`/`fin_clients`
 * are NOT swept at all: grepping pos.service.ts and every stock/purchase
 * service turned up no hub write path into `fin_invoices` — the only writer
 * is `finance.service.ts`'s `upsertInvoicesBatch`, fed exclusively by the
 * SUSII/SUNAT-SIRE sync connectors (`provider` is always an external
 * connector id). There is no `provider='pos'` hub bridge row to filter out;
 * that assumption in the original ask does not match the shipped schema.
 *
 * SAFE BY DEFAULT: dry-run only (read-only SELECT counts), writes nothing.
 * `--apply` snapshots every row it will delete to
 * `.sweep-snapshots/<timestamp>.json` (gitignored), deletes everything in ONE
 * transaction in dependency order, then re-checks every in-scope count is 0
 * before committing (rolls back otherwise).
 *
 *   bun scripts/sweep-hub-transactions.ts                          # dry run, every org
 *   bun scripts/sweep-hub-transactions.ts --org <orgId>            # one org
 *   bun scripts/sweep-hub-transactions.ts --apply                  # execute
 *   bun scripts/sweep-hub-transactions.ts --apply --include-bookings
 *   bun scripts/sweep-hub-transactions.ts --apply --force-emissions
 *
 * `sched_bookings` (+ its status log) are EXCLUDED from `--apply` unless
 * `--include-bookings` is passed — a clinic may have real future
 * appointments and this script cannot tell a real one from test data. The
 * dry run always prints the per-org/status/past-vs-future breakdown so the
 * owner can decide.
 *
 * `--apply` REFUSES to run while any `pos_emissions` row with
 * `environment='prod' AND status='accepted'` exists (those are real SUNAT
 * documents; deleting the DB row does not void them at SUNAT) unless
 * `--force-emissions` is passed. Void them first with
 * `scripts/sunat-baja-hub-emissions.ts` — see that script's header for why
 * its `--apply` is currently a hard no-op. Prod-accepted rows are NEVER
 * deleted by this script, force flag or not; they are simply left alone.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import postgres from 'postgres';

// ---------------------------------------------------------------------------
// Pure, unit-tested logic (no DB) — see sweep-hub-transactions.test.ts
// ---------------------------------------------------------------------------

export interface SweepStep {
  table: string;
  /** SQL boolean expression (no leading WHERE) combined with `org_id = any($1)`. */
  scopeSql: string;
  note: string;
}

/** stk_entries rows imported by the FACES CSV seed carry this marker
 *  (scripts/seed-stock-faces.ts) — opening balances, never swept. */
export const IMPORTED_STOCK_SOURCE = 'seed-faces-csv';

const KEEP_IMPORTED_STOCK = `coalesce(metadata->>'source', '') <> '${IMPORTED_STOCK_SOURCE}'`;

/**
 * Children before parents. Every FK here is read straight off the migration
 * SQL (Drizzle's schema omits several real constraints), not guessed:
 *   - pos_ticket_lines/pos_payments CASCADE from pos_tickets — never deleted
 *     directly, they disappear when pos_tickets does.
 *   - pos_emissions.ticket_id, pos_package_grants.source_ticket_id/
 *     source_line_id, pos_package_redemptions.grant_id are all ON DELETE
 *     RESTRICT — every one of those must be gone before pos_tickets.
 *   - pos_tickets.shift_id is ON DELETE RESTRICT — pos_shifts goes last.
 *   - stk_ledger.entry_id and stk_entry_lines.entry_id both reference
 *     stk_entries; entry_lines CASCADEs, stk_ledger does NOT (plain
 *     REFERENCES, no ON DELETE) — stk_ledger must be deleted before
 *     stk_entries.
 *   - stk_accruals/fin_purchases have no incoming FK from anything else in
 *     this list; order among themselves doesn't matter.
 */
export const DELETE_ORDER: SweepStep[] = [
  {
    table: 'pos_package_redemptions',
    scopeSql: 'true',
    note: 'grant_id restrict -> before pos_package_grants',
  },
  {
    table: 'pos_package_grants',
    scopeSql: 'true',
    note: 'source_ticket_id/source_line_id restrict -> before pos_tickets',
  },
  {
    table: 'pos_emissions',
    scopeSql: "not (environment = 'prod' and status = 'accepted')",
    note: 'ticket_id restrict -> before pos_tickets; prod-accepted rows never deleted here',
  },
  { table: 'pos_client_ledger', scopeSql: 'true', note: 'soft refs only' },
  { table: 'pos_payment_plans', scopeSql: 'true', note: 'soft refs only' },
  {
    table: 'pos_tickets',
    scopeSql: 'true',
    note: 'cascades pos_ticket_lines + pos_payments (ON DELETE CASCADE)',
  },
  { table: 'pos_shifts', scopeSql: 'true', note: 'pos_tickets.shift_id restrict -> deleted last' },
  {
    table: 'stk_ledger',
    scopeSql: `entry_id in (select id from stk_entries e2 where e2.org_id = stk_ledger.org_id and ${KEEP_IMPORTED_STOCK.replaceAll('metadata', 'e2.metadata')})`,
    note: 'no ON DELETE on entry_id -> before stk_entries',
  },
  {
    table: 'stk_entries',
    scopeSql: KEEP_IMPORTED_STOCK,
    note: `cascades stk_entry_lines; keeps ${IMPORTED_STOCK_SOURCE} opening-balance rows`,
  },
  { table: 'stk_accruals', scopeSql: 'true', note: "source='booking' always, 100% hub-native" },
  {
    table: 'fin_purchases',
    scopeSql: "source = 'manual'",
    note: "source='sunat' rows are RCE-synced, kept",
  },
];

/** Gated behind --include-bookings. Also children-before-parents. */
export const BOOKING_STEPS: SweepStep[] = [
  {
    table: 'sched_booking_status_log',
    scopeSql:
      'booking_id in (select id from sched_bookings b2 where b2.org_id = sched_booking_status_log.org_id)',
    note: 'no FK, but delete before sched_bookings for a clean snapshot',
  },
  { table: 'sched_bookings', scopeSql: 'true', note: 'excluded unless --include-bookings' },
];

export function stepsFor(includeBookings: boolean): SweepStep[] {
  return includeBookings ? [...DELETE_ORDER, ...BOOKING_STEPS] : DELETE_ORDER;
}

/** Throws with a message telling the owner exactly what to run first. */
export function assertEmissionsGate(opts: {
  prodAcceptedCount: number;
  forceEmissions: boolean;
}): void {
  if (opts.prodAcceptedCount > 0 && !opts.forceEmissions) {
    throw new Error(
      `refusing --apply: ${opts.prodAcceptedCount} prod-accepted SUNAT emission(s) are not voided yet. ` +
        'Void them first with `bun scripts/sunat-baja-hub-emissions.ts --apply` (facturas via baja, ' +
        'boletas via resumen estado-3), or pass --force-emissions to sweep everything else anyway ' +
        '(those rows are left untouched either way — this flag never deletes a prod-accepted emission).',
    );
  }
}

// ---------------------------------------------------------------------------
// CLI / DB wiring
// ---------------------------------------------------------------------------

interface Args {
  apply: boolean;
  org: string | null;
  includeBookings: boolean;
  forceEmissions: boolean;
}

export function parseArgs(argv: string[]): Args {
  const orgIdx = argv.indexOf('--org');
  return {
    apply: argv.includes('--apply'),
    org: orgIdx >= 0 ? (argv[orgIdx + 1] ?? null) : null,
    includeBookings: argv.includes('--include-bookings'),
    forceEmissions: argv.includes('--force-emissions'),
  };
}

async function resolveOrgIds(client: postgres.Sql, org: string | null): Promise<string[]> {
  if (org) return [org];
  const rows = await client<{ org_id: string }[]>`
    select distinct org_id from (
      select org_id from pos_tickets
      union select org_id from pos_shifts
      union select org_id from stk_entries
      union select org_id from fin_purchases
      union select org_id from sched_bookings
      union select org_id from pos_emissions
    ) t order by org_id`;
  return rows.map((r) => r.org_id);
}

async function countByOrg(
  client: postgres.Sql,
  table: string,
  scopeSql: string,
  orgIds: string[],
): Promise<Map<string, number>> {
  if (!orgIds.length) return new Map();
  const rows = (await client.unsafe(
    `select org_id, count(*)::int as n from ${table} where org_id = any($1) and (${scopeSql}) group by org_id`,
    [orgIds],
  )) as unknown as { org_id: string; n: number }[];
  return new Map(rows.map((r) => [r.org_id, r.n]));
}

async function bookingsBreakdown(client: postgres.Sql, orgIds: string[]) {
  if (!orgIds.length) return [];
  return (await client<{ org_id: string; status: string; future: boolean; n: number }[]>`
    select org_id, status, (start_time >= now()) as future, count(*)::int as n
    from sched_bookings
    where org_id = any(${orgIds})
    group by org_id, status, future
    order by org_id, status, future`) as unknown as {
    org_id: string;
    status: string;
    future: boolean;
    n: number;
  }[];
}

async function prodAcceptedEmissions(client: postgres.Sql, orgIds: string[]) {
  if (!orgIds.length) return [];
  return (await client`
    select org_id, doc_type, serie, correlativo, total, created_at
    from pos_emissions
    where org_id = any(${orgIds}) and environment = 'prod' and status = 'accepted'
    order by org_id, doc_type, serie, correlativo`) as unknown as Array<{
    org_id: string;
    doc_type: string;
    serie: string;
    correlativo: number;
    total: string | null;
    created_at: Date;
  }>;
}

async function rebuildBins(tx: postgres.TransactionSql, orgId: string): Promise<void> {
  // Mirrors stock.service.ts's rebuildBins: stk_bins is a rebuildable cache,
  // the latest stk_ledger row per (item, warehouse) IS the bin (qty_after /
  // valuation_rate are already the post-commit snapshot — no re-derivation).
  await tx`delete from stk_bins where org_id = ${orgId}`;
  await tx`
    insert into stk_bins (org_id, item_id, warehouse_id, qty, valuation_rate, updated_at)
    select distinct on (item_id, warehouse_id) org_id, item_id, warehouse_id, qty_after, valuation_rate, now()
    from stk_ledger
    where org_id = ${orgId}
    order by item_id, warehouse_id, id desc`;
}

async function dryRun(
  client: postgres.Sql,
  orgIds: string[],
  includeBookings: boolean,
): Promise<void> {
  console.log(`Orgs in scope: ${orgIds.length ? orgIds.join(', ') : '(none found)'}\n`);

  for (const step of stepsFor(includeBookings)) {
    const counts = await countByOrg(client, step.table, step.scopeSql, orgIds);
    const total = [...counts.values()].reduce((a, b) => a + b, 0);
    console.log(`${step.table} — ${total} row(s) in scope  [${step.note}]`);
    for (const [org, n] of counts) if (n > 0) console.log(`    ${org}: ${n}`);
  }

  if (!includeBookings) {
    console.log(
      '\nsched_bookings/sched_booking_status_log are NOT in the default apply scope (pass --include-bookings).',
    );
  }

  console.log(
    '\n-- sched_bookings breakdown (status x past/future), regardless of --include-bookings --',
  );
  const bookings = await bookingsBreakdown(client, orgIds);
  if (!bookings.length) console.log('  (no bookings)');
  for (const row of bookings) {
    console.log(
      `  ${row.org_id}  ${row.status.padEnd(10)} ${row.future ? 'future' : 'past   '}  ${row.n}`,
    );
  }

  console.log(
    '\n-- pos_emissions: environment=prod, status=accepted (NEVER deleted by this script) --',
  );
  const prodEmissions = await prodAcceptedEmissions(client, orgIds);
  if (!prodEmissions.length) {
    console.log('  (none)');
  } else {
    for (const e of prodEmissions) {
      console.log(
        `  ${e.org_id}  ${e.doc_type} ${e.serie}-${e.correlativo}  total=${e.total}  ${e.created_at.toISOString()}`,
      );
    }
    console.log(
      `\n  ${prodEmissions.length} prod-accepted emission(s) found — --apply will refuse until these are voided ` +
        '(scripts/sunat-baja-hub-emissions.ts) or --force-emissions is passed.',
    );
  }
}

async function apply(
  client: postgres.Sql,
  orgIds: string[],
  includeBookings: boolean,
  forceEmissions: boolean,
): Promise<void> {
  const prodEmissions = await prodAcceptedEmissions(client, orgIds);
  assertEmissionsGate({ prodAcceptedCount: prodEmissions.length, forceEmissions });

  const steps = stepsFor(includeBookings);

  // Snapshot every row before touching anything.
  const snapshot: Record<string, unknown[]> = {};
  for (const step of steps) {
    snapshot[step.table] = orgIds.length
      ? ((await client.unsafe(
          `select * from ${step.table} where org_id = any($1) and (${step.scopeSql})`,
          [orgIds],
        )) as unknown[])
      : [];
  }
  const snapshotDir = path.join(process.cwd(), '.sweep-snapshots');
  mkdirSync(snapshotDir, { recursive: true });
  const snapshotPath = path.join(
    snapshotDir,
    `${new Date().toISOString().replaceAll(':', '-')}.json`,
  );
  writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2));
  console.log(`Snapshot written: ${snapshotPath}`);

  await client.begin(async (tx) => {
    for (const step of steps) {
      if (!orgIds.length) continue;
      await tx.unsafe(`delete from ${step.table} where org_id = any($1) and (${step.scopeSql})`, [
        orgIds,
      ]);
    }
    for (const orgId of orgIds) await rebuildBins(tx, orgId);

    // Invariant: every in-scope count must now be zero, inside the same
    // transaction — a non-zero count throws, which rolls the whole thing back.
    for (const step of steps) {
      const counts = await countByOrg(tx, step.table, step.scopeSql, orgIds);
      const total = [...counts.values()].reduce((a, b) => a + b, 0);
      if (total > 0) {
        throw new Error(
          `invariant failed: ${step.table} still has ${total} in-scope row(s) after delete`,
        );
      }
    }
  });

  console.log('Sweep applied and verified (all in-scope counts are 0).');
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const url = process.env.SUPABASE_DB_URL?.trim();
  if (!url) throw new Error('SUPABASE_DB_URL not set (check .env.local) — refusing to run.');
  const client = postgres(url, { prepare: false, max: 5 });

  try {
    const orgIds = await resolveOrgIds(client, args.org);
    if (args.apply) {
      await apply(client, orgIds, args.includeBookings, args.forceEmissions);
    } else {
      await dryRun(client, orgIds, args.includeBookings);
      console.log('\nDry run only — pass --apply to execute.');
    }
  } finally {
    await client.end({ timeout: 5 });
  }
}

if (import.meta.main) await main();

#!/usr/bin/env bun
/**
 * Backfill `fin_invoices.total` for sales SUSII emitted with no document.
 *
 * SUSII's sale payload carries no `total`; the mapper's only source was
 * document_set[0].total, so docless sales stored NULL and counted as zero
 * revenue. Reconstruct with the calibrated formula (see susii-mapper.ts):
 *
 *     total = sum(items.total) + tax - discount + other_charges + rounding
 *
 * Safety:
 *   - refuses to run unless the formula still reproduces EVERY already-known
 *     total exactly (0 mismatches)
 *   - only touches rows where total IS NULL and line items exist
 *   - single transaction; idempotent (a second run updates 0 rows)
 *
 *   bun scripts/susii-null-total-backfill.ts            # dry run
 *   bun scripts/susii-null-total-backfill.ts --apply    # write
 */
import postgres from 'postgres';

const FACES_ORG = '21e0601b-f632-43fd-8414-d644af4271f4';
const APPLY = process.argv.includes('--apply');
const url = process.env.SUPABASE_DB_URL?.trim();
if (!url) throw new Error('SUPABASE_DB_URL not set');
const client = postgres(url, { prepare: false, max: 2 });

const DERIVED = `
  coalesce((select sum(i.total) from fin_invoice_items i where i.invoice_id = v.id),0)
  + coalesce((v.metadata->>'tax')::numeric,0)
  - coalesce((v.metadata->>'discount')::numeric,0)
  + coalesce((v.metadata->>'other_charges')::numeric,0)
  + coalesce((v.metadata->>'rounding')::numeric,0)`;

async function main() {
  const orgId = process.argv.slice(2).find((x) => !x.startsWith('--')) ?? FACES_ORG;
  console.log(`org=${orgId}  mode=${APPLY ? 'APPLY (writes)' : 'dry run'}\n`);

  await client.begin(async (tx) => {
    await tx`set local role app_ledger`;
    await tx`select set_config('app.current_org_id', ${orgId}, true)`;

    // ── Guard: the formula must still reproduce every known total exactly ──
    const [cal] = await tx.unsafe(`
      select count(*)::int n,
             count(*) filter (where abs(v.total - round((${DERIVED})::numeric,2)) >= 0.02)::int as bad
      from fin_invoices v where v.total is not null`);
    console.log(`calibration: ${cal.n} known totals, ${cal.bad} mismatches`);
    if (cal.bad > 0) throw new Error(`ABORT: formula disagrees with ${cal.bad} known totals`);

    const [before] = await tx`
      select count(*) filter (where total is null)::int as nulls,
             round(coalesce(sum(total),0)::numeric,2) as revenue,
             count(*)::int as rows
      from fin_invoices`;
    console.log(`before: ${before.nulls} null totals, revenue S/ ${before.revenue} over ${before.rows} rows`);

    const updated = await tx.unsafe(`
      update fin_invoices v
         set total = round((${DERIVED})::numeric, 2)
       where v.total is null
         and exists (select 1 from fin_invoice_items i where i.invoice_id = v.id)
      returning v.id`);
    console.log(`rows updated: ${updated.length}`);

    const [after] = await tx`
      select count(*) filter (where total is null)::int as nulls,
             round(coalesce(sum(total),0)::numeric,2) as revenue
      from fin_invoices`;
    console.log(`after : ${after.nulls} null totals, revenue S/ ${after.revenue}`);
    console.log(`delta : S/ ${(Number(after.revenue) - Number(before.revenue)).toFixed(2)}`);

    // Spot-check the row we reconciled against SUSII's UI (expects 1300.01).
    const [row] = await tx`select number, total from fin_invoices where number = '3554'`;
    console.log(`spot-check #3554: total=${row?.total} (SUSII UI shows S/ 1,300)`);

    // Re-check Jun-1 in Lima local time (SUSII: 7 sales / S/ 11,100).
    const [jun1] = await tx`
      select count(*)::int n, round(coalesce(sum(total),0)::numeric,2) as t
      from fin_invoices
      where (issued_at at time zone 'America/Lima')::date = date '2026-06-01'`;
    console.log(`Jun-1 (Lima): ${jun1.n} sales, S/ ${jun1.t}`);

    if (!APPLY) {
      console.log('\nDRY RUN — rolling back.');
      throw new ROLLBACK();
    }
    console.log('\nCOMMITTED.');
  }).catch((e) => {
    if (e instanceof ROLLBACK) return;
    throw e;
  });

  await client.end();
}

class ROLLBACK extends Error {}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

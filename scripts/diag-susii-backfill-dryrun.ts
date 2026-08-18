#!/usr/bin/env bun
/**
 * READ-ONLY dry run for the null-total backfill. Writes NOTHING.
 *
 * For every invoice with total IS NULL, compute the total the fixed mapper would
 * now produce (items + tax - discount + other_charges + rounding) and report the
 * before/after, per month and per row.
 *
 *   bun scripts/diag-susii-backfill-dryrun.ts [orgId] > docs/reports/susii-null-total-dryrun.md
 */
import postgres from 'postgres';

const FACES_ORG = '21e0601b-f632-43fd-8414-d644af4271f4';
const url = process.env.SUPABASE_DB_URL?.trim();
if (!url) throw new Error('SUPABASE_DB_URL not set');
const client = postgres(url, { prepare: false, max: 2 });

async function withOrg<T>(
  orgId: string,
  fn: (sql: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  return client.begin(async (tx) => {
    await tx`set local role app_ledger`;
    await tx`select set_config('app.current_org_id', ${orgId}, true)`;
    return fn(tx);
  });
}

const DERIVED = `
  coalesce((select sum(i.total) from fin_invoice_items i where i.invoice_id = v.id),0)
  + coalesce((v.metadata->>'tax')::numeric,0)
  - coalesce((v.metadata->>'discount')::numeric,0)
  + coalesce((v.metadata->>'other_charges')::numeric,0)
  + coalesce((v.metadata->>'rounding')::numeric,0)`;

async function main() {
  const orgId = process.argv.slice(2).find((x) => !x.startsWith('--')) ?? FACES_ORG;
  await withOrg(orgId, async (tx) => {
    console.log('# SUSII null-total backfill — DRY RUN (no writes)\n');
    console.log(
      `org: \`${orgId}\`  ·  formula: \`items + tax − discount + other_charges + rounding\`\n`,
    );

    // Guard: the formula must still reproduce every KNOWN total exactly.
    const [cal] = await tx.unsafe(`
      select count(*)::int n,
             count(*) filter (where abs(v.total - round((${DERIVED})::numeric,2)) >= 0.02)::int as mismatches
      from fin_invoices v where v.total is not null`);
    console.log(`## Calibration guard\n`);
    console.log(
      `Formula re-checked against **${cal.n}** invoices whose total is already known: **${cal.mismatches} mismatches**.\n`,
    );

    const [sum] = await tx.unsafe(`
      select count(*)::int as rows,
             count(*) filter (where (select count(*) from fin_invoice_items i where i.invoice_id=v.id) = 0)::int as no_items,
             round(sum(${DERIVED})::numeric,2) as recovered
      from fin_invoices v where v.total is null`);
    console.log('## Summary\n');
    console.log(`| | |\n|---|--:|`);
    console.log(`| invoices with NULL total | ${sum.rows} |`);
    console.log(`| …of those, with NO line items (stay NULL) | ${sum.no_items} |`);
    console.log(`| **rows this backfill would update** | **${sum.rows - sum.no_items}** |`);
    console.log(`| **revenue recovered** | **S/ ${sum.recovered}** |\n`);

    console.log('## By month\n');
    console.log('| month | rows | revenue recovered |\n|---|--:|--:|');
    const months = await tx.unsafe(`
      select to_char(v.issued_at at time zone 'America/Lima','YYYY-MM') as ym,
             count(*)::int as n, round(sum(${DERIVED})::numeric,2) as amt
      from fin_invoices v where v.total is null
      group by 1 order by 1`);
    for (const r of months) console.log(`| ${r.ym ?? '(no date)'} | ${r.n} | ${r.amt} |`);

    console.log('\n## 25 largest rows\n');
    console.log('| number | date (Lima) | client | before | after |\n|---|---|---|--:|--:|');
    const top = await tx.unsafe(`
      select v.number, v.client_name,
             to_char(v.issued_at at time zone 'America/Lima','YYYY-MM-DD HH24:MI') as lima,
             round((${DERIVED})::numeric,2) as after
      from fin_invoices v where v.total is null
      order by (${DERIVED}) desc limit 25`);
    for (const r of top) {
      console.log(
        `| ${r.number ?? '—'} | ${r.lima ?? '—'} | ${String(r.client_name ?? '').slice(0, 30)} | NULL | ${r.after} |`,
      );
    }

    console.log('\n## Rows that would stay NULL (no line items to price)\n');
    const none = await tx.unsafe(`
      select v.number, to_char(v.issued_at at time zone 'America/Lima','YYYY-MM-DD') as lima, v.client_name
      from fin_invoices v
      where v.total is null and (select count(*) from fin_invoice_items i where i.invoice_id=v.id) = 0
      order by v.issued_at desc limit 25`);
    if (none.length === 0) console.log('_none — every null-total invoice has line items._');
    else {
      console.log('| number | date (Lima) | client |\n|---|---|---|');
      for (const r of none)
        console.log(
          `| ${r.number ?? '—'} | ${r.lima ?? '—'} | ${String(r.client_name ?? '').slice(0, 30)} |`,
        );
    }
  });
  await client.end();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});

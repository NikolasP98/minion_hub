#!/usr/bin/env bun
/** THROWAWAY read-only. Prove the derived-total formula reconciles Jun-1 to SUSII
 *  (7 sales / S/ 11,100) and size the org-wide impact of the null-total bug. */
import postgres from 'postgres';

const FACES_ORG = '21e0601b-f632-43fd-8414-d644af4271f4';
const url = process.env.SUPABASE_DB_URL?.trim();
if (!url) throw new Error('SUPABASE_DB_URL not set');
const client = postgres(url, { prepare: false, max: 2 });

async function withOrg<T>(orgId: string, fn: (sql: postgres.TransactionSql) => Promise<T>): Promise<T> {
  return client.begin(async (tx) => {
    await tx`set local role app_ledger`;
    await tx`select set_config('app.current_org_id', ${orgId}, true)`;
    return fn(tx);
  });
}

// total = items + tax - discount + other_charges + rounding   (2330/2330 calibrated)
const DERIVED = (alias = 'v') => `
  coalesce((select sum(i.total) from fin_invoice_items i where i.invoice_id = ${alias}.id),0)
  + coalesce((${alias}.metadata->>'tax')::numeric,0)
  - coalesce((${alias}.metadata->>'discount')::numeric,0)
  + coalesce((${alias}.metadata->>'other_charges')::numeric,0)
  + coalesce((${alias}.metadata->>'rounding')::numeric,0)`;

async function main() {
  await withOrg(FACES_ORG, async (tx) => {
    console.log('## Jun-1 reconciliation (SUSII shows 7 sales / S/ 11,100)\n');
    const [a] = await tx.unsafe(`
      select count(*)::int n,
             round(sum(coalesce(v.total, ${DERIVED('v')}))::numeric, 2) as total_with_derivation,
             round(sum(coalesce(v.total, 0))::numeric, 2)               as total_today
      from fin_invoices v
      where (v.issued_at at time zone 'America/Lima')::date = date '2026-06-01'
    `);
    console.log(`Lima calendar day 2026-06-01: ${a.n} sales`);
    console.log(`  total as the hub computes it today : S/ ${a.total_today}`);
    console.log(`  total with derived fallback        : S/ ${a.total_with_derivation}   <-- vs SUSII 11,100`);

    console.log('\n## The 3 rows the dashboard drops for from=to=2026-06-01 (UTC window)\n');
    const miss = await tx.unsafe(`
      select v.number, v.client_name, v.total,
             round((${DERIVED('v')})::numeric,2) as derived,
             to_char(v.issued_at at time zone 'America/Lima','YYYY-MM-DD HH24:MI') as lima
      from fin_invoices v
      where (v.issued_at at time zone 'America/Lima')::date = date '2026-06-01'
        and not (v.issued_at >= '2026-06-01T00:00:00Z'
                 and v.issued_at < '2026-06-01T00:00:00Z'::timestamptz + interval '1 day')
      order by v.issued_at
    `);
    for (const r of miss) {
      console.log(`- #${r.number} ${String(r.client_name).slice(0,26).padEnd(26)} lima=${r.lima} total=${r.total ?? 'NULL'} derived=${r.derived}`);
    }

    console.log('\n## Org-wide impact of the null-total bug\n');
    const [b] = await tx.unsafe(`
      select count(*)::int as docless_rows,
             round(sum(${DERIVED('v')})::numeric,2) as hidden_revenue
      from fin_invoices v where v.total is null
    `);
    const [c] = await tx`select count(*)::int n, round(coalesce(sum(total),0)::numeric,2) as t from fin_invoices`;
    console.log(`invoices with NULL total : ${b.docless_rows} of ${c.n} (${((b.docless_rows / c.n) * 100).toFixed(1)}%)`);
    console.log(`revenue currently counted: S/ ${c.t}`);
    console.log(`revenue MISSING from every finance figure: S/ ${b.hidden_revenue}`);

    console.log('\n## Sanity: does the formula ever disagree with a known doc total?\n');
    const [d] = await tx.unsafe(`
      select count(*)::int as n,
             count(*) filter (where abs(v.total - round((${DERIVED('v')})::numeric,2)) >= 0.02)::int as mismatches,
             round(max(abs(v.total - round((${DERIVED('v')})::numeric,2)))::numeric,4) as worst
      from fin_invoices v where v.total is not null
    `);
    console.log(`checked ${d.n} doc-backed rows -> ${d.mismatches} mismatches (worst delta S/ ${d.worst})`);
  });
  await client.end();
}
main().catch((e) => { console.error(e); process.exit(1); });

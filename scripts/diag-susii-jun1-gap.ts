#!/usr/bin/env bun
/**
 * THROWAWAY read-only diagnostic. Not committed.
 *
 * SUSII "Ventas" shows 7 sales / S/ 11,100 on 2026-06-01; /finances with
 * from=to=2026-06-01 shows 4 invoices / S/ 8,550. Find where the 3 go.
 *
 *   bun scripts/diag-susii-jun1-gap.ts [orgId]
 */
import postgres from 'postgres';

const FACES_ORG = '21e0601b-f632-43fd-8414-d644af4271f4';

const url = process.env.SUPABASE_DB_URL?.trim();
if (!url) throw new Error('SUPABASE_DB_URL not set (check .env.local)');
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

async function main() {
  const orgId = process.argv.slice(2).find((x) => !x.startsWith('--')) ?? FACES_ORG;

  await withOrg(orgId, async (tx) => {
    console.log('## All fin_invoices with issued_at in the Jun-1..Jun-3 UTC neighbourhood\n');
    const rows = await tx`
      select provider_ref, number, document_id, status, total,
             issued_at,
             issued_at at time zone 'UTC'   as utc_ts,
             issued_at at time zone 'America/Lima' as lima_ts,
             (issued_at at time zone 'UTC')::date   as utc_date,
             (issued_at at time zone 'America/Lima')::date as lima_date,
             client_name
      from fin_invoices
      where issued_at >= '2026-05-31' and issued_at < '2026-06-04'
      order by issued_at asc
    `;
    console.log(
      '| ref | number | doc | status | total | raw issued_at | UTC date | Lima date | client |',
    );
    console.log('|---|---|---|---|--:|---|---|---|---|');
    for (const r of rows) {
      console.log(
        `| ${r.provider_ref} | ${r.number ?? '—'} | ${r.document_id ?? '—'} | ${r.status} | ${r.total} | ${String(r.issued_at)} | ${String(r.utc_date)} | ${String(r.lima_date)} | ${String(r.client_name ?? '').slice(0, 28)} |`,
      );
    }
    console.log(`\n(${rows.length} rows)\n`);

    // What the dashboard's periodWhere actually selects for from=to=2026-06-01
    console.log('## What the dashboard query returns for from=to=2026-06-01\n');
    const [dash] = await tx`
      select count(*)::int as invoices, coalesce(sum(total),0)::float8 as total
      from fin_invoices
      where issued_at >= '2026-06-01T00:00:00.000Z'
        and issued_at < ('2026-06-01T00:00:00.000Z'::timestamptz + interval '1 day')
    `;
    console.log(`invoices=${dash.invoices} total=${dash.total}\n`);

    // Same window expressed in Lima local time
    console.log('## Same calendar day in Lima local time (America/Lima)\n');
    const [lima] = await tx`
      select count(*)::int as invoices, coalesce(sum(total),0)::float8 as total
      from fin_invoices
      where (issued_at at time zone 'America/Lima')::date = date '2026-06-01'
    `;
    console.log(`invoices=${lima.invoices} total=${lima.total}\n`);

    // Status split around the boundary (are any void?)
    console.log('## Status split, Jun-1..Jun-2 UTC\n');
    const st = await tx`
      select status, count(*)::int as n, coalesce(sum(total),0)::float8 as total
      from fin_invoices
      where issued_at >= '2026-06-01' and issued_at < '2026-06-03'
      group by status order by n desc
    `;
    for (const r of st) console.log(`- ${r.status}: n=${r.n} total=${r.total}`);
  });

  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

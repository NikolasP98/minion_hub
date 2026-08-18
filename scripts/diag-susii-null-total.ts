#!/usr/bin/env bun
/** THROWAWAY read-only. Why does sale 3554 have total=null? Compare the stored
 *  raw SUSII payload of a null-total sale vs a healthy one, and size the blast radius. */
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

async function main() {
  await withOrg(FACES_ORG, async (tx) => {
    console.log('## Raw SUSII payload: money-ish fields, null-total (3554) vs healthy (3553)\n');
    const rows = await tx`
      select number, total, subtotal, tax, discount,
             metadata->>'total'        as meta_total,
             metadata->>'subtotal'     as meta_subtotal,
             metadata->>'amount'       as meta_amount,
             metadata->>'is_paid'      as meta_is_paid,
             metadata->>'is_active'    as meta_is_active,
             jsonb_array_length(coalesce(metadata->'document_set','[]'::jsonb)) as doc_count,
             (select count(*) from fin_invoice_items i where i.invoice_id = fin_invoices.id) as item_count,
             (select coalesce(sum(i.total),0) from fin_invoice_items i where i.invoice_id = fin_invoices.id) as items_sum
      from fin_invoices
      where number in ('3553','3554','3555','3561')
      order by number
    `;
    for (const r of rows) {
      console.log(
        `#${r.number}: total=${r.total} subtotal=${r.subtotal} | meta.total=${r.meta_total} meta.subtotal=${r.meta_subtotal} meta.amount=${r.meta_amount} | docs=${r.doc_count} items=${r.item_count} items_sum=${r.items_sum} | paid=${r.meta_is_paid} active=${r.meta_is_active}`,
      );
    }

    console.log('\n## Full metadata keys of the null-total sale (3554)\n');
    const [k] = await tx`
      select jsonb_object_keys_agg from (
        select string_agg(k, ', ' order by k) as jsonb_object_keys_agg
        from fin_invoices, jsonb_object_keys(metadata) k
        where number = '3554'
      ) t
    `;
    console.log(k.jsonb_object_keys_agg);

    console.log('\n## Blast radius: null-total invoices org-wide\n');
    const [b] = await tx`
      select count(*)::int as null_total_rows,
             (select count(*)::int from fin_invoices) as all_rows,
             (select coalesce(sum(i.total),0)::float8
                from fin_invoice_items i
                join fin_invoices v on v.id = i.invoice_id
               where v.total is null) as recoverable_from_items
      from fin_invoices where total is null
    `;
    console.log(`null-total rows: ${b.null_total_rows} / ${b.all_rows}`);
    console.log(`revenue recoverable by summing their items: S/ ${b.recoverable_from_items}`);

    console.log('\n## Do null-total rows have a document_set? (docs vs no-docs split)\n');
    const split = await tx`
      select jsonb_array_length(coalesce(metadata->'document_set','[]'::jsonb)) as docs,
             count(*)::int as n
      from fin_invoices where total is null
      group by 1 order by 1
    `;
    for (const r of split) console.log(`- document_set length ${r.docs}: ${r.n} rows`);
  });
  await client.end();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});

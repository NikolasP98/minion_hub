#!/usr/bin/env bun
/** THROWAWAY read-only. `sale.total` doesn't exist in the SUSII payload — the only
 *  source is document_set[0].total. Can a correct total be derived for docless sales?
 *  Calibrate against sales where the document DID give us a known-good total. */
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

async function main() {
  await withOrg(FACES_ORG, async (tx) => {
    console.log('## Item rows + sale-level money fields (3553 known=1200, 3554 docless SUSII=1300)\n');
    const items = await tx`
      select v.number, v.total as sale_total,
             i.description, i.quantity, i.unit_price, i.discount, i.tax, i.total as item_total,
             v.metadata->>'tax' as m_tax,
             v.metadata->>'discount' as m_discount,
             v.metadata->>'discount_with_tax' as m_disc_wtax,
             v.metadata->>'discount_amount_with_tax' as m_disc_amt_wtax,
             v.metadata->>'discount_percent' as m_disc_pct,
             v.metadata->>'other_charges' as m_other,
             v.metadata->>'rounding' as m_round,
             v.metadata->>'prepaid_amount' as m_prepaid,
             v.metadata->>'service_charge' as m_svc
      from fin_invoices v join fin_invoice_items i on i.invoice_id = v.id
      where v.number in ('3553','3554','3555')
      order by v.number
    `;
    for (const r of items) {
      console.log(
        `#${r.number} saleTotal=${r.sale_total} | item: qty=${r.quantity} price=${r.unit_price} disc=${r.discount} tax=${r.tax} total=${r.item_total}`,
      );
      console.log(
        `        meta: tax=${r.m_tax} discount=${r.m_discount} disc_wtax=${r.m_disc_wtax} disc_amt_wtax=${r.m_disc_amt_wtax} disc_pct=${r.m_disc_pct} other=${r.m_other} round=${r.m_round} prepaid=${r.m_prepaid} svc=${r.m_svc}`,
      );
    }

    // Calibrate a candidate formula on rows where we KNOW the answer (doc present).
    console.log('\n## Calibrate candidate formulas against known-good totals (doc-backed rows)\n');
    const [c] = await tx`
      with base as (
        select v.id, v.total as known,
               coalesce((select sum(i.total) from fin_invoice_items i where i.invoice_id=v.id),0)::numeric as items_sum,
               coalesce((v.metadata->>'tax')::numeric,0)          as m_tax,
               coalesce((v.metadata->>'discount')::numeric,0)     as m_disc,
               coalesce((v.metadata->>'other_charges')::numeric,0) as m_other,
               coalesce((v.metadata->>'rounding')::numeric,0)      as m_round
        from fin_invoices v
        where v.total is not null
      )
      select count(*)::int as n,
             count(*) filter (where abs(known - round(items_sum + m_tax - m_disc + m_other + m_round, 2)) < 0.02)::int as f_items_plus_tax,
             count(*) filter (where abs(known - round(items_sum * 1.18, 2)) < 0.02)::int as f_items_x118,
             count(*) filter (where abs(known - round(items_sum, 2)) < 0.02)::int as f_items_only
      from base
    `;
    console.log(`doc-backed rows: ${c.n}`);
    console.log(`  items_sum + tax - discount + other + rounding  matches: ${c.f_items_plus_tax}`);
    console.log(`  items_sum * 1.18                              matches: ${c.f_items_x118}`);
    console.log(`  items_sum                                     matches: ${c.f_items_only}`);
  });
  await client.end();
}
main().catch((e) => { console.error(e); process.exit(1); });

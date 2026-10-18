import { sql } from 'drizzle-orm';
import type { CoreCtx } from '$server/auth/core-ctx';
import { withOrgCore } from '$server/db/with-org-core';
import { CATALOG_QUERY_CONTRACT, type CatalogKind } from './catalog-query-contract';
import { getPosCurrencyInTx } from './settings';
import { storedDecimalNumber } from './money';

interface CatalogPriceRow {
  productId: string;
  code: string;
  name: string;
  kind: Exclude<CatalogKind, 'all'>;
  unitPrice: string;
}
type CatalogSummary = {
  matched_count: number;
  missing_price_count: number;
  max_price: string | null;
  tied_at_maximum: number;
  items: CatalogPriceRow[];
};

/** Rank in the database: a large catalog never becomes a large model response. */
export async function queryCatalogPrices(ctx: CoreCtx, kind: CatalogKind, limit: number) {
  return withOrgCore(ctx, async (tx) => {
    const currency = await getPosCurrencyInTx(tx, ctx.tenantId);
    const [summary] = await tx.execute<CatalogSummary>(sql`
      with active as (
        select p.id, p.code, p.name, p.unit_price,
          case when exists (
            select 1 from fin_product_components c
            where c.bundle_product_id = p.id and c.org_id = p.org_id
          ) then 'bundle' when p.kind = 'product' then 'product' else 'service' end as kind
        from fin_products p where p.org_id = ${ctx.tenantId} and p.active = true
      ), eligible as (
        select * from active where ${kind} = 'all' or kind = ${kind}
      ), ranked as (
        select * from eligible where unit_price is not null
        order by unit_price desc, name, id limit ${limit}
      )
      select count(*)::int as matched_count,
        count(*) filter (where unit_price is null)::int as missing_price_count,
        max(unit_price)::text as max_price,
        (select count(*)::int from eligible where unit_price = (select max(unit_price) from eligible)) as tied_at_maximum,
        coalesce((select jsonb_agg(jsonb_build_object(
          'productId', id, 'code', code, 'name', name, 'kind', kind, 'unitPrice', unit_price::text
        ) order by unit_price desc, name, id) from ranked), '[]'::jsonb) as items
      from eligible
    `);
    if (!summary) throw new Error('Catalog query returned no summary');
    const source = CATALOG_QUERY_CONTRACT.source;
    const items = summary.items.map((item) => ({
      ...item,
      unitPrice: storedDecimalNumber(item.unitPrice),
      source,
    }));
    return {
      asOf: new Date().toISOString(),
      orgId: ctx.tenantId,
      currency,
      currencySource: 'pos_settings',
      kind,
      items,
      matchedCount: summary.matched_count,
      missingPriceCount: summary.missing_price_count,
      maxPrice: summary.max_price === null ? null : storedDecimalNumber(summary.max_price),
      tiedAtMaximum: summary.tied_at_maximum,
      truncated: summary.matched_count - summary.missing_price_count > items.length,
      source,
    };
  });
}

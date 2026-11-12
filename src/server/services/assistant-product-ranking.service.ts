import { sql } from 'drizzle-orm';
import { withOrgCore } from '$server/db/with-org-core';
import type { CoreCtx } from '$server/auth/core-ctx';
import type { Period } from '$lib/finance/period';

export type AssistantRankingMetric = 'revenue' | 'quantity' | 'margin';
interface RankingRow {
  productId: string | null;
  code: string | null;
  name: string | null;
  value: number;
  rank: number;
}
interface RankingGroup {
  currency: string | null;
  total: number;
  returned: number;
  truncated: boolean;
  tieTruncated: boolean;
  rows: RankingRow[];
}

/** Invoice-item rankings. POS-only sales and missing product costs are not inferred. */
export async function assistantProductRanking(
  ctx: CoreCtx,
  period: Period,
  options: { metric: AssistantRankingMetric; limit: number; allowCost?: boolean },
) {
  const { metric, limit } = options;
  if (!['revenue', 'quantity', 'margin'].includes(metric))
    throw new Error('invalid ranking metric');
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new Error('invalid ranking limit');
  const base = {
    metric,
    unit: metric === 'quantity' ? 'invoice_item_quantity' : 'invoice_item_total',
    source: 'nonvoid_unshadowed_invoice_items',
    coverage:
      'Identifiable invoice items only; excludes POS-only sales and does not infer product costs. Unidentified invoice rows are disclosed separately; no whole-business winner is established.',
    period,
    limit,
    monetaryCurrenciesCombined: false,
    groups: [] as RankingGroup[],
    totalCurrencies: 0,
    currenciesTruncated: false,
    unidentifiedLineCount: 0,
    wholeBusinessCoverage: 'not_established',
  };
  if (metric === 'margin') {
    return {
      ...base,
      status: 'unavailable' as const,
      reason:
        options.allowCost === false
          ? 'sensitive_cost_access_denied'
          : 'product_cost_attribution_unavailable',
    };
  }
  const monetary = metric === 'revenue';
  const conditions = [
    sql`inv.org_id = current_setting('app.current_org_id', true)`,
    sql`inv.shadowed = false`,
    sql`inv.status is distinct from 'void'`,
  ];
  if (period.from) conditions.push(sql`inv.issued_at >= ${period.from}`);
  if (period.to) conditions.push(sql`inv.issued_at < ${period.to}`);
  const currency = monetary
    ? sql`coalesce(nullif(inv.currency, ''), 'unspecified')`
    : sql`null::text`;
  const value = monetary ? sql`ii.total::numeric` : sql`ii.quantity::numeric`;
  const code = sql`nullif(btrim(ii.code), '')`;
  const identified = sql`(ii.product_id is not null or ${code} is not null)`;
  return withOrgCore(ctx, async (tx) => {
    // Ranking, population and the extra boundary row use one statement/snapshot.
    // Limit currency groups too: imported currency strings are not a trusted enum.
    const raw = (await tx.execute(sql`
      with aggregated as (
        select coalesce('id:' || ii.product_id::text, 'code:' || ${code}) product_key,
          max(ii.product_id::text) product_id, max(${code}) code,
          coalesce(max(p.name), max(ii.description)) name,
          ${currency} currency, coalesce(sum(${value}), 0)::float8 value
        from fin_invoice_items ii
        join fin_invoices inv on inv.id = ii.invoice_id
        left join fin_products p on p.id = ii.product_id and p.org_id = inv.org_id
        where ${sql.join(conditions, sql` and `)} and ${identified}
        group by coalesce('id:' || ii.product_id::text, 'code:' || ${code}), ${currency}
      ), numbered as (
        select *, row_number() over(partition by currency order by value desc, product_key) ordinal,
          dense_rank() over(partition by currency order by value desc) rank,
          count(*) over(partition by currency)::int total,
          dense_rank() over(order by currency nulls first) currency_ordinal
        from aggregated
      ), currency_count as (select count(*)::int total_currencies from (select distinct currency from aggregated) c),
      unidentified_count as (
        select count(*)::int unidentified_lines from fin_invoice_items ii
        join fin_invoices inv on inv.id = ii.invoice_id
        where ${sql.join(conditions, sql` and `)} and not ${identified}
      )
      select numbered.*, currency_count.total_currencies, unidentified_count.unidentified_lines
      from currency_count cross join unidentified_count
      left join numbered on ordinal <= ${limit + 1} and currency_ordinal <= 20
      order by currency nulls first, ordinal
    `)) as unknown as Array<Record<string, unknown>>;
    const groups = new Map<string | null, typeof raw>();
    for (const row of raw) {
      if (row.product_key == null) continue;
      if (!Number.isFinite(Number(row.value))) throw new Error('Non-finite invoice ranking value');
      const key = row.currency == null ? null : String(row.currency);
      const list = groups.get(key) ?? [];
      list.push(row);
      groups.set(key, list);
    }
    const output: RankingGroup[] = [...groups].map(([currency, rows]) => {
      const selected = rows.slice(0, limit);
      const total = Number(rows[0].total);
      return {
        currency,
        total,
        returned: selected.length,
        truncated: total > selected.length,
        tieTruncated:
          rows.length > limit && Number(rows[limit].value) === Number(selected.at(-1)?.value),
        rows: selected.map((row) => ({
          productId: row.product_id == null ? null : String(row.product_id),
          code: row.code == null ? null : String(row.code),
          name: row.name == null ? null : String(row.name),
          value: Number(row.value),
          rank: Number(row.rank),
        })),
      };
    });
    const totalCurrencies = Number(raw[0]?.total_currencies ?? 0);
    return {
      ...base,
      status: 'available' as const,
      groups: output,
      totalCurrencies,
      currenciesTruncated: totalCurrencies > output.length,
      unidentifiedLineCount: Number(raw[0]?.unidentified_lines ?? 0),
    };
  });
}

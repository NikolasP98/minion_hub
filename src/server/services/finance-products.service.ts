import { and, eq, sql, inArray } from 'drizzle-orm';
import { withOrgCore } from '$server/db/with-org-core';
import type { CoreCtx } from '$server/auth/core-ctx';
import { finProducts, finInvoiceItems, finProductCategories } from '$server/db/pg-finance-schema';
import { bustFinanceCache } from './finance.service';

export async function listProducts(ctx: CoreCtx) {
  return withOrgCore(ctx, async (tx) => {
    const rows = (await tx.execute(sql`
      select p.id, p.code, p.name, p.category, p.unit_price, p.active,
             count(i.id)::int as billed, coalesce(sum(i.total),0)::float8 as revenue
      from fin_products p
      left join fin_invoice_items i on i.product_id = p.id and i.org_id = p.org_id
      where p.org_id = ${ctx.tenantId}
      group by p.id order by revenue desc, p.name
    `)) as unknown as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: String(r.id),
      code: String(r.code),
      name: String(r.name),
      category: r.category != null ? String(r.category) : null,
      unitPrice: r.unit_price != null ? Number(r.unit_price) : null,
      active: r.active === true,
      billed: Number(r.billed),
      revenue: Number(r.revenue),
    }));
  });
}

/**
 * Same billed-count + revenue-sum join as `listProducts`, keyed by product id
 * and scoped to just the given ids — the catalog page (/pos/catalog) merges
 * this into `listSellables` output rather than folding it into
 * `SELLABLE_MERGE_SQL`, so other `listSellables` callers (POS sell screen,
 * gateway query) stay untouched.
 */
export async function billingForProducts(
  ctx: CoreCtx,
  productIds: string[],
): Promise<Map<string, { billed: number; revenue: number }>> {
  const out = new Map<string, { billed: number; revenue: number }>();
  if (productIds.length === 0) return out;
  return withOrgCore(ctx, async (tx) => {
    const rows = await tx
      .select({
        productId: finInvoiceItems.productId,
        billed: sql<number>`count(*)::int`,
        revenue: sql<number>`coalesce(sum(${finInvoiceItems.total}),0)::float8`,
      })
      .from(finInvoiceItems)
      .where(
        and(
          eq(finInvoiceItems.orgId, ctx.tenantId),
          inArray(finInvoiceItems.productId, productIds),
        ),
      )
      .groupBy(finInvoiceItems.productId);
    for (const r of rows) {
      if (r.productId)
        out.set(r.productId, { billed: Number(r.billed), revenue: Number(r.revenue) });
    }
    return out;
  });
}

/**
 * `productId → its category's colour`, for the calendar's interchangeable event
 * colouring. The category is plain text on `fin_products`; its colour is
 * org-owned data on `fin_product_categories`, bound by `(org_id, name)` — the
 * inner join is the whole resolution, and a product with no (or an unknown)
 * category simply has no entry.
 */
export async function categoryColorsForProducts(
  ctx: CoreCtx,
  productIds: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (productIds.length === 0) return out;
  const rows = await withOrgCore(ctx, (tx) =>
    tx
      .select({ id: finProducts.id, color: finProductCategories.color })
      .from(finProducts)
      .innerJoin(
        finProductCategories,
        and(
          eq(finProductCategories.orgId, finProducts.orgId),
          eq(finProductCategories.name, finProducts.category),
        ),
      )
      .where(and(eq(finProducts.orgId, ctx.tenantId), inArray(finProducts.id, productIds))),
  );
  for (const r of rows) out.set(r.id, r.color);
  return out;
}

export async function upsertProduct(
  ctx: CoreCtx,
  p: {
    code: string;
    name: string;
    category: string | null;
    unitPrice: number | null;
    active: boolean;
  },
) {
  await withOrgCore(ctx, (tx) =>
    tx
      .insert(finProducts)
      .values({
        orgId: ctx.tenantId,
        code: p.code,
        name: p.name,
        category: p.category,
        unitPrice: p.unitPrice == null ? null : String(p.unitPrice),
        active: p.active,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [finProducts.orgId, finProducts.code],
        set: {
          name: p.name,
          category: p.category,
          unitPrice: p.unitPrice == null ? null : String(p.unitPrice),
          active: p.active,
          updatedAt: new Date(),
        },
      }),
  );
  await bustFinanceCache(ctx);
}

export async function catalogCoverage(ctx: CoreCtx) {
  return withOrgCore(ctx, async (tx) => {
    const [row] = (await tx.execute(sql`
      select
        (select count(*) from fin_products where org_id = ${ctx.tenantId})::int as cataloged,
        (select count(distinct i.code) from fin_invoice_items i
           where i.org_id = ${ctx.tenantId} and i.code is not null and i.code <> ''
           and not exists (select 1 from fin_products p where p.org_id = i.org_id and p.code = i.code))::int as billed_not_in_catalog,
        (select count(*) from fin_products p where p.org_id = ${ctx.tenantId}
           and not exists (select 1 from fin_invoice_items i where i.org_id = p.org_id and i.code = p.code))::int as catalog_never_billed
    `)) as unknown as Array<{
      cataloged: number;
      billed_not_in_catalog: number;
      catalog_never_billed: number;
    }>;
    return {
      cataloged: Number(row.cataloged),
      billedNotInCatalog: Number(row.billed_not_in_catalog),
      catalogNeverBilled: Number(row.catalog_never_billed),
    };
  });
}

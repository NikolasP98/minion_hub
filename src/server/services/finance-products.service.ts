import { and, eq, sql } from 'drizzle-orm';
import { withOrgCore } from '$server/db/with-org-core';
import type { CoreCtx } from '$server/auth/core-ctx';
import { finProducts } from '$server/db/pg-finance-schema';
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
      id: String(r.id), code: String(r.code), name: String(r.name),
      category: r.category != null ? String(r.category) : null,
      unitPrice: r.unit_price != null ? Number(r.unit_price) : null, active: r.active === true,
      billed: Number(r.billed), revenue: Number(r.revenue),
    }));
  });
}

export async function upsertProduct(
  ctx: CoreCtx, p: { code: string; name: string; category: string | null; unitPrice: number | null; active: boolean },
) {
  await withOrgCore(ctx, (tx) =>
    tx.insert(finProducts).values({
      orgId: ctx.tenantId, code: p.code, name: p.name, category: p.category,
      unitPrice: p.unitPrice == null ? null : String(p.unitPrice), active: p.active, updatedAt: new Date(),
    }).onConflictDoUpdate({
      target: [finProducts.orgId, finProducts.code],
      set: { name: p.name, category: p.category, unitPrice: p.unitPrice == null ? null : String(p.unitPrice), active: p.active, updatedAt: new Date() },
    }),
  );
  await bustFinanceCache(ctx);
}

export async function deactivateProduct(ctx: CoreCtx, id: string) {
  await withOrgCore(ctx, (tx) =>
    tx.update(finProducts).set({ active: false, updatedAt: new Date() })
      .where(and(eq(finProducts.id, id), eq(finProducts.orgId, ctx.tenantId))),
  );
  await bustFinanceCache(ctx);
}

/** Seed the catalog from distinct billed codes (latest description as name); link items. */
export async function importFromBilling(ctx: CoreCtx): Promise<{ created: number; linked: number }> {
  return withOrgCore(ctx, async (tx) => {
    const created = (await tx.execute(sql`
      insert into fin_products (org_id, code, name)
      select org_id, code, (array_agg(description order by id desc))[1]
      from fin_invoice_items where org_id = ${ctx.tenantId} and code is not null and code <> ''
      group by org_id, code
      on conflict (org_id, code) do nothing
      returning id
    `)) as unknown as unknown[];
    const linked = (await tx.execute(sql`
      update fin_invoice_items i set product_id = p.id from fin_products p
      where i.org_id = ${ctx.tenantId} and p.org_id = i.org_id and p.code = i.code and i.product_id is null
      returning i.id
    `)) as unknown as unknown[];
    await bustFinanceCache(ctx);
    return { created: created.length, linked: linked.length };
  });
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
    `)) as unknown as Array<{ cataloged: number; billed_not_in_catalog: number; catalog_never_billed: number }>;
    return { cataloged: Number(row.cataloged), billedNotInCatalog: Number(row.billed_not_in_catalog), catalogNeverBilled: Number(row.catalog_never_billed) };
  });
}

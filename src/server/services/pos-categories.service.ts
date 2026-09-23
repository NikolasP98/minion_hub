import { and, asc, eq } from 'drizzle-orm';
import { invalidateTags, tags } from '@minion-stack/cache';
import type { CoreCtx } from '$server/auth/core-ctx';
import { finProductCategories } from '$server/db/pg-finance-schema';
import { withOrgCore } from '$server/db/with-org-core';
import { PRODUCT_CATEGORY_COLORS, type ProductCategoryColor } from '$lib/catalog/categories';
import { bustFinanceCache } from './finance.service';

export interface ProductCategory {
  id: string;
  name: string;
  color: ProductCategoryColor;
}

export class ProductCategoryError extends Error {
  constructor(
    message: string,
    readonly code: 'duplicate' | 'not_found' | 'invalid_color',
  ) {
    super(message);
  }
}

function pgCode(error: unknown): string | undefined {
  let current = error;
  for (let depth = 0; depth < 4 && current && typeof current === 'object'; depth++) {
    const candidate = current as { code?: unknown; cause?: unknown };
    if (typeof candidate.code === 'string') return candidate.code;
    current = candidate.cause;
  }
}

function assertColor(color: string): asserts color is ProductCategoryColor {
  if (!(PRODUCT_CATEGORY_COLORS as readonly string[]).includes(color)) {
    throw new ProductCategoryError('unsupported category color', 'invalid_color');
  }
}

function map(row: typeof finProductCategories.$inferSelect): ProductCategory {
  assertColor(row.color);
  return { id: row.id, name: row.name, color: row.color };
}

async function bust(ctx: CoreCtx) {
  await Promise.all([
    invalidateTags([...tags.tenantDomain(ctx.tenantId, 'pos')]),
    bustFinanceCache(ctx),
  ]);
}

export async function listProductCategories(ctx: CoreCtx): Promise<ProductCategory[]> {
  const rows = await withOrgCore(ctx, (tx) =>
    tx
      .select()
      .from(finProductCategories)
      .where(eq(finProductCategories.orgId, ctx.tenantId))
      .orderBy(asc(finProductCategories.name)),
  );
  return rows.map(map);
}

export async function createProductCategory(
  ctx: CoreCtx,
  input: { name: string; color: string },
): Promise<ProductCategory> {
  assertColor(input.color);
  try {
    const [row] = await withOrgCore(ctx, (tx) =>
      tx
        .insert(finProductCategories)
        .values({ orgId: ctx.tenantId, name: input.name, color: input.color })
        .returning(),
    );
    await bust(ctx);
    return map(row);
  } catch (error) {
    if (pgCode(error) === '23505')
      throw new ProductCategoryError('category already exists', 'duplicate');
    throw error;
  }
}

/** Compatibility bridge for the existing catalog creation wizard and gateway
 * callers that intentionally create a sellable with a new category string.
 * Updates never call this, so a stale PATCH cannot resurrect a deleted option. */
export async function ensureProductCategory(ctx: CoreCtx, name: string): Promise<void> {
  const inserted = await withOrgCore(ctx, (tx) =>
    tx
      .insert(finProductCategories)
      .values({ orgId: ctx.tenantId, name, color: PRODUCT_CATEGORY_COLORS[0] })
      .onConflictDoNothing({ target: [finProductCategories.orgId, finProductCategories.name] })
      .returning({ id: finProductCategories.id }),
  );
  if (inserted.length) await bust(ctx);
}

export async function updateProductCategory(
  ctx: CoreCtx,
  id: string,
  patch: { name?: string; color?: string },
): Promise<ProductCategory> {
  if (patch.color !== undefined) assertColor(patch.color);
  try {
    const [row] = await withOrgCore(ctx, (tx) =>
      tx
        .update(finProductCategories)
        .set({ ...patch, updatedAt: new Date() })
        .where(and(eq(finProductCategories.id, id), eq(finProductCategories.orgId, ctx.tenantId)))
        .returning(),
    );
    if (!row) throw new ProductCategoryError('category not found', 'not_found');
    await bust(ctx);
    return map(row);
  } catch (error) {
    if (pgCode(error) === '23505')
      throw new ProductCategoryError('category already exists', 'duplicate');
    throw error;
  }
}

export async function deleteProductCategory(ctx: CoreCtx, id: string): Promise<boolean> {
  const rows = await withOrgCore(ctx, (tx) =>
    tx
      .delete(finProductCategories)
      .where(and(eq(finProductCategories.id, id), eq(finProductCategories.orgId, ctx.tenantId)))
      .returning({ id: finProductCategories.id }),
  );
  if (rows.length) await bust(ctx);
  return rows.length > 0;
}

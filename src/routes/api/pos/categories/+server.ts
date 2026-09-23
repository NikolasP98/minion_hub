import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { getCoreCtx } from '$server/auth/core-ctx';
import { parseBody } from '$server/api/validate';
import { requireOrgCapability } from '$server/services/rbac.service';
import { isModuleEnabled } from '$server/services/modules.service';
import {
  createProductCategory,
  listProductCategories,
  ProductCategoryError,
} from '$server/services/pos-categories.service';
import { PRODUCT_CATEGORY_COLORS } from '$lib/catalog/categories';

const bodySchema = z.object({
  name: z.string().trim().min(1).max(200),
  color: z.enum(PRODUCT_CATEGORY_COLORS),
});

export const GET: RequestHandler = async ({ locals }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'pos'))) throw error(404);
  await requireOrgCapability(locals, 'pos', 'view');
  return json({ categories: await listProductCategories(ctx) });
};

export const POST: RequestHandler = async ({ locals, request }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'pos'))) throw error(404);
  await requireOrgCapability(locals, 'pos', 'edit');
  const body = await parseBody(request, bodySchema);
  try {
    return json({ category: await createProductCategory(ctx, body) }, { status: 201 });
  } catch (cause) {
    if (cause instanceof ProductCategoryError && cause.code === 'duplicate')
      throw error(409, cause.message);
    throw cause;
  }
};

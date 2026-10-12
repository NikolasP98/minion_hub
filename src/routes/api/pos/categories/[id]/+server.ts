import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { getCoreCtx } from '$server/auth/core-ctx';
import { parseBody } from '$server/api/validate';
import { requireOrgCapability } from '$server/services/rbac.service';
import { isModuleEnabled } from '$server/services/modules.service';
import {
  deleteProductCategory,
  ProductCategoryError,
  updateProductCategory,
} from '$server/services/pos-categories.service';
import { PRODUCT_CATEGORY_COLORS } from '$lib/catalog/categories';
import { StaleWriteError } from '$server/services/errors';

const patchSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    color: z.enum(PRODUCT_CATEGORY_COLORS).optional(),
    expectedUpdatedAt: z.coerce.date().optional(),
  })
  .refine((value) => value.name !== undefined || value.color !== undefined);

export const PATCH: RequestHandler = async ({ locals, params, request }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'pos'))) throw error(404);
  await requireOrgCapability(locals, 'pos', 'edit');
  const id = z.string().uuid().safeParse(params.id);
  if (!id.success) throw error(404);
  const { expectedUpdatedAt, ...body } = await parseBody(request, patchSchema);
  try {
    return json({ category: await updateProductCategory(ctx, id.data, body, expectedUpdatedAt) });
  } catch (cause) {
    if (cause instanceof StaleWriteError)
      return json({ error: 'stale', current: cause.current }, { status: 409 });
    if (cause instanceof ProductCategoryError) {
      if (cause.code === 'not_found') throw error(404, cause.message);
      if (cause.code === 'duplicate') throw error(409, cause.message);
    }
    throw cause;
  }
};

export const DELETE: RequestHandler = async ({ locals, params }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'pos'))) throw error(404);
  await requireOrgCapability(locals, 'pos', 'edit');
  const id = z.string().uuid().safeParse(params.id);
  if (!id.success) throw error(404);
  if (!(await deleteProductCategory(ctx, id.data))) throw error(404, 'category not found');
  return new Response(null, { status: 204 });
};

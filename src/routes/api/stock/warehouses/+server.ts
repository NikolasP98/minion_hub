import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { getCoreCtx } from '$server/auth/core-ctx';
import { parseBody } from '$server/api/validate';
import { isModuleEnabled } from '$server/services/modules.service';
import { listWarehouses, createWarehouse } from '$server/services/stock.service';
import { handleStockError } from '../_errors';

const postSchema = z.object({
  name: z.string().min(1).max(500),
  parentId: z.string().max(200).nullable().optional(),
});

/** GET /api/stock/warehouses */
export const GET: RequestHandler = async ({ locals }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'stock'))) throw error(404);
  return json(await listWarehouses(ctx));
};

/** POST /api/stock/warehouses */
export const POST: RequestHandler = async ({ locals, request }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'stock'))) throw error(404);
  const body = await parseBody(request, postSchema);
  try {
    const warehouse = await createWarehouse(ctx, body);
    return json(warehouse, { status: 201 });
  } catch (e) {
    handleStockError(e);
  }
};

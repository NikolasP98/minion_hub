import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { getCoreCtx } from '$server/auth/core-ctx';
import { parseBody } from '$server/api/validate';
import { updateWarehouse } from '$server/services/stock.service';
import { handleStockError } from '../../_errors';

const patchSchema = z.object({
  name: z.string().min(1).max(500).optional(),
  parentId: z.string().max(200).nullable().optional(),
});

/** PATCH /api/stock/warehouses/:id */
export const PATCH: RequestHandler = async ({ locals, params, request }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const body = await parseBody(request, patchSchema);
  try {
    const warehouse = await updateWarehouse(ctx, params.id!, body);
    if (!warehouse) throw error(404);
    return json(warehouse);
  } catch (e) {
    handleStockError(e);
  }
};

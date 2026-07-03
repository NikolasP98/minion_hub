import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { getCoreCtx } from '$server/auth/core-ctx';
import { parseBody } from '$server/api/validate';
import { isModuleEnabled } from '$server/services/modules.service';
import { listItems, createItem } from '$server/services/stock.service';
import { handleStockError } from '../_errors';

const postSchema = z.object({
  code: z.string().min(1).max(200),
  name: z.string().min(1).max(500),
  uom: z.string().min(1).max(50).optional(),
  itemGroup: z.string().max(200).nullable().optional(),
  isStockItem: z.boolean().optional(),
  reorderLevel: z.number().nonnegative().nullable().optional(),
  reorderQty: z.number().nonnegative().nullable().optional(),
  finProductId: z.string().max(200).nullable().optional(),
});

/** GET /api/stock/items */
export const GET: RequestHandler = async ({ locals }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'stock'))) throw error(404);
  return json(await listItems(ctx));
};

/** POST /api/stock/items */
export const POST: RequestHandler = async ({ locals, request }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'stock'))) throw error(404);
  const body = await parseBody(request, postSchema);
  try {
    const item = await createItem(ctx, {
      code: body.code,
      name: body.name,
      uom: body.uom ?? 'unit',
      itemGroup: body.itemGroup ?? null,
      isStockItem: body.isStockItem ?? true,
      reorderLevel: body.reorderLevel == null ? null : String(body.reorderLevel),
      reorderQty: body.reorderQty == null ? null : String(body.reorderQty),
      finProductId: body.finProductId ?? null,
    });
    return json(item, { status: 201 });
  } catch (e) {
    handleStockError(e);
  }
};

import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { getCoreCtx } from '$server/auth/core-ctx';
import { parseBody } from '$server/api/validate';
import { isModuleEnabled } from '$server/services/modules.service';
import { listConsumption, setConsumption } from '$server/services/stock.service';
import { handleStockError } from '../_errors';

const postSchema = z.object({
  finProductId: z.string().min(1),
  itemId: z.string().min(1),
  qtyPerUnit: z.number().positive(),
  note: z.string().max(2_000).nullable().optional(),
});

/** GET /api/stock/consumption?finProductId=&itemId= — the fin_product → stk_item map. */
export const GET: RequestHandler = async ({ locals, url }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'stock'))) throw error(404);
  return json(
    await listConsumption(ctx, {
      finProductId: url.searchParams.get('finProductId') ?? undefined,
      itemId: url.searchParams.get('itemId') ?? undefined,
    }),
  );
};

/** POST /api/stock/consumption — upsert on (finProductId, itemId). */
export const POST: RequestHandler = async ({ locals, request }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'stock'))) throw error(404);
  const body = await parseBody(request, postSchema);
  try {
    const row = await setConsumption(ctx, { ...body, note: body.note ?? null });
    return json(row, { status: 201 });
  } catch (e) {
    handleStockError(e);
  }
};

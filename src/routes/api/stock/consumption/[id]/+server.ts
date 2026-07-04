import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { getCoreCtx } from '$server/auth/core-ctx';
import { parseBody } from '$server/api/validate';
import { isModuleEnabled } from '$server/services/modules.service';
import { getConsumptionById, setConsumption, deleteConsumption } from '$server/services/stock.service';
import { handleStockError } from '../../_errors';

const patchSchema = z.object({
  qtyPerUnit: z.number().positive().optional(),
  note: z.string().max(2_000).nullable().optional(),
});

/** PATCH /api/stock/consumption/:id — partial update (qtyPerUnit and/or note);
 *  routes through setConsumption's upsert since the unique key is
 *  (org, finProductId, itemId), not id. */
export const PATCH: RequestHandler = async ({ locals, params, request }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'stock'))) throw error(404);
  const body = await parseBody(request, patchSchema);
  try {
    const cur = await getConsumptionById(ctx, params.id!);
    if (!cur) throw error(404);
    const row = await setConsumption(ctx, {
      finProductId: cur.finProductId,
      itemId: cur.itemId,
      qtyPerUnit: body.qtyPerUnit ?? Number(cur.qtyPerUnit),
      note: body.note === undefined ? cur.note : body.note,
    });
    return json(row);
  } catch (e) {
    handleStockError(e);
  }
};

/** DELETE /api/stock/consumption/:id */
export const DELETE: RequestHandler = async ({ locals, params }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'stock'))) throw error(404);
  try {
    const ok = await deleteConsumption(ctx, params.id!);
    if (!ok) throw error(404);
    return json({ ok: true });
  } catch (e) {
    handleStockError(e);
  }
};

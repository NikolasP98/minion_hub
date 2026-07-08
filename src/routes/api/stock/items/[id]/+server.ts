import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { getCoreCtx } from '$server/auth/core-ctx';
import { parseBody } from '$server/api/validate';
import { updateItem } from '$server/services/stock.service';
import { handleStockError } from '../../_errors';

// No cross-field (consumptionUom ⇒ unitsPerStockUom) .refine() here — a PATCH
// is partial, so the merged-with-current-row check has to happen service-side
// (updateItem, via validateItemUomConfig) where the existing row is known.
const patchSchema = z.object({
  code: z.string().min(1).max(200).optional(),
  name: z.string().min(1).max(500).optional(),
  uom: z.string().min(1).max(50).optional(),
  itemGroup: z.string().max(200).nullable().optional(),
  isStockItem: z.boolean().optional(),
  reorderLevel: z.number().nonnegative().nullable().optional(),
  reorderQty: z.number().nonnegative().nullable().optional(),
  finProductId: z.string().max(200).nullable().optional(),
  consumptionUom: z.string().min(1).max(50).nullable().optional(),
  unitsPerStockUom: z.number().positive().nullable().optional(),
  subunitsPerStockUom: z.number().positive().nullable().optional(),
  diagramEnabled: z.boolean().optional(),
  unitSvg: z.string().max(50).nullable().optional(),
  subunitSvg: z.string().max(50).nullable().optional(),
});

/** PATCH /api/stock/items/:id */
export const PATCH: RequestHandler = async ({ locals, params, request }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const body = await parseBody(request, patchSchema);
  try {
    const item = await updateItem(ctx, params.id!, {
      ...body,
      reorderLevel: body.reorderLevel === undefined ? undefined : body.reorderLevel == null ? null : String(body.reorderLevel),
      reorderQty: body.reorderQty === undefined ? undefined : body.reorderQty == null ? null : String(body.reorderQty),
      unitsPerStockUom: body.unitsPerStockUom === undefined ? undefined : body.unitsPerStockUom == null ? null : String(body.unitsPerStockUom),
      subunitsPerStockUom:
        body.subunitsPerStockUom === undefined ? undefined : body.subunitsPerStockUom == null ? null : String(body.subunitsPerStockUom),
    });
    if (!item) throw error(404);
    return json(item);
  } catch (e) {
    handleStockError(e);
  }
};

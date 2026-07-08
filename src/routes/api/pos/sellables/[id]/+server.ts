import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { getCoreCtx } from '$server/auth/core-ctx';
import { parseBody } from '$server/api/validate';
import { isModuleEnabled } from '$server/services/modules.service';
import { updateSellable } from '$server/services/pos.service';
import { handlePosError } from '../../_errors';

const consumptionSchema = z.object({
  itemId: z.string().min(1),
  qtyPerUnit: z.number().finite(),
});

const patchSchema = z.object({
  name: z.string().min(1).max(500).optional(),
  code: z.string().min(1).max(200).optional(),
  category: z.string().max(200).nullable().optional(),
  unitPrice: z.number().finite().nullable().optional(),
  kind: z.enum(['product', 'service']).optional(),
  trackStock: z.boolean().optional(),
  uom: z.string().min(1).max(50).optional(),
  consumption: z.array(consumptionSchema).optional(),
  active: z.boolean().optional(),
});

/** PATCH /api/pos/sellables/:id */
export const PATCH: RequestHandler = async ({ locals, params, request }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'pos'))) throw error(404);
  const body = await parseBody(request, patchSchema);
  const actor = { id: ctx.profileId ?? null, name: locals.user?.displayName ?? locals.user?.email ?? null };
  try {
    const sellable = await updateSellable(ctx, params.id!, body, actor);
    return json({ ok: true, sellable });
  } catch (e) {
    handlePosError(e);
  }
};

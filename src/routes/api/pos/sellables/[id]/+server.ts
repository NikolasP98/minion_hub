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
  note: z.string().max(2000).nullable().optional(),
});

const patchSchema = z.object({
  name: z.string().min(1).max(500).optional(),
  code: z.string().min(1).max(200).optional(),
  category: z.string().max(200).nullable().optional(),
  unitPrice: z.number().finite().nullable().optional(),
  kind: z.enum(['product', 'service']).optional(),
  trackStock: z.boolean().optional(),
  // See the POST schema: trim before the length check so a whitespace-only
  // unit of measure is a 400, not a stored unit.
  uom: z.string().trim().min(1).max(50).optional(),
  consumption: z.array(consumptionSchema).optional(),
  active: z.boolean().optional(),
});

/**
 * PATCH /api/pos/sellables/:id
 *
 * Applies the Slice-1 transition: an untracked SERVICE starts tracking stock.
 * `SellableWizard.svelte` reaches it from edit mode (the service→tracked case
 * only), and the response's `.sellable` carries `trackStock`/`uom` back, so the
 * operator-facing half of the contract is served by this handler and not only
 * the API half. Every other kind/trackStock/uom change is still refused with a
 * typed code rather than silently dropped — see `updateSellable`.
 */
export const PATCH: RequestHandler = async ({ locals, params, request }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'pos'))) throw error(404);
  const body = await parseBody(request, patchSchema);
  const actor = {
    id: ctx.profileId ?? null,
    name: locals.user?.displayName ?? locals.user?.email ?? null,
  };
  try {
    const sellable = await updateSellable(ctx, params.id!, body, actor);
    return json({ ok: true, sellable });
  } catch (e) {
    return handlePosError(e);
  }
};

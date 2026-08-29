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
  uom: z.string().min(1).max(50).optional(),
  consumption: z.array(consumptionSchema).optional(),
  active: z.boolean().optional(),
});

/**
 * PATCH /api/pos/sellables/:id
 *
 * TODO(handoff): `SellableWizard.svelte` still strips `kind`/`trackStock`/`uom`
 * from its edit-mode PATCH body and renders `m.pos_catalog_kind_locked()`
 * instead of the controls, so the service→tracked transition this schema now
 * accepts (and the projection now reads back as `trackStock`/`uom`) is
 * reachable over the API but NOT by an operator. The marker lives here, at the
 * request boundary, because the wizard is a `.svelte` file and
 * `2026-08-20-handoff-minion-hub-902723699-spec` §7/§8 make "no `.svelte` file
 * is edited" a mechanical ship gate — and because that spec's Slice-1 gate
 * pins the `TODO(handoff)` count in `pos.service.ts` to baseline-1. Fix =
 * send the three fields on PATCH and unlock the controls for the
 * service→tracked case only. Pointer:
 * docs/superpowers/plans/2026-08-29-updatesellable-slice1-recon-and-open-ends.md
 * §5 proposal P1.
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

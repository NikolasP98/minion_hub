import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { getCoreCtx } from '$server/auth/core-ctx';
import { parseBody } from '$server/api/validate';
import { isModuleEnabled } from '$server/services/modules.service';
import { listSellables, createSellable } from '$server/services/pos.service';
import { handlePosError } from '../_errors';

const consumptionSchema = z.object({
  itemId: z.string().min(1),
  qtyPerUnit: z.number().finite(),
});

const postSchema = z.object({
  name: z.string().min(1).max(500),
  code: z.string().min(1).max(200).optional(),
  category: z.string().max(200).nullable().optional(),
  unitPrice: z.number().finite().nullable(),
  kind: z.enum(['product', 'service']),
  trackStock: z.boolean().optional(),
  uom: z.string().min(1).max(50).optional(),
  /** Publish an existing stk_item instead of creating one — see SellableInput. */
  itemId: z.string().uuid().optional(),
  consumption: z.array(consumptionSchema).optional(),
  active: z.boolean().optional(),
});

/** GET /api/pos/sellables */
export const GET: RequestHandler = async ({ locals }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'pos'))) throw error(404);
  return json({ sellables: await listSellables(ctx) });
};

/** POST /api/pos/sellables */
export const POST: RequestHandler = async ({ locals, request }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'pos'))) throw error(404);
  const body = await parseBody(request, postSchema);
  const actor = { id: ctx.profileId ?? null, name: locals.user?.displayName ?? locals.user?.email ?? null };
  try {
    const sellable = await createSellable(ctx, body, actor);
    return json({ ok: true, sellable }, { status: 201 });
  } catch (e) {
    return handlePosError(e);
  }
};

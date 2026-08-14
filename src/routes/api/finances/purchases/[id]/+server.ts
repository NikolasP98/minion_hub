import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { getCoreCtx } from '$server/auth/core-ctx';
import { parseBody } from '$server/api/validate';
import { isModuleEnabled } from '$server/services/modules.service';
import { updatePurchase, deletePurchase } from '$server/services/purchases.service';
import { handlePurchasesError } from '../_errors';

const patchSchema = z.object({
  supplierRuc: z.string().max(20).nullable().optional(),
  supplierName: z.string().max(300).nullable().optional(),
  docType: z.string().max(10).nullable().optional(),
  serie: z.string().max(20).nullable().optional(),
  numero: z.string().max(20).nullable().optional(),
  issuedAt: z.string().max(10).nullable().optional(),
  currency: z.string().max(10).nullable().optional(),
  baseGravada: z.number().finite().nullable().optional(),
  igv: z.number().finite().nullable().optional(),
  total: z.number().finite().nullable().optional(),
});

/** PATCH /api/finances/purchases/[id] — rejected (period_closed) once the period is presented. */
export const PATCH: RequestHandler = async ({ locals, params, request }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'finances'))) throw error(404);
  const body = await parseBody(request, patchSchema);
  try {
    return json(await updatePurchase(ctx, params.id!, body));
  } catch (e) {
    return handlePurchasesError(e);
  }
};

/** DELETE /api/finances/purchases/[id] — rejected (period_closed) once the period is presented. */
export const DELETE: RequestHandler = async ({ locals, params }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'finances'))) throw error(404);
  try {
    await deletePurchase(ctx, params.id!);
    return json({ ok: true });
  } catch (e) {
    return handlePurchasesError(e);
  }
};

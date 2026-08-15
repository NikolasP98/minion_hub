import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { isModuleEnabled } from '$server/services/modules.service';
import { syncPurchases } from '$server/services/purchases.service';
import { handlePurchasesError } from '../_errors';

/**
 * POST /api/finances/purchases/sync — one-shot, synchronous (compras volume
 * is tiny: ~35 docs/month across a handful of periods' resumen CSVs). No job
 * queue — see spec §3 ("a plain one-shot service called from the UI is
 * acceptable for this slice").
 */
export const POST: RequestHandler = async ({ locals }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'finances'))) throw error(404);
  try {
    return json(await syncPurchases(ctx));
  } catch (e) {
    return handlePurchasesError(e);
  }
};

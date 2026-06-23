import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { isModuleEnabled } from '$server/services/modules.service';
import { reconcileOrdersToInvoices } from '$server/services/sales.service';

/** POST /api/sales/orders/reconcile — flip open orders to 'invoiced' where a
 *  matching SUSII invoice exists (party + amount + window). Also runs after each
 *  finance sync; this is the manual/backfill trigger. */
export const POST: RequestHandler = async ({ locals }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'sales'))) throw error(404);
  await reconcileOrdersToInvoices(ctx);
  return json({ ok: true });
};

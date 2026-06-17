import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { requireAdmin } from '$server/auth/authorize';
import { isModuleEnabled } from '$server/services/modules.service';
import { importFromBilling } from '$server/services/finance-products.service';

export const POST: RequestHandler = async ({ locals }) => {
  requireAdmin(locals);
  const ctx = await getCoreCtx(locals); if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'finances'))) throw error(403);
  const result = await importFromBilling(ctx);
  return json(result);
};

import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { uuidParamOr404 } from '$server/utils/uuid-param';
import { getPurchase, listEntriesByPurchaseId } from '$server/services/purchases.service';

// RBAC: no explicit capability check here — `/finances/purchases/[id]` is a
// subpath of `/finances`, already gated at `finance:view` by the route-access
// registry's prefix rule (`ROUTE_PERMISSION_PREFIXES`), enforced globally in
// `hooks.server.ts`. Same as `/finances/invoices/[id]`'s own load.
export const load: PageServerLoad = async ({ locals, params, depends }) => {
  uuidParamOr404(params.id);
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');
  depends('finances:purchases');
  const purchase = await getPurchase(ctx, params.id);
  if (!purchase) throw error(404, 'Purchase not found');
  const entries = await listEntriesByPurchaseId(ctx, params.id);
  return { purchase, entries };
};

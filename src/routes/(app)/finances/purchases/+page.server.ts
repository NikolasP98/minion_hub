import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { listPeriods, listPurchases } from '$server/services/purchases.service';
import { loadCustomPropertyBundle } from '$server/services/custom-property-bundle.service';

export const load: PageServerLoad = async ({ locals, depends }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');
  depends('finances:purchases');
  // Compras volume is tiny (~35 docs/month) — load everything at once, group
  // client-side by period. No pagination needed at this scale (spec §4).
  const [periods, purchases] = await Promise.all([listPeriods(ctx), listPurchases(ctx)]);
  const customProperties = await loadCustomPropertyBundle(
    locals,
    ctx,
    'finances.purchases',
    purchases.map((purchase) => purchase.id),
  );
  return { periods, purchases, customProperties };
};

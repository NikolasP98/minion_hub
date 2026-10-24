import type { PageServerLoad } from './$types';
import { datasetCtx, isDenied } from '$server/auth/dataset-ctx';
import { listPeriods, listPurchases } from '$server/services/purchases.service';
import { loadCustomPropertyBundle } from '$server/services/custom-property-bundle.service';

export const load: PageServerLoad = async ({ locals, depends }) => {
  const ctx = await datasetCtx(locals, 'finance');
  if (isDenied(ctx)) return { finance: ctx }; // rendered by DataSource (spec 039)
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
  return { finance: { periods, purchases, customProperties } };
};

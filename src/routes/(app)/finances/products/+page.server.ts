import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { isModuleEnabled } from '$server/services/modules.service';
import { listProducts, catalogCoverage } from '$server/services/finance-products.service';
import { costForProducts, productCompositionTrees } from '$server/services/item-cost.service';
import { shouldMaskSensitive } from '$server/services/rbac.service';

export const load: PageServerLoad = async ({ locals, depends }) => {
  const ctx = await getCoreCtx(locals); if (!ctx) throw error(401, 'Authentication required');
  if (!(await isModuleEnabled(ctx, 'finances'))) throw error(404, 'Finances module disabled');
  depends('finances:data');
  const [products, coverage, mask] = await Promise.all([
    listProducts(ctx),
    catalogCoverage(ctx),
    shouldMaskSensitive(locals, 'finance'),
  ]);
  const ids = products.map((p) => p.id);
  // Read-only view: stats + the recursive item relationships. Product/item
  // MANAGEMENT lives in POS (/pos/catalog) and stock (/stock/items).
  const [costs, trees] = await Promise.all([costForProducts(ctx, ids), productCompositionTrees(ctx, ids)]);
  const enriched = products.map((p) => {
    const c = costs.get(p.id);
    const costable = c?.costable ?? false;
    const partial = c?.partial ?? false;
    // Field-level RBAC: cost & margin are sensitive — omit the values entirely
    // when masked (never ship the number and hide it client-side).
    const composition = trees.get(p.id) ?? [];
    if (mask) return { ...p, cost: null, margin: null, marginPct: null, costable, partial, costMasked: true, composition };
    const cost = costable && c ? c.cost : null;
    const margin = cost != null && p.unitPrice != null ? Math.round((p.unitPrice - cost) * 100) / 100 : null;
    const marginPct = margin != null && p.unitPrice ? Math.round((margin / p.unitPrice) * 1000) / 10 : null;
    return { ...p, cost, margin, marginPct, costable, partial, costMasked: false, composition };
  });
  return { products: enriched, coverage };
};

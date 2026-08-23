import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { listSellables } from '$server/services/pos.service';
import { listItems, listConsumption, listAllComponentEdges } from '$server/services/stock.service';
import { billingForProducts, catalogCoverage } from '$server/services/finance-products.service';
import { costForProducts } from '$server/services/item-cost.service';
import { shouldMaskSensitive } from '$server/services/rbac.service';

/** The /pos module gate + 401 live in the (app) route hook guard + this
 *  layout's auth check — this load only adds the merged catalog + (when
 *  stock is on) the item picker + existing consumption mappings the wizard
 *  needs for edit prefill. stockEnabled is data-bearing (controls stock
 *  ENRICHMENT below, not a route gate), so it reads the hook's per-request
 *  module-state snapshot instead of re-querying (R5).
 *
 *  Also folds in what used to be finances/products-only: billed/revenue (a
 *  billingForProducts aggregate merged by id, NOT baked into
 *  SELLABLE_MERGE_SQL, so listSellables's other callers are untouched) and
 *  cost/margin via item-cost.service's costForProducts, both field-level
 *  RBAC-masked the same way finances/products masks them. `?inactive=1`
 *  opts into deactivated rows so they stay reachable/reactivatable from the
 *  catalog instead of vanishing once toggled off. */
export const load: PageServerLoad = async ({ locals, depends, url }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');
  depends('pos:catalog');

  const includeInactive = url.searchParams.get('inactive') === '1';
  const stockEnabled = locals.moduleStates?.stock ?? true;
  const [sellables, stockItems, consumption, componentEdges, coverage, mask] = await Promise.all([
    listSellables(ctx, { includeInactive }),
    stockEnabled ? listItems(ctx) : Promise.resolve([]),
    stockEnabled ? listConsumption(ctx) : Promise.resolve([]),
    // Recipe builder (#8): the whole org graph, so the editor can show nesting
    // and offer only children that wouldn't close a loop — both need more than
    // one item's direct children.
    stockEnabled ? listAllComponentEdges(ctx) : Promise.resolve([]),
    catalogCoverage(ctx),
    shouldMaskSensitive(locals, 'finance'),
  ]);

  const ids = sellables.map((s) => s.productId);
  const [billing, costs] = await Promise.all([
    billingForProducts(ctx, ids),
    costForProducts(ctx, ids),
  ]);

  const enriched = sellables.map((s) => {
    const b = billing.get(s.productId);
    const billed = b?.billed ?? 0;
    // Field-level RBAC: cost, margin AND revenue are sensitive here — omit the
    // values entirely when masked (never ship the number and hide it client-side).
    if (mask) {
      return {
        ...s,
        billed,
        revenue: null,
        cost: null,
        margin: null,
        marginPct: null,
        costable: false,
        partial: false,
        costMasked: true,
      };
    }
    const revenue = b?.revenue ?? 0;
    const c = costs.get(s.productId);
    const costable = c?.costable ?? false;
    const partial = c?.partial ?? false;
    const cost = costable && c ? c.cost : null;
    const margin =
      cost != null && s.unitPrice != null ? Math.round((s.unitPrice - cost) * 100) / 100 : null;
    const marginPct =
      margin != null && s.unitPrice ? Math.round((margin / s.unitPrice) * 1000) / 10 : null;
    return { ...s, billed, revenue, cost, margin, marginPct, costable, partial, costMasked: false };
  });

  return {
    sellables: enriched,
    stockItems,
    consumption,
    componentEdges,
    stockEnabled,
    coverage,
    includeInactive,
  };
};

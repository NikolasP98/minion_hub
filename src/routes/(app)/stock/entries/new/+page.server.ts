import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { getBins, listItems, listWarehouses } from '$server/services/stock.service';
import { getFinSettings } from '$server/services/finance.service';
import { listPurchases } from '$server/services/purchases.service';

export const load: PageServerLoad = async ({ locals }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');
  const [items, warehouses, fin, purchases, bins] = await Promise.all([
    // Picker — an archived item is not selectable for a new entry.
    listItems(ctx, { includeArchived: false }),
    listWarehouses(ctx),
    getFinSettings(ctx),
    // Small org-scale volume (spec 2026-08-14 purchases-rce module, ~35/month)
    // — the receipt form's "Provider invoice" picker browses every purchase,
    // newest first, same as the /finances/purchases page itself.
    listPurchases(ctx),
    // On-hand per (item, warehouse) for the per-line stock-change preview.
    // One query for the whole org — `stk_bins` holds a row only for pairs that
    // have actually moved, so this is far smaller than items x warehouses, and
    // a missing pair is a genuine zero.
    getBins(ctx),
  ]);
  // Only what the currency switcher needs — never the whole finance settings row.
  const fx = { currency: fin.currency, base: fin.fxBase, quote: fin.fxQuote, rate: fin.fxRate };
  return {
    items,
    warehouses,
    fx,
    purchases,
    bins: bins.map((b) => ({ itemId: b.itemId, warehouseId: b.warehouseId, qty: Number(b.qty) })),
  };
};

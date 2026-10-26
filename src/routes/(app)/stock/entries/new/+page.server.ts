import type { PageServerLoad } from './$types';
import { datasetCtx, isDenied } from '$server/auth/dataset-ctx';
import { getBins, listItems, listWarehouses } from '$server/services/stock.service';
import { getFinSettings } from '$server/services/finance.service';
import { listPurchases } from '$server/services/purchases.service';

export const load: PageServerLoad = async ({ locals }) => {
  const ctx = await datasetCtx(locals, 'stock');
  if (isDenied(ctx)) return { stock: ctx }; // rendered by DataSource (spec 039)
  // Currency + purchases are FINANCE data: own handle; denied => no fx switcher, no purchase picker.
  const fin = await datasetCtx(locals, 'finance');
  const [items, warehouses, finSettings, purchases, bins] = await Promise.all([
    // Picker — an archived item is not selectable for a new entry.
    listItems(ctx, { includeArchived: false }),
    listWarehouses(ctx),
    isDenied(fin) ? Promise.resolve(null) : getFinSettings(fin),
    // Small org-scale volume (spec 2026-08-14 purchases-rce module, ~35/month)
    // — the receipt form's "Provider invoice" picker browses every purchase,
    // newest first, same as the /finances/purchases page itself.
    isDenied(fin) ? Promise.resolve([]) : listPurchases(fin),
    // On-hand per (item, warehouse) for the per-line stock-change preview.
    // One query for the whole org — `stk_bins` holds a row only for pairs that
    // have actually moved, so this is far smaller than items x warehouses, and
    // a missing pair is a genuine zero.
    getBins(ctx),
  ]);
  // Only what the currency switcher needs — never the whole finance settings row.
  // Finance denied => PEN-only (the default settings row); USD lines then show "rate missing".
  const fx = finSettings
    ? {
        currency: finSettings.currency,
        base: finSettings.fxBase,
        quote: finSettings.fxQuote,
        rate: finSettings.fxRate,
      }
    : { currency: 'PEN', base: 'USD', quote: 'PEN', rate: null as number | null };
  return {
    stock: {
      items,
      warehouses,
      fx,
      purchases,
      bins: bins.map((b) => ({ itemId: b.itemId, warehouseId: b.warehouseId, qty: Number(b.qty) })),
    },
  };
};

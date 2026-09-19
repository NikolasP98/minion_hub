import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { listItems, listWarehouses } from '$server/services/stock.service';
import { getFinSettings } from '$server/services/finance.service';

export const load: PageServerLoad = async ({ locals }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');
  const [items, warehouses, fin] = await Promise.all([
    listItems(ctx),
    listWarehouses(ctx),
    getFinSettings(ctx),
  ]);
  // Only what the currency switcher needs — never the whole finance settings row.
  const fx = { currency: fin.currency, base: fin.fxBase, quote: fin.fxQuote, rate: fin.fxRate };
  return { items, warehouses, fx };
};

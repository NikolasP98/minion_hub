import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { isModuleEnabled } from '$server/services/modules.service';
import { listConsumption, listItems } from '$server/services/stock.service';
import { listProducts } from '$server/services/finance-products.service';

export const load: PageServerLoad = async ({ locals, depends }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');
  if (!(await isModuleEnabled(ctx, 'stock'))) throw error(404, 'Stock module disabled');
  depends('stock:consumption');

  const [consumption, items, products] = await Promise.all([
    listConsumption(ctx),
    listItems(ctx),
    listProducts(ctx),
  ]);
  return { consumption, items, products };
};

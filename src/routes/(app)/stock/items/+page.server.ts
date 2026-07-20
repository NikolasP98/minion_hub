import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { isModuleEnabled } from '$server/services/modules.service';
import { listItems, itemSupplyInfo } from '$server/services/stock.service';

export const load: PageServerLoad = async ({ locals, depends }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');
  if (!(await isModuleEnabled(ctx, 'stock'))) throw error(404, 'Stock module disabled');
  depends('stock:items');
  const [items, supply] = await Promise.all([listItems(ctx), itemSupplyInfo(ctx)]);
  // Last restock cost/supplier are derived from the ledger, not columns.
  return {
    items: items.map((i) => ({
      ...i,
      lastRestockCost: supply.get(i.id)?.lastRestockCost ?? null,
      lastSupplierName: supply.get(i.id)?.supplierName ?? null,
    })),
  };
};

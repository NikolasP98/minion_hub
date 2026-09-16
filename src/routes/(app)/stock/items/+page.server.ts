import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { listItems, itemSupplyInfo, itemOnHandInfo } from '$server/services/stock.service';
import { isLowStock } from '$server/services/stock.logic';

export const load: PageServerLoad = async ({ locals, depends, url }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');
  depends('stock:items');
  const [items, supply, onHand] = await Promise.all([
    listItems(ctx),
    itemSupplyInfo(ctx),
    itemOnHandInfo(ctx),
  ]);
  // Last restock cost/supplier are derived from the ledger, not columns.
  return {
    // ?new=1 opens the create-item modal (assistant deep link).
    openNew: url.searchParams.get('new') === '1',
    items: items.map((i) => {
      const qtyOnHand = onHand.get(i.id) ?? 0;
      const reorderLevel = i.reorderLevel == null ? null : Number(i.reorderLevel);
      return {
        ...i,
        lastRestockCost: supply.get(i.id)?.lastRestockCost ?? null,
        lastSupplierName: supply.get(i.id)?.supplierName ?? null,
        qtyOnHand,
        lowStock: isLowStock(qtyOnHand, reorderLevel),
      };
    }),
  };
};

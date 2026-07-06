import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { isModuleEnabled } from '$server/services/modules.service';
import { listItems, listWarehouses, getBins, getLedger, listConsumption } from '$server/services/stock.service';

export const load: PageServerLoad = async ({ locals, params, depends }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');
  if (!(await isModuleEnabled(ctx, 'stock'))) throw error(404, 'Stock module disabled');
  depends('stock:item-detail');

  const [items, warehouses, bins, ledger, consumedBy] = await Promise.all([
    listItems(ctx),
    listWarehouses(ctx),
    getBins(ctx, { itemId: params.id }),
    getLedger(ctx, params.id),
    listConsumption(ctx, { itemId: params.id }),
  ]);
  const item = items.find((i) => i.id === params.id);
  if (!item) throw error(404, 'Item not found');
  const warehouseById = new Map(warehouses.map((w) => [w.id, w]));

  return {
    item,
    itemIds: items.map((i) => i.id), // ordered ids only (keep payload small) — [ / ] prev/next nav
    bins: bins.map((b) => ({ ...b, warehouseName: warehouseById.get(b.warehouseId)?.name ?? b.warehouseId })),
    ledger: ledger.map((l) => ({ ...l, warehouseName: warehouseById.get(l.warehouseId)?.name ?? l.warehouseId })),
    consumedBy,
  };
};

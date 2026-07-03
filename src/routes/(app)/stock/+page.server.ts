import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { isModuleEnabled } from '$server/services/modules.service';
import { listItems, listWarehouses, getBins, getRecentLedger } from '$server/services/stock.service';

export const load: PageServerLoad = async ({ locals, depends }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');
  if (!(await isModuleEnabled(ctx, 'stock'))) throw error(404, 'Stock module disabled');
  depends('stock:overview');

  const [items, warehouses, bins, recentLedger] = await Promise.all([
    listItems(ctx),
    listWarehouses(ctx),
    getBins(ctx),
    getRecentLedger(ctx, 20),
  ]);

  const itemById = new Map(items.map((i) => [i.id, i]));
  const warehouseById = new Map(warehouses.map((w) => [w.id, w]));

  const totalValuation = bins.reduce((sum, b) => sum + Number(b.qty) * Number(b.valuationRate), 0);

  const lowStock = bins
    .map((b) => ({ bin: b, item: itemById.get(b.itemId) }))
    .filter((r) => r.item?.reorderLevel != null && Number(r.bin.qty) <= Number(r.item.reorderLevel))
    .map((r) => ({
      itemId: r.bin.itemId,
      itemCode: r.item?.code ?? r.bin.itemId,
      itemName: r.item?.name ?? r.bin.itemId,
      warehouseName: warehouseById.get(r.bin.warehouseId)?.name ?? r.bin.warehouseId,
      qty: Number(r.bin.qty),
      reorderLevel: Number(r.item?.reorderLevel ?? 0),
    }));

  const recent = recentLedger.map((l) => ({
    id: l.id,
    itemName: itemById.get(l.itemId)?.name ?? l.itemId,
    warehouseName: warehouseById.get(l.warehouseId)?.name ?? l.warehouseId,
    qtyDelta: Number(l.qtyDelta),
    postedAt: l.postedAt,
  }));

  return {
    totalValuation,
    itemCount: items.length,
    warehouseCount: warehouses.length,
    lowStock,
    recent,
    hasData: items.length > 0 || warehouses.length > 0,
  };
};

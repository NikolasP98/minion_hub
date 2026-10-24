import type { PageServerLoad } from './$types';
import { datasetCtx, isDenied } from '$server/auth/dataset-ctx';
import {
  listItems,
  listWarehouses,
  getBins,
  getRecentLedger,
  itemOnHandInfo,
  getStockDailyFlow,
} from '$server/services/stock.service';
import { buildLowStockRows, buildStockSeries } from '$server/services/stock.logic';

const SERIES_DAYS = 90;

export const load: PageServerLoad = async ({ locals, depends }) => {
  const ctx = await datasetCtx(locals, 'stock');
  if (isDenied(ctx)) return { stock: ctx }; // rendered by DataSource (spec 039)
  depends('stock:overview');

  const [items, warehouses, bins, recentLedger, onHand, flow] = await Promise.all([
    listItems(ctx, { includeArchived: false }),
    listWarehouses(ctx),
    getBins(ctx),
    getRecentLedger(ctx, 20),
    itemOnHandInfo(ctx),
    getStockDailyFlow(ctx, SERIES_DAYS),
  ]);

  const itemById = new Map(items.map((i) => [i.id, i]));
  const warehouseById = new Map(warehouses.map((w) => [w.id, w]));

  const totalValuation = bins.reduce((sum, b) => sum + Number(b.qty) * Number(b.valuationRate), 0);

  // Same source of truth as /stock/items' `lowStock` flag (item-level
  // on-hand, not per-bin) — see stock.logic.ts's buildLowStockRows doc.
  const lowStock = buildLowStockRows(
    items,
    new Map([...onHand].map(([id, v]) => [id, v.qtyOnHand])),
  );

  const recent = recentLedger.map((l) => ({
    id: l.id,
    itemName: itemById.get(l.itemId)?.name ?? l.itemId,
    warehouseName: warehouseById.get(l.warehouseId)?.name ?? l.warehouseId,
    qtyDelta: Number(l.qtyDelta),
    postedAt: l.postedAt,
  }));

  const series = buildStockSeries(totalValuation, flow, SERIES_DAYS, new Date());

  return {
    stock: {
      series,
      seriesDays: SERIES_DAYS,
      totalValuation,
      itemCount: items.length,
      warehouseCount: warehouses.length,
      lowStock,
      recent,
      hasData: items.length > 0 || warehouses.length > 0,
    },
  };
};

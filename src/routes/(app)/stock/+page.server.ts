import type { PageServerLoad } from './$types';
import { datasetCtx, isDenied } from '$server/auth/dataset-ctx';
import {
  listItems,
  listWarehouses,
  getBins,
  itemOnHandInfo,
  getStockDailyFlow,
} from '$server/services/stock.service';
import {
  listRecentMovementRows,
  resolveMovementAdmission,
  MovementError,
  type RecentMovementResponse,
} from '$server/services/stock-entries-read.service';
import { buildLowStockRows, buildStockSeries } from '$server/services/stock.logic';

const SERIES_DAYS = 90;

export const load: PageServerLoad = async ({ locals, depends }) => {
  const ctx = await datasetCtx(locals, 'stock');
  if (isDenied(ctx)) return { stock: ctx }; // rendered by DataSource (spec 039)
  depends('stock:overview');

  const admission = await resolveMovementAdmission(locals, ctx);
  const [items, warehouses, bins, recentMovements, onHand, flow] = await Promise.all([
    listItems(ctx, { includeArchived: false }),
    listWarehouses(ctx),
    getBins(ctx),
    // A failed recent card must not take the overview down: render it unavailable.
    listRecentMovementRows(ctx, admission).catch((e): RecentMovementResponse => {
      if (!(e instanceof MovementError)) throw e;
      return {
        surface: 'recent',
        projection: 'identity_only',
        rows: [],
        nextCursor: null,
        enrichmentAvailability: 'unavailable',
        reason: 'capacity_limit',
      };
    }),
    itemOnHandInfo(ctx),
    getStockDailyFlow(ctx, SERIES_DAYS),
  ]);

  const totalValuation = bins.reduce((sum, b) => sum + Number(b.qty) * Number(b.valuationRate), 0);

  // Same source of truth as /stock/items' `lowStock` flag (item-level
  // on-hand, not per-bin) — see stock.logic.ts's buildLowStockRows doc.
  const lowStock = buildLowStockRows(
    items,
    new Map([...onHand].map(([id, v]) => [id, v.qtyOnHand])),
  );

  const series = buildStockSeries(totalValuation, flow, SERIES_DAYS, new Date());

  return {
    stock: {
      series,
      seriesDays: SERIES_DAYS,
      totalValuation,
      itemCount: items.length,
      warehouseCount: warehouses.length,
      lowStock,
      recentMovements,
      hasData: items.length > 0 || warehouses.length > 0,
    },
  };
};

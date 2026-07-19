/**
 * Item cost / margin rollup (Item Spine — Slice 1a).
 *
 * ZERO new schema: a pure read over the existing `stk_consumption` BOM
 * (fin_product → materials) valued at each material's default-warehouse
 * `stk_bins.valuation_rate` — the exact cost path `stock-accruals.service.ts`
 * already snapshots. Answers "what does this product/service cost me?" so the
 * finances catalog can show margin.
 *
 * Recursion (bundles of bundles) is Slice 1b (`stk_item_components`); this is
 * the flat, one-level rollup. Design: specs/2026-07-19-item-spine-composition-slice1-spec.md
 */
import { and, eq, inArray } from 'drizzle-orm';
import { withOrgCore } from '$server/db/with-org-core';
import type { CoreCtx } from '$server/auth/core-ctx';
import { stkBins, stkConsumption, stkItems } from '$server/db/pg-schema/stock';
import { consumptionToStockQty, round4 } from './stock.logic';
import { resolveDefaultWarehouse } from './stock-accruals.service';

export interface CostLine {
  itemId: string;
  qtyPerUnit: number; // consumption uom (what the mapping stores)
  stockQty: number; // converted to the item's stock uom
  rate: number; // valuation per stock uom (0 when no bin)
  value: number; // stockQty × rate
  hasBin: boolean; // false ⇒ material has no valuation yet
}

export interface ProductCost {
  cost: number;
  /** Has ≥1 consumption mapping (a "recipe"). false ⇒ nothing to cost. */
  costable: boolean;
  /** ≥1 mapped material has no bin rate ⇒ cost is an UNDERSTATED lower bound,
   *  never a silent fake zero. The UI must flag this. */
  partial: boolean;
  lines: CostLine[];
}

/**
 * Pure rollup — sum each material's (converted) qty × valuation rate.
 * Split out from the DB read so the money math is unit-tested without a DB.
 */
export function rollupFlatCost(
  mappings: Array<{ itemId: string; qtyPerUnit: number; unitsPerStockUom: number | null }>,
  rateByItem: Map<string, number>,
): ProductCost {
  if (mappings.length === 0) return { cost: 0, costable: false, partial: false, lines: [] };
  let cost = 0;
  let partial = false;
  const lines = mappings.map((m) => {
    const stockQty = consumptionToStockQty({ unitsPerStockUom: m.unitsPerStockUom }, m.qtyPerUnit);
    const hasBin = rateByItem.has(m.itemId);
    const rate = rateByItem.get(m.itemId) ?? 0;
    const value = round4(stockQty * rate);
    if (!hasBin) partial = true;
    cost = round4(cost + value);
    return { itemId: m.itemId, qtyPerUnit: m.qtyPerUnit, stockQty: round4(stockQty), rate, value, hasBin };
  });
  return { cost, costable: true, partial, lines };
}

/**
 * Cost per fin_product, keyed by id. Products with no consumption mapping are
 * absent from the map (caller treats missing as uncostable). Materials are
 * valued at the org's DEFAULT warehouse rate (same choice as accruals).
 */
export async function costForProducts(ctx: CoreCtx, finProductIds: string[]): Promise<Map<string, ProductCost>> {
  const out = new Map<string, ProductCost>();
  if (finProductIds.length === 0) return out;
  const warehouseId = await resolveDefaultWarehouse(ctx);

  return withOrgCore(ctx, async (tx) => {
    const maps = await tx
      .select({
        finProductId: stkConsumption.finProductId,
        itemId: stkConsumption.itemId,
        qtyPerUnit: stkConsumption.qtyPerUnit,
        unitsPerStockUom: stkItems.unitsPerStockUom,
      })
      .from(stkConsumption)
      .innerJoin(stkItems, eq(stkItems.id, stkConsumption.itemId))
      .where(and(eq(stkConsumption.orgId, ctx.tenantId), inArray(stkConsumption.finProductId, finProductIds)));

    const byProduct = new Map<string, Array<{ itemId: string; qtyPerUnit: number; unitsPerStockUom: number | null }>>();
    const itemIds = new Set<string>();
    for (const r of maps) {
      itemIds.add(r.itemId);
      const list = byProduct.get(r.finProductId) ?? [];
      list.push({
        itemId: r.itemId,
        qtyPerUnit: Number(r.qtyPerUnit),
        unitsPerStockUom: r.unitsPerStockUom == null ? null : Number(r.unitsPerStockUom),
      });
      byProduct.set(r.finProductId, list);
    }

    const rateByItem = new Map<string, number>();
    if (warehouseId && itemIds.size) {
      const bins = await tx
        .select({ itemId: stkBins.itemId, valuationRate: stkBins.valuationRate })
        .from(stkBins)
        .where(and(eq(stkBins.orgId, ctx.tenantId), eq(stkBins.warehouseId, warehouseId), inArray(stkBins.itemId, [...itemIds])));
      for (const b of bins) rateByItem.set(b.itemId, Number(b.valuationRate));
    }

    for (const [productId, mappings] of byProduct) out.set(productId, rollupFlatCost(mappings, rateByItem));
    return out;
  });
}

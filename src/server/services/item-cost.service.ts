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
import { consumptionToStockQty, edgesByParent, rollupItemCost, round4 } from './stock.logic';
import { resolveDefaultWarehouse } from './stock-accruals.service';
import { listAllComponentEdges } from './stock.service';

export interface CostLine {
  itemId: string;
  qtyPerUnit: number; // consumption uom (what the mapping stores)
  stockQty: number; // converted to the item's stock uom
  rate: number; // valuation per stock uom (0 when no bin)
  value: number; // stockQty × rate
  /** false ⇒ material has NO usable valuation: either no bin row at all, or a
   *  bin sitting at rate 0. A zero rate is "not valued yet", NOT "free" — 7 of
   *  24 bins are in that state, and treating them as valued reported a
   *  confident 0.00 cost for products nobody has costed. */
  hasBin: boolean;
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
  /** Items whose EFFECTIVE rate is understated because something in their
   *  component subtree is unpriced. A composite can cost > 0 and still be
   *  incomplete, so rate alone can't detect it. */
  unvalued: Set<string> = new Set(),
): ProductCost {
  if (mappings.length === 0) return { cost: 0, costable: false, partial: false, lines: [] };
  let cost = 0;
  let partial = false;
  const lines = mappings.map((m) => {
    const stockQty = consumptionToStockQty({ unitsPerStockUom: m.unitsPerStockUom }, m.qtyPerUnit);
    const rate = rateByItem.get(m.itemId) ?? 0;
    // rate-0 is unvalued (not free); a composite may price > 0 yet still hide
    // an unpriced ingredient — hence the explicit set.
    const hasBin = rate > 0 && !unvalued.has(m.itemId);
    const value = round4(stockQty * rate);
    if (!hasBin) partial = true;
    cost = round4(cost + value);
    return { itemId: m.itemId, qtyPerUnit: m.qtyPerUnit, stockQty: round4(stockQty), rate, value, hasBin };
  });
  return { cost, costable: true, partial, lines };
}

/**
 * Cost per fin_product, keyed by id. Products with neither a consumption
 * mapping nor a 1:1 stock item are absent from the map (caller treats missing
 * as uncostable). Materials are valued at the org's DEFAULT warehouse rate
 * (same choice as accruals).
 *
 * Mirrors BOTH paths `resolveIssueLines` (pos.service) uses, so anything the
 * POS can issue stock for can also be costed:
 *   - service-kind → `stk_consumption` recipe (qty × qtyPerUnit fan-out)
 *   - product-kind → 1:1 `stk_items.fin_product_id` bridge (qty 1 of itself),
 *     i.e. a physical good sold standalone (a mask). Reading only the recipe
 *     table would leave these showing "no cost" despite a known valuation.
 * A product on both paths keeps its explicit recipe (the bridge is a fallback).
 */
export async function costForProducts(ctx: CoreCtx, finProductIds: string[]): Promise<Map<string, ProductCost>> {
  const out = new Map<string, ProductCost>();
  if (finProductIds.length === 0) return out;
  const [warehouseId, componentEdges] = await Promise.all([resolveDefaultWarehouse(ctx), listAllComponentEdges(ctx)]);

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

    // 1:1 bridge fallback — only for products with no explicit recipe.
    const bridged = await tx
      .select({ id: stkItems.id, finProductId: stkItems.finProductId, unitsPerStockUom: stkItems.unitsPerStockUom })
      .from(stkItems)
      .where(and(eq(stkItems.orgId, ctx.tenantId), inArray(stkItems.finProductId, finProductIds)));
    for (const b of bridged) {
      if (!b.finProductId || byProduct.has(b.finProductId)) continue;
      itemIds.add(b.id);
      byProduct.set(b.finProductId, [
        { itemId: b.id, qtyPerUnit: 1, unitsPerStockUom: b.unitsPerStockUom == null ? null : Number(b.unitsPerStockUom) },
      ]);
    }

    // Every bin at the default warehouse, not just the directly-mapped items:
    // a mapped item may be a COMPOSITE whose leaves are items nothing maps to
    // directly, and computing the transitive closure to narrow the IN list
    // would cost more than just reading them all.
    const binRate = new Map<string, number>();
    if (warehouseId) {
      const bins = await tx
        .select({ itemId: stkBins.itemId, valuationRate: stkBins.valuationRate })
        .from(stkBins)
        .where(and(eq(stkBins.orgId, ctx.tenantId), eq(stkBins.warehouseId, warehouseId)));
      for (const b of bins) binRate.set(b.itemId, Number(b.valuationRate));
    }

    // A mapped item's EFFECTIVE unit cost recurses through its components
    // (Slice 1b): a leaf costs its bin rate, a composite costs its recipe. So
    // "1 plate" prices the whole tree beneath it, at any depth.
    const byParent = edgesByParent(componentEdges);
    const memo = new Map<string, ReturnType<typeof rollupItemCost>>();
    const effective = (itemId: string) => rollupItemCost(itemId, byParent, (id) => binRate.get(id) ?? 0, memo);
    const rateByItem = new Map<string, number>();
    const unvalued = new Set<string>();
    for (const id of itemIds) {
      const r = effective(id);
      rateByItem.set(id, r.cost);
      if (r.partial) unvalued.add(id);
    }

    for (const [productId, mappings] of byProduct) out.set(productId, rollupFlatCost(mappings, rateByItem, unvalued));
    return out;
  });
}

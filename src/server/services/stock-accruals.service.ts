/**
 * Consumption accruals — potential (committed) stock spend vs realized spend.
 *
 * A booked service accrues its expected consumption ('open'); completion
 * realizes it into a posted stk_entry (via the existing createServiceIssue →
 * submitEntry path — this module NEVER writes the real ledger itself); cancel /
 * no-show releases it. All functions are plain ctx-level withOrgCore functions
 * called AFTER the booking tx commits (a statement error inside a PG tx poisons
 * the whole tx, so "fail-soft inside the booking tx" is impossible) — booking
 * call sites wrap them in try/catch, and business no-ops (no mapping, no
 * warehouse, already settled) return 0 instead of throwing.
 *
 * Design: docs/superpowers/specs/2026-07-05-consumption-accrual-scheduling-stock-design.md
 */
import { and, asc, eq, inArray } from 'drizzle-orm';
import { withOrgCore, type CoreTx } from '$server/db/with-org-core';
import type { CoreCtx } from '$server/auth/core-ctx';
import { stkAccruals, stkBins, stkConsumption, stkItems, stkWarehouses } from '$server/db/pg-schema/stock';
import { consumptionToStockQty, round4 } from './stock.logic';

export interface AccrualLineInput {
  itemId: string;
  qtyConsumption: number;
}

async function defaultWarehouseTx(tx: CoreTx, orgId: string): Promise<string | null> {
  const rows = await tx
    .select({ id: stkWarehouses.id, isDefault: stkWarehouses.isDefault })
    .from(stkWarehouses)
    .where(eq(stkWarehouses.orgId, orgId))
    .orderBy(asc(stkWarehouses.createdAt));
  return rows.find((w) => w.isDefault)?.id ?? rows[0]?.id ?? null;
}

/** Org's flagged default warehouse, else the earliest-created, else null. */
export function resolveDefaultWarehouse(ctx: CoreCtx): Promise<string | null> {
  return withOrgCore(ctx, (tx) => defaultWarehouseTx(tx, ctx.tenantId));
}

export interface AccrueInput {
  source: string;
  sourceId: string;
  finProductId: string | null;
  warehouseId?: string | null;
  /** Adjusted lines from the UI; absent → defaults from stk_consumption. */
  lines?: AccrualLineInput[] | null;
  /** Units of service for the defaults path (bookings are always 1). */
  quantity?: number;
}

/**
 * (Re)accrue the open consumption set for a source. Replaces existing OPEN
 * rows (idempotent re-adjust); a source with any realized/released row is
 * settled and never resurrected. Returns rows written; 0 = logical no-op.
 */
export async function accrueConsumption(ctx: CoreCtx, input: AccrueInput): Promise<number> {
  return withOrgCore(ctx, async (tx) => {
    const orgId = ctx.tenantId;
    const existing = await tx
      .select({ id: stkAccruals.id, status: stkAccruals.status })
      .from(stkAccruals)
      .where(and(eq(stkAccruals.orgId, orgId), eq(stkAccruals.source, input.source), eq(stkAccruals.sourceId, input.sourceId)));
    if (existing.some((r) => r.status !== 'open')) return 0; // settled — never resurrect

    const warehouseId = input.warehouseId ?? (await defaultWarehouseTx(tx, orgId));
    if (!warehouseId) return 0; // nothing to commit against

    let lines = (input.lines ?? []).filter((l) => l.qtyConsumption > 0);
    if (!lines.length) {
      if (!input.finProductId) return 0;
      const quantity = input.quantity && input.quantity > 0 ? input.quantity : 1;
      const mapping = await tx
        .select({ itemId: stkConsumption.itemId, qtyPerUnit: stkConsumption.qtyPerUnit })
        .from(stkConsumption)
        .where(and(eq(stkConsumption.orgId, orgId), eq(stkConsumption.finProductId, input.finProductId)));
      const byItem = new Map<string, number>();
      for (const m of mapping) byItem.set(m.itemId, (byItem.get(m.itemId) ?? 0) + quantity * Number(m.qtyPerUnit));
      lines = [...byItem].map(([itemId, qtyConsumption]) => ({ itemId, qtyConsumption }));
    }
    if (!lines.length) return 0; // unmapped product

    const itemIds = [...new Set(lines.map((l) => l.itemId))];
    const items = await tx
      .select({ id: stkItems.id, unitsPerStockUom: stkItems.unitsPerStockUom })
      .from(stkItems)
      .where(and(eq(stkItems.orgId, orgId), inArray(stkItems.id, itemIds)));
    const upsByItem = new Map(items.map((i) => [i.id, i.unitsPerStockUom == null ? null : Number(i.unitsPerStockUom)]));
    const bins = await tx
      .select({ itemId: stkBins.itemId, valuationRate: stkBins.valuationRate })
      .from(stkBins)
      .where(and(eq(stkBins.orgId, orgId), eq(stkBins.warehouseId, warehouseId), inArray(stkBins.itemId, itemIds)));
    const rateByItem = new Map(bins.map((b) => [b.itemId, Number(b.valuationRate)]));

    const rows = lines
      .filter((l) => upsByItem.has(l.itemId)) // unknown item id → skip, not fail
      .map((l) => {
        const qty = round4(consumptionToStockQty({ unitsPerStockUom: upsByItem.get(l.itemId) ?? null }, l.qtyConsumption));
        const rate = rateByItem.get(l.itemId) ?? 0;
        return {
          orgId,
          source: input.source,
          sourceId: input.sourceId,
          finProductId: input.finProductId,
          itemId: l.itemId,
          warehouseId,
          qtyConsumption: String(l.qtyConsumption),
          qty: String(qty),
          estUnitCost: String(rate),
          estValue: String(round4(qty * rate)),
        };
      });
    if (!rows.length) return 0; // all lines unknown → treat as malformed input, do NOT wipe the open set

    await tx
      .delete(stkAccruals)
      .where(and(eq(stkAccruals.orgId, orgId), eq(stkAccruals.source, input.source), eq(stkAccruals.sourceId, input.sourceId), eq(stkAccruals.status, 'open')));
    await tx.insert(stkAccruals).values(rows);
    return rows.length;
  });
}

/** Cancel / no-show path: open rows → released. Idempotent. */
export async function releaseAccruals(ctx: CoreCtx, source: string, sourceId: string): Promise<number> {
  return withOrgCore(ctx, async (tx) => {
    const rows = await tx
      .update(stkAccruals)
      .set({ status: 'released', releasedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(stkAccruals.orgId, ctx.tenantId), eq(stkAccruals.source, source), eq(stkAccruals.sourceId, sourceId), eq(stkAccruals.status, 'open')))
      .returning({ id: stkAccruals.id });
    return rows.length;
  });
}

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
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { withOrgCore, type CoreTx } from '$server/db/with-org-core';
import type { CoreCtx } from '$server/auth/core-ctx';
import {
  stkAccruals,
  stkBins,
  stkConsumption,
  stkItemComponents,
  stkItems,
  stkLedger,
  stkWarehouses,
  type StkAccrual,
  type StkEntry,
} from '$server/db/pg-schema/stock';
import { consumptionToStockQty, edgesByParent, explodeToStockLeaves, round4 } from './stock.logic';
import {
  buildServiceIssuePreview,
  createServiceIssue,
  findEntryBySource,
  submitEntry,
  StockError,
  type Actor,
  type CreateIssueFromInvoiceLine,
  type InvoicePreviewLine,
} from './stock.service';

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
      .where(
        and(
          eq(stkAccruals.orgId, orgId),
          eq(stkAccruals.source, input.source),
          eq(stkAccruals.sourceId, input.sourceId),
        ),
      );
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
        .where(
          and(eq(stkConsumption.orgId, orgId), eq(stkConsumption.finProductId, input.finProductId)),
        );
      const byItem = new Map<string, number>();
      for (const m of mapping)
        byItem.set(m.itemId, (byItem.get(m.itemId) ?? 0) + quantity * Number(m.qtyPerUnit));
      lines = [...byItem].map(([itemId, qtyConsumption]) => ({ itemId, qtyConsumption }));
    }
    if (!lines.length) return 0; // unmapped product

    // Slice 1b: a mapped item may itself be a RECIPE — expand to stock leaves so
    // a booked composite accrues its ingredients. Done inline on `tx` rather
    // than via pos.service's helper because withOrgCore does not nest.
    // Identity when nothing is composed, so existing accruals are untouched.
    const edgeRows = await tx
      .select({
        parentItemId: stkItemComponents.parentItemId,
        childItemId: stkItemComponents.childItemId,
        qty: stkItemComponents.qty,
      })
      .from(stkItemComponents)
      .where(eq(stkItemComponents.orgId, orgId));
    if (edgeRows.length) {
      const byParent = edgesByParent(
        edgeRows.map((e) => ({
          parentItemId: e.parentItemId,
          childItemId: e.childItemId,
          qty: Number(e.qty),
        })),
      );
      const involved = new Set<string>([
        ...lines.map((l) => l.itemId),
        ...edgeRows.flatMap((e) => [e.parentItemId, e.childItemId]),
      ]);
      const flagRows = await tx
        .select({ id: stkItems.id, isStockItem: stkItems.isStockItem })
        .from(stkItems)
        .where(and(eq(stkItems.orgId, orgId), inArray(stkItems.id, [...involved])));
      const stockFlag = new Map(flagRows.map((r) => [r.id, r.isStockItem]));
      const expanded = new Map<string, number>();
      for (const l of lines) {
        explodeToStockLeaves(
          l.itemId,
          l.qtyConsumption,
          byParent,
          (id) => stockFlag.get(id) ?? true,
          expanded,
        );
      }
      lines = [...expanded].map(([itemId, qtyConsumption]) => ({ itemId, qtyConsumption }));
      if (!lines.length) return 0; // everything expanded to non-stock leaves
    }

    const itemIds = [...new Set(lines.map((l) => l.itemId))];
    const items = await tx
      .select({ id: stkItems.id, unitsPerStockUom: stkItems.unitsPerStockUom })
      .from(stkItems)
      .where(and(eq(stkItems.orgId, orgId), inArray(stkItems.id, itemIds)));
    const upsByItem = new Map(
      items.map((i) => [i.id, i.unitsPerStockUom == null ? null : Number(i.unitsPerStockUom)]),
    );
    const bins = await tx
      .select({ itemId: stkBins.itemId, valuationRate: stkBins.valuationRate })
      .from(stkBins)
      .where(
        and(
          eq(stkBins.orgId, orgId),
          eq(stkBins.warehouseId, warehouseId),
          inArray(stkBins.itemId, itemIds),
        ),
      );
    const rateByItem = new Map(bins.map((b) => [b.itemId, Number(b.valuationRate)]));

    const rows = lines
      .filter((l) => upsByItem.has(l.itemId)) // unknown item id → skip, not fail
      .map((l) => {
        const qty = round4(
          consumptionToStockQty(
            { unitsPerStockUom: upsByItem.get(l.itemId) ?? null },
            l.qtyConsumption,
          ),
        );
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
      .where(
        and(
          eq(stkAccruals.orgId, orgId),
          eq(stkAccruals.source, input.source),
          eq(stkAccruals.sourceId, input.sourceId),
          eq(stkAccruals.status, 'open'),
        ),
      );
    await tx.insert(stkAccruals).values(rows);
    return rows.length;
  });
}

/** Cancel / no-show path: open rows → released. Idempotent. */
export async function releaseAccruals(
  ctx: CoreCtx,
  source: string,
  sourceId: string,
): Promise<number> {
  return withOrgCore(ctx, async (tx) => {
    const rows = await tx
      .update(stkAccruals)
      .set({ status: 'released', releasedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(stkAccruals.orgId, ctx.tenantId),
          eq(stkAccruals.source, source),
          eq(stkAccruals.sourceId, sourceId),
          eq(stkAccruals.status, 'open'),
        ),
      )
      .returning({ id: stkAccruals.id });
    return rows.length;
  });
}

export interface AccrualPreviewLine extends InvoicePreviewLine {
  /** Σ open-accrual stock-uom qty for (item, warehouse), excluding excludeSource. */
  committedOther: number;
  /** available − committedOther. Warn (not block) when a line's qty exceeds it. */
  atp: number;
}

export interface AccrualPreview {
  productName: string;
  productCode: string | null;
  warehouseId: string;
  hasMapping: boolean;
  lines: AccrualPreviewLine[];
}

/**
 * Gauge-ready preview of what booking `quantity` units of a service will
 * commit: the service-issue preview plus committed-elsewhere and ATP per line.
 * Warehouse defaults server-side. Throws StockError('no_warehouse') only here
 * (a preview with nowhere to look is a real error; accrue itself no-ops).
 */
export async function buildAccrualPreview(
  ctx: CoreCtx,
  input: {
    finProductId: string;
    quantity: number;
    warehouseId?: string | null;
    excludeSource?: { source: string; sourceId: string } | null;
  },
): Promise<AccrualPreview> {
  const warehouseId = input.warehouseId ?? (await resolveDefaultWarehouse(ctx));
  if (!warehouseId) throw new StockError('no warehouse configured', 'no_warehouse');
  const preview = await buildServiceIssuePreview(ctx, {
    finProductId: input.finProductId,
    quantity: input.quantity,
    warehouseId,
  });
  const itemIds = preview.lines.map((l) => l.itemId);
  const committed = itemIds.length
    ? await withOrgCore(ctx, (tx) =>
        tx
          .select({
            itemId: stkAccruals.itemId,
            total: sql<string>`coalesce(sum(${stkAccruals.qty}), 0)`,
          })
          .from(stkAccruals)
          .where(
            and(
              eq(stkAccruals.orgId, ctx.tenantId),
              eq(stkAccruals.warehouseId, warehouseId),
              inArray(stkAccruals.itemId, itemIds),
              eq(stkAccruals.status, 'open'),
              ...(input.excludeSource
                ? [
                    sql`not (${stkAccruals.source} = ${input.excludeSource.source} and ${stkAccruals.sourceId} = ${input.excludeSource.sourceId})`,
                  ]
                : []),
            ),
          )
          .groupBy(stkAccruals.itemId),
      )
    : [];
  const committedByItem = new Map(committed.map((c) => [c.itemId, Number(c.total)]));
  return {
    productName: preview.productName,
    productCode: preview.productCode,
    warehouseId,
    hasMapping: preview.hasMapping,
    lines: preview.lines.map((l) => {
      const committedOther = committedByItem.get(l.itemId) ?? 0;
      return { ...l, committedOther, atp: round4(l.available - committedOther) };
    }),
  };
}

export interface RealizeResult {
  entry: StkEntry | null;
  realized: number;
  /** Set when the issue could not POST (negative_stock etc). The draft entry
   *  stands; accruals stay open; re-calling realizeAccruals retries it. */
  stockWarning: { code: string; message: string; draftEntryId?: string } | null;
}

export interface RealizeInput {
  source: string;
  sourceId: string;
  /** Completion-dialog adjustments; absent → the open accruals as-is. */
  lines?: CreateIssueFromInvoiceLine[] | null;
  warehouseId?: string | null;
  /** Fallback when no accruals exist (e.g. accrue was lost) — booking.productId. */
  finProductId?: string | null;
  partyId?: string | null;
  note?: string | null;
  actor: Actor;
}

/**
 * Completion path — a small idempotent state machine:
 *   no entry yet   → create draft issue (source-stamped) from lines/accruals
 *   entry is draft → (re)try submitEntry; negative_stock → return stockWarning
 *   entry submitted→ stamp actuals from its ledger rows onto the open accruals
 * Accrued items missing from the final issue are released (superseded); items
 * issued but never accrued simply have no accrual row (ledger is the truth).
 */
export async function realizeAccruals(ctx: CoreCtx, input: RealizeInput): Promise<RealizeResult> {
  const open = await withOrgCore(ctx, (tx) =>
    tx
      .select()
      .from(stkAccruals)
      .where(
        and(
          eq(stkAccruals.orgId, ctx.tenantId),
          eq(stkAccruals.source, input.source),
          eq(stkAccruals.sourceId, input.sourceId),
          eq(stkAccruals.status, 'open'),
        ),
      ),
  );

  let entry = await findEntryBySource(ctx, input.source, input.sourceId);
  if (!entry) {
    const lines: CreateIssueFromInvoiceLine[] = input.lines?.length
      ? input.lines
      : open.map((a) => ({
          itemId: a.itemId,
          qty: Number(a.qty),
          qtyConsumption: Number(a.qtyConsumption),
        }));
    if (!lines.length) return { entry: null, realized: 0, stockWarning: null };
    const finProductId = input.finProductId ?? open[0]?.finProductId ?? null;
    if (!finProductId) return { entry: null, realized: 0, stockWarning: null };
    const warehouseId =
      input.warehouseId ?? open[0]?.warehouseId ?? (await resolveDefaultWarehouse(ctx));
    if (!warehouseId) throw new StockError('no warehouse configured', 'no_warehouse');
    try {
      entry = await createServiceIssue(ctx, {
        finProductId,
        quantity: 1,
        warehouseId,
        partyId: input.partyId ?? null,
        note: input.note ?? null,
        lines,
        submit: false,
        actor: input.actor,
        source: input.source,
        sourceId: input.sourceId,
      });
    } catch (e) {
      if (e instanceof StockError) {
        // Race (duplicate_source) or stale product — degrade like the submit
        // path; a retry re-enters via findEntryBySource and heals.
        return { entry: null, realized: 0, stockWarning: { code: e.code, message: e.message } };
      }
      throw e;
    }
  }

  if (entry.status === 'draft') {
    // ponytail: a draft left by an earlier failed attempt posts as-is; retry
    // lines don't rewrite it (adjust the draft in Stock → Entries if needed).
    try {
      entry = await submitEntry(ctx, entry.id, input.actor);
    } catch (e) {
      if (e instanceof StockError) {
        return {
          entry,
          realized: 0,
          stockWarning: { code: e.code, message: e.message, draftEntryId: entry.id },
        };
      }
      throw e;
    }
  }

  const entryId = entry.id;
  const realized = await withOrgCore(ctx, async (tx) => {
    const ledger = await tx
      .select({
        itemId: stkLedger.itemId,
        qtyDelta: stkLedger.qtyDelta,
        valueDelta: stkLedger.valueDelta,
      })
      .from(stkLedger)
      .where(and(eq(stkLedger.orgId, ctx.tenantId), eq(stkLedger.entryId, entryId)));
    const qtyByItem = new Map<string, number>();
    const valByItem = new Map<string, number>();
    for (const r of ledger) {
      qtyByItem.set(r.itemId, (qtyByItem.get(r.itemId) ?? 0) - Number(r.qtyDelta));
      valByItem.set(r.itemId, (valByItem.get(r.itemId) ?? 0) - Number(r.valueDelta));
    }
    let n = 0;
    for (const a of open) {
      if (qtyByItem.has(a.itemId)) {
        await tx
          .update(stkAccruals)
          .set({
            status: 'realized',
            realizedEntryId: entryId,
            realizedQty: String(round4(qtyByItem.get(a.itemId)!)),
            realizedValue: String(round4(valByItem.get(a.itemId)!)),
            realizedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(and(eq(stkAccruals.id, a.id), eq(stkAccruals.status, 'open')));
        n++;
      } else {
        // Accrued but not consumed in the final issue → superseded.
        await tx
          .update(stkAccruals)
          .set({ status: 'released', releasedAt: new Date(), updatedAt: new Date() })
          .where(and(eq(stkAccruals.id, a.id), eq(stkAccruals.status, 'open')));
      }
    }
    return n;
  });
  return { entry, realized, stockWarning: null };
}

export interface AccrualListRow extends StkAccrual {
  itemName: string;
  itemCode: string;
  itemUom: string;
  consumptionUom: string | null;
  unitsPerStockUom: string | null;
  subunitsPerStockUom: string | null;
  diagramEnabled: boolean;
}

/** Accruals joined with item/UOM fields — enough for the ConsumptionGauge. */
export function listAccruals(
  ctx: CoreCtx,
  filters: { status?: string; itemId?: string; source?: string; sourceId?: string } = {},
): Promise<AccrualListRow[]> {
  return withOrgCore(ctx, async (tx) => {
    const conds = [eq(stkAccruals.orgId, ctx.tenantId)];
    if (filters.status) conds.push(eq(stkAccruals.status, filters.status));
    if (filters.itemId) conds.push(eq(stkAccruals.itemId, filters.itemId));
    if (filters.source) conds.push(eq(stkAccruals.source, filters.source));
    if (filters.sourceId) conds.push(eq(stkAccruals.sourceId, filters.sourceId));
    const rows = await tx
      .select({
        accrual: stkAccruals,
        itemName: stkItems.name,
        itemCode: stkItems.code,
        itemUom: stkItems.uom,
        consumptionUom: stkItems.consumptionUom,
        unitsPerStockUom: stkItems.unitsPerStockUom,
        subunitsPerStockUom: stkItems.subunitsPerStockUom,
        diagramEnabled: stkItems.diagramEnabled,
      })
      .from(stkAccruals)
      .innerJoin(stkItems, eq(stkAccruals.itemId, stkItems.id))
      .where(and(...conds))
      .orderBy(desc(stkAccruals.createdAt))
      .limit(1000);
    return rows.map((r) => ({
      ...r.accrual,
      itemName: r.itemName,
      itemCode: r.itemCode,
      itemUom: r.itemUom,
      consumptionUom: r.consumptionUom,
      unitsPerStockUom: r.unitsPerStockUom,
      subunitsPerStockUom: r.subunitsPerStockUom,
      diagramEnabled: r.diagramEnabled,
    }));
  });
}

/** bin.qty − Σ open-accrual qty for (item, warehouse). */
export async function availableToPromise(
  ctx: CoreCtx,
  itemId: string,
  warehouseId: string,
): Promise<number> {
  return withOrgCore(ctx, async (tx) => {
    const [bin] = await tx
      .select({ qty: stkBins.qty })
      .from(stkBins)
      .where(
        and(
          eq(stkBins.orgId, ctx.tenantId),
          eq(stkBins.itemId, itemId),
          eq(stkBins.warehouseId, warehouseId),
        ),
      );
    const [committed] = await tx
      .select({ total: sql<string>`coalesce(sum(${stkAccruals.qty}), 0)` })
      .from(stkAccruals)
      .where(
        and(
          eq(stkAccruals.orgId, ctx.tenantId),
          eq(stkAccruals.itemId, itemId),
          eq(stkAccruals.warehouseId, warehouseId),
          eq(stkAccruals.status, 'open'),
        ),
      );
    return round4(Number(bin?.qty ?? 0) - Number(committed?.total ?? 0));
  });
}

/** Σ est_value of open accruals — the "potential spend" headline. */
export async function committedSpend(
  ctx: CoreCtx,
  filters: { warehouseId?: string } = {},
): Promise<number> {
  return withOrgCore(ctx, async (tx) => {
    const conds = [eq(stkAccruals.orgId, ctx.tenantId), eq(stkAccruals.status, 'open')];
    if (filters.warehouseId) conds.push(eq(stkAccruals.warehouseId, filters.warehouseId));
    const [row] = await tx
      .select({ total: sql<string>`coalesce(sum(${stkAccruals.estValue}), 0)` })
      .from(stkAccruals)
      .where(and(...conds));
    return Number(row?.total ?? 0);
  });
}

export interface AccrualSourceSummary {
  sourceId: string;
  open: number;
  realized: number;
  released: number;
  estValue: number;
  realizedValue: number;
  realizedEntryId: string | null;
}

/** Batch rollup for list pages (one query, no N+1). */
export async function accrualSummaryForSources(
  ctx: CoreCtx,
  source: string,
  sourceIds: string[],
): Promise<AccrualSourceSummary[]> {
  if (!sourceIds.length) return [];
  const rows = await withOrgCore(ctx, (tx) =>
    tx
      .select({
        sourceId: stkAccruals.sourceId,
        status: stkAccruals.status,
        estValue: stkAccruals.estValue,
        realizedValue: stkAccruals.realizedValue,
        realizedEntryId: stkAccruals.realizedEntryId,
      })
      .from(stkAccruals)
      .where(
        and(
          eq(stkAccruals.orgId, ctx.tenantId),
          eq(stkAccruals.source, source),
          inArray(stkAccruals.sourceId, sourceIds),
        ),
      ),
  );
  const bySource = new Map<string, AccrualSourceSummary>();
  for (const r of rows) {
    const s = bySource.get(r.sourceId) ?? {
      sourceId: r.sourceId,
      open: 0,
      realized: 0,
      released: 0,
      estValue: 0,
      realizedValue: 0,
      realizedEntryId: null,
    };
    if (r.status === 'open') s.open++;
    else if (r.status === 'realized') s.realized++;
    else s.released++;
    s.estValue = round4(s.estValue + Number(r.estValue));
    s.realizedValue = round4(s.realizedValue + Number(r.realizedValue ?? 0));
    if (r.realizedEntryId) s.realizedEntryId = r.realizedEntryId;
    bySource.set(r.sourceId, s);
  }
  return [...bySource.values()];
}

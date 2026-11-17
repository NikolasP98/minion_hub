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
import { createHash } from 'node:crypto';
import { and, asc, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { withOrgCore, type CoreTx } from '$server/db/with-org-core';
import type { CoreCtx } from '$server/auth/core-ctx';
import {
  stkAccruals,
  stkBins,
  stkConsumption,
  stkItemComponents,
  stkItems,
  stkEntries,
  stkLedger,
  stkWarehouses,
  type StkAccrual,
  type StkEntry,
} from '$server/db/pg-schema/stock';
import { schedBookings } from '$server/db/pg-scheduling-schema';
import { consumptionToStockQty, edgesByParent, explodeToStockLeaves, round4 } from './stock.logic';
import { memoRequest } from '$server/db/request-memo';
import {
  buildServiceIssuePreview,
  createServiceIssueInTx,
  findEntryBySourceInTx,
  lockStockWrite,
  submitEntryInTx,
  StockError,
  type StockWriteGuard,
  type Actor,
  type CreateIssueFromInvoiceLine,
  type InvoicePreviewLine,
} from './stock.service';

export interface AccrualLineInput {
  itemId: string;
  qtyConsumption: number;
}

export async function defaultWarehouseInTx(tx: CoreTx, orgId: string): Promise<string | null> {
  const rows = await tx
    .select({ id: stkWarehouses.id, isDefault: stkWarehouses.isDefault })
    .from(stkWarehouses)
    .where(and(eq(stkWarehouses.orgId, orgId), isNull(stkWarehouses.archivedAt)))
    .orderBy(asc(stkWarehouses.createdAt));
  return rows.find((w) => w.isDefault)?.id ?? rows[0]?.id ?? null;
}

/** Org's flagged default warehouse, else the earliest-created, else null.
 *  GET-only memoisation (brief-debloat-c §3): pos/catalog's listSellables
 *  and recipe-availability helpers each resolve this independently within
 *  one request — a no-op passthrough outside a GET (see requestMemoHandle),
 *  so write call sites (ticket/accrual admission) are unaffected. */
export function resolveDefaultWarehouse(ctx: CoreCtx): Promise<string | null> {
  return memoRequest(`default-warehouse:${ctx.tenantId}`, () =>
    withOrgCore(ctx, (tx) => defaultWarehouseInTx(tx, ctx.tenantId)),
  );
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
    await lockStockWrite(tx, ctx);
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

    const warehouseId = input.warehouseId ?? (await defaultWarehouseInTx(tx, orgId));
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
      lines = [...byItem]
        .filter(([, q]) => q > 0) // a 0-qty mapping accrues nothing
        .map(([itemId, qtyConsumption]) => ({ itemId, qtyConsumption }));
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
export function releaseAccruals(ctx: CoreCtx, source: string, sourceId: string): Promise<number> {
  return withOrgCore(ctx, async (tx) => {
    await lockStockWrite(tx, ctx);
    return releaseAccrualsInTx(tx, ctx, source, sourceId);
  });
}

export async function releaseAccrualsInTx(
  tx: CoreTx,
  ctx: CoreCtx,
  source: string,
  sourceId: string,
): Promise<number> {
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
  /** Completion-dialog adjustments: absent/null → the open accruals as-is; [] → confirmed nothing used (release, no entry); non-empty → issue those lines. */
  lines?: CreateIssueFromInvoiceLine[] | null;
  warehouseId?: string | null;
  /** Fallback when no accruals exist (e.g. accrue was lost) — booking.productId. */
  finProductId?: string | null;
  partyId?: string | null;
  note?: string | null;
  actor: Actor;
  /**
   * Spec 126 `confirm_open` recovery: the operator reviewed THIS open set. Inside the
   * passed transaction, before any write, the set must still be the one reviewed (same
   * count and fingerprint), the booking still completed and no source entry present —
   * else `RecoveryPreviewStaleError`, with no effect at all. Never inferred from `lines`.
   */
  recovery?: { expectedOpenCount: number; expectedOpenFingerprint: string };
}

/** The reviewed open set changed (or the booking/source did) between preview and confirm. */
export class RecoveryPreviewStaleError extends Error {
  readonly code = 'recovery_preview_stale';
  constructor() {
    super('the open stock set changed since it was reviewed; refresh and review again');
  }
}

/**
 * Completion path — a small idempotent state machine:
 *   no entry yet   → create draft issue (source-stamped) from lines/accruals
 *   entry is draft → (re)try submitEntry; negative_stock → return stockWarning
 *   entry submitted→ stamp actuals from its ledger rows onto the open accruals
 * Accrued items missing from the final issue are released (superseded); items
 * issued but never accrued simply have no accrual row (ledger is the truth).
 */
export function realizeAccruals(ctx: CoreCtx, input: RealizeInput): Promise<RealizeResult> {
  return withOrgCore(ctx, async (tx) =>
    realizeAccrualsInTx(tx, ctx, await lockStockWrite(tx, ctx), input),
  );
}

/**
 * Same-transaction realize: every source / open-accrual / draft / submitted lookup is re-read after
 * the gate pair inside the passed transaction, so concurrent completion retries serialize and
 * converge on ONE entry. A domain refusal (negative stock, duplicate source) is thrown before any
 * write, so the established draft + warning outcome still commits.
 */
export async function realizeAccrualsInTx(
  tx: CoreTx,
  ctx: CoreCtx,
  guard: StockWriteGuard,
  input: RealizeInput,
): Promise<RealizeResult> {
  if (input.recovery) await assertRecoveryPreviewInTx(tx, ctx, input);
  const open = await tx
    .select()
    .from(stkAccruals)
    .where(
      and(
        eq(stkAccruals.orgId, ctx.tenantId),
        eq(stkAccruals.source, input.source),
        eq(stkAccruals.sourceId, input.sourceId),
        eq(stkAccruals.status, 'open'),
      ),
    );

  let entry = await findEntryBySourceInTx(tx, ctx, input.source, input.sourceId);
  // explicit [] = "confirmed nothing used": release, book nothing (null = realize as-is)
  if (!entry && Array.isArray(input.lines) && input.lines.length === 0) {
    await releaseAccrualsInTx(tx, ctx, input.source, input.sourceId);
    return { entry: null, realized: 0, stockWarning: null };
  }
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
      input.warehouseId ?? open[0]?.warehouseId ?? (await defaultWarehouseInTx(tx, ctx.tenantId));
    if (!warehouseId) throw new StockError('no warehouse configured', 'no_warehouse');
    try {
      entry = await createServiceIssueInTx(tx, ctx, guard, {
        finProductId,
        quantity: 1,
        warehouseId,
        partyId: input.partyId ?? null,
        note: input.note ?? null,
        lines,
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
      entry = (await submitEntryInTx(tx, ctx, guard, entry.id, input.actor)).entry;
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
  const realized = await (async () => {
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
  })();
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

/** What one visit anchor's booking accruals look like — counts only, no cost (spec 126). */
export interface AnchorAccrual {
  open: number;
  realized: number;
  released: number;
  /** Null when no row, or several DISTINCT realized entries (never an arbitrary first). */
  realizedEntryId: string | null;
}

const ANCHOR_READ_LIMIT = 1000;

/**
 * Cost-free accrual counts for the SERVER-RESOLVED visit anchors (spec 126
 * decision 4). A complete read with no rows leaves an anchor out of the map, so
 * the caller can say "no accrual" only when the read really succeeded; a throw
 * is the caller's `unavailable`, never an empty map. Selects no value column.
 */
export async function stockAnchorForBookings(
  ctx: CoreCtx,
  anchorIds: string[],
): Promise<Map<string, AnchorAccrual>> {
  const out = new Map<string, AnchorAccrual>();
  const ids = [...new Set(anchorIds)];
  if (!ids.length) return out;
  if (ids.length > ANCHOR_READ_LIMIT) throw new Error('capacity');
  const rows = await withOrgCore(ctx, (tx) =>
    tx
      .select({
        sourceId: stkAccruals.sourceId,
        status: stkAccruals.status,
        realizedEntryId: stkAccruals.realizedEntryId,
      })
      .from(stkAccruals)
      .where(
        and(
          eq(stkAccruals.orgId, ctx.tenantId),
          eq(stkAccruals.source, 'booking'),
          inArray(stkAccruals.sourceId, ids),
        ),
      ),
  );
  const entries = new Map<string, Set<string>>();
  for (const r of rows) {
    const a = out.get(r.sourceId) ?? { open: 0, realized: 0, released: 0, realizedEntryId: null };
    if (r.status === 'open') a.open++;
    else if (r.status === 'realized') a.realized++;
    else a.released++;
    if (r.realizedEntryId) {
      const set = entries.get(r.sourceId) ?? new Set<string>();
      set.add(r.realizedEntryId);
      entries.set(r.sourceId, set);
    }
    out.set(r.sourceId, a);
  }
  for (const [id, set] of entries) if (set.size === 1) out.get(id)!.realizedEntryId = [...set][0]!;
  return out;
}

// ── Spec 126 US2: persistent stock-recovery read model ───────────────────────

export type RecoveryEligibility = 'retry_saved' | 'confirm_open' | 'not_needed' | 'manual_review';

/** One open accrual of a member, with what `completionLinesFor` needs; quantity only, no cost. */
export interface RecoveryOpenRow {
  accrualId: string;
  itemId: string;
  itemName: string;
  uom: string;
  consumptionUom: string | null;
  unitsPerStockUom: number | null;
  subunitsPerStockUom: number | null;
  diagramEnabled: boolean;
  qty: number;
  qtyConsumption: number;
}

export interface RecoveryConfirmation {
  openCount: number;
  rows: RecoveryOpenRow[];
  /** SHA-256 over the reviewed rows; server-produced freshness evidence, never an approval. */
  expectedOpenFingerprint: string;
}

export type RecoveryConfirmationRead =
  | { state: 'available'; value: RecoveryConfirmation }
  | { state: 'unavailable'; reason: 'capacity' | 'invalid_projection' };

export interface StockRecoveryMember {
  bookingId: string;
  status: string;
  openCount: number;
  realizedCount: number;
  releasedCount: number;
  sourceEntry: { id: string; status: 'draft' | 'submitted' } | null;
  eligibility: RecoveryEligibility;
  /** Only for `confirm_open` members. */
  confirmation: RecoveryConfirmationRead | null;
}

const RECOVERY_OPEN_LIMIT = 1000;

/**
 * The open accruals of one booking as a COMPLETE reviewable set, in ONE statement
 * (so rows and count share a snapshot): at most 1,000, each joined to a same-org
 * item. More than 1,000 or a lost item join is `unavailable`, never a shorter list.
 * Runs on the passed transaction (the F3 write transaction for the precondition).
 */
export async function listRecoveryOpenAccrualsInTx(
  tx: CoreTx,
  ctx: CoreCtx,
  bookingId: string,
): Promise<RecoveryConfirmationRead> {
  const rows = await tx
    .select({
      accrual: stkAccruals,
      itemName: stkItems.name,
      itemUom: stkItems.uom,
      consumptionUom: stkItems.consumptionUom,
      unitsPerStockUom: stkItems.unitsPerStockUom,
      subunitsPerStockUom: stkItems.subunitsPerStockUom,
      diagramEnabled: stkItems.diagramEnabled,
    })
    .from(stkAccruals)
    .leftJoin(
      stkItems,
      and(eq(stkItems.id, stkAccruals.itemId), eq(stkItems.orgId, stkAccruals.orgId)),
    )
    .where(
      and(
        eq(stkAccruals.orgId, ctx.tenantId),
        eq(stkAccruals.source, 'booking'),
        eq(stkAccruals.sourceId, bookingId),
        eq(stkAccruals.status, 'open'),
      ),
    )
    .orderBy(asc(stkAccruals.id))
    .limit(RECOVERY_OPEN_LIMIT + 1);
  if (rows.length > RECOVERY_OPEN_LIMIT) return { state: 'unavailable', reason: 'capacity' };
  const out: RecoveryOpenRow[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const qty = Number(r.accrual.qty);
    const qtyConsumption = Number(r.accrual.qtyConsumption);
    if (
      r.itemName === null ||
      r.itemUom === null ||
      seen.has(r.accrual.id) ||
      !Number.isFinite(qty) ||
      !Number.isFinite(qtyConsumption)
    )
      return { state: 'unavailable', reason: 'invalid_projection' };
    seen.add(r.accrual.id);
    out.push({
      accrualId: r.accrual.id,
      itemId: r.accrual.itemId,
      itemName: r.itemName,
      uom: r.itemUom,
      consumptionUom: r.consumptionUom ?? null,
      unitsPerStockUom: r.unitsPerStockUom == null ? null : Number(r.unitsPerStockUom),
      subunitsPerStockUom: r.subunitsPerStockUom == null ? null : Number(r.subunitsPerStockUom),
      diagramEnabled: Boolean(r.diagramEnabled),
      qty,
      qtyConsumption,
    });
  }
  // Hash the stored text of every value the operator reviewed or that decides the issue
  // (quantities, the item conversion facts), in id order — no Number reserialization.
  // shortcut: selected columns, not PostgreSQL `to_jsonb(row)::text`; upgrade if a column
  // outside this list can change what the issue books.
  const fingerprint = createHash('sha256')
    .update(
      JSON.stringify({
        orgId: ctx.tenantId,
        bookingId,
        sourceEntryState: 'absent',
        openCount: rows.length,
        accrualRows: rows.map((r) => [
          r.accrual.id,
          r.accrual.itemId,
          r.accrual.status,
          r.accrual.qty,
          r.accrual.qtyConsumption,
          r.accrual.warehouseId,
        ]),
        itemRows: rows.map((r) => [
          r.accrual.itemId,
          r.itemUom,
          r.consumptionUom,
          r.unitsPerStockUom,
          r.subunitsPerStockUom,
        ]),
      }),
    )
    .digest('hex');
  return {
    state: 'available',
    value: { openCount: out.length, rows: out, expectedOpenFingerprint: fingerprint },
  };
}

/** Precondition of `confirm_open`; runs inside the write transaction after the F3 gate. */
async function assertRecoveryPreviewInTx(
  tx: CoreTx,
  ctx: CoreCtx,
  input: RealizeInput,
): Promise<void> {
  const want = input.recovery!;
  const [booking] = await tx
    .select({ status: schedBookings.status })
    .from(schedBookings)
    .where(and(eq(schedBookings.id, input.sourceId), eq(schedBookings.orgId, ctx.tenantId)))
    .limit(1);
  if (booking?.status !== 'completed') throw new RecoveryPreviewStaleError();
  if (await findEntryBySourceInTx(tx, ctx, input.source, input.sourceId))
    throw new RecoveryPreviewStaleError();
  const current = await listRecoveryOpenAccrualsInTx(tx, ctx, input.sourceId);
  if (
    current.state !== 'available' ||
    current.value.openCount < 1 ||
    current.value.openCount !== want.expectedOpenCount ||
    current.value.expectedOpenFingerprint !== want.expectedOpenFingerprint
  )
    throw new RecoveryPreviewStaleError();
}

/**
 * Per-member recovery facts for the server-resolved visit members (at most 8, passed by the
 * scheduling caller — never from a client body, and this module does not import the bound).
 * Counts accrual states and the active source entry; one decision per member:
 *  - completed + saved entry (draft, or submitted with open rows) → `retry_saved`
 *  - completed + no entry + open rows → `confirm_open` (with the reviewable open set)
 *  - completed + everything realized/released (or submitted, nothing open) → `not_needed`
 *  - no evidence at all, several active entries, unreadable open set → `manual_review`
 *  - a member that is not completed is never a recovery target → `not_needed`
 * A throw means the facet is unavailable; it is never read as "nothing to recover".
 */
export async function stockRecoveryForBookings(
  ctx: CoreCtx,
  members: ReadonlyArray<{ bookingId: string; status: string }>,
): Promise<StockRecoveryMember[]> {
  if (!members.length) return [];
  const ids = members.map((m) => m.bookingId);
  return withOrgCore(ctx, async (tx) => {
    const accruals = await tx
      .select({ sourceId: stkAccruals.sourceId, status: stkAccruals.status })
      .from(stkAccruals)
      .where(
        and(
          eq(stkAccruals.orgId, ctx.tenantId),
          eq(stkAccruals.source, 'booking'),
          inArray(stkAccruals.sourceId, ids),
        ),
      );
    const entries = await tx
      .select({
        id: stkEntries.id,
        status: stkEntries.status,
        sourceId: sql<string>`${stkEntries.metadata}->>'sourceId'`,
      })
      .from(stkEntries)
      .where(
        and(
          eq(stkEntries.orgId, ctx.tenantId),
          ne(stkEntries.status, 'cancelled'),
          sql`${stkEntries.metadata}->>'source' = 'booking'`,
          sql`${stkEntries.metadata}->>'sourceId' in ${ids}`,
        ),
      );
    const out: StockRecoveryMember[] = [];
    for (const mb of members) {
      const mine = accruals.filter((a) => a.sourceId === mb.bookingId);
      const count = (st: string) => mine.filter((a) => a.status === st).length;
      const open = count('open');
      const realized = count('realized');
      const released = count('released');
      const active = entries.filter((e) => e.sourceId === mb.bookingId);
      const entry = active.length === 1 ? active[0]! : null;
      const sourceEntry =
        entry && (entry.status === 'draft' || entry.status === 'submitted')
          ? { id: entry.id, status: entry.status }
          : null;
      let eligibility: RecoveryEligibility;
      if (mb.status !== 'completed') eligibility = 'not_needed';
      else if (active.length > 1 || (active.length === 1 && !sourceEntry))
        eligibility = 'manual_review';
      else if (sourceEntry)
        eligibility = sourceEntry.status === 'draft' || open > 0 ? 'retry_saved' : 'not_needed';
      else if (open > 0) eligibility = 'confirm_open';
      else eligibility = realized + released > 0 ? 'not_needed' : 'manual_review';
      let confirmation: RecoveryConfirmationRead | null = null;
      if (eligibility === 'confirm_open') {
        confirmation = await listRecoveryOpenAccrualsInTx(tx, ctx, mb.bookingId);
        if (confirmation.state === 'unavailable') eligibility = 'manual_review';
        else if (confirmation.value.openCount !== open) {
          // Two reads disagree (an accrual moved between them): never offer a stale set.
          confirmation = { state: 'unavailable', reason: 'invalid_projection' };
          eligibility = 'manual_review';
        }
      }
      out.push({
        bookingId: mb.bookingId,
        status: mb.status,
        openCount: open,
        realizedCount: realized,
        releasedCount: released,
        sourceEntry,
        eligibility,
        confirmation,
      });
    }
    return out;
  });
}

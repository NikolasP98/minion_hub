import { and, asc, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import { withOrgCore, type CoreTx } from '$server/db/with-org-core';
import type { CoreCtx } from '$server/auth/core-ctx';
import { nextSerialId } from './naming-series';
import { recordAudit } from './activity.service';
import { registerNotifCandidateSource } from './notif.service';
import { emitHubEvent } from '$server/events/emit';
import {
  stkItems,
  stkWarehouses,
  stkEntries,
  stkEntryLines,
  stkLedger,
  stkBins,
  stkConsumption,
  type StkItem,
  type StkWarehouse,
  type StkEntry,
  type StkEntryLine,
  type StkBin,
  type StkLedgerRow,
  type StkConsumption,
} from '$server/db/pg-schema/stock';
import { finInvoices, finInvoiceItems, finProducts } from '$server/db/pg-finance-schema';
import {
  ENTRY_TYPES,
  type EntryType,
  type BinState,
  EMPTY_BIN,
  applyLedgerDelta,
  computeLegValue,
  wouldGoNegative,
  validateEntryLine,
  expandLine,
  wouldCreateCycle,
  replayBins,
  binKey,
  consumptionToStockQty,
  round4,
  validateItemUomConfig,
  type LedgerReplayRow,
} from './stock.logic';

export class StockError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = 'StockError';
  }
}

export interface Actor {
  id: string | null;
  name: string | null;
}

// ponytail: allow_negative_stock is hardcoded off in v1. The plan calls it an
// "org setting", but there's no per-org business-config store outside the six
// stk_* tables this module is scoped to, and nobody's asked to override it
// yet. Upgrade: an app_modules-style stk_org_settings(org_id pk,
// allow_negative_stock) table when a real org needs the override.
const ALLOW_NEGATIVE_STOCK_V1 = false;

// ── Items ────────────────────────────────────────────────────────────────────

export function listItems(ctx: CoreCtx): Promise<StkItem[]> {
  return withOrgCore(ctx, (tx) => tx.select().from(stkItems).where(eq(stkItems.orgId, ctx.tenantId)).orderBy(asc(stkItems.name)));
}

export interface ItemUomInfo {
  itemId: string;
  uom: string;
  consumptionUom: string | null;
  unitsPerStockUom: number | null;
  subunitsPerStockUom: number | null;
  diagramEnabled: boolean;
}

/** Per-item uom/conversion fields, keyed for merging onto bin/ledger rows that
 *  only carry an itemId (the gateway `stock` query's `levels` mode). */
export async function getItemUomInfo(ctx: CoreCtx, itemIds: string[]): Promise<ItemUomInfo[]> {
  if (!itemIds.length) return [];
  const rows = await withOrgCore(ctx, (tx) =>
    tx
      .select({
        itemId: stkItems.id,
        uom: stkItems.uom,
        consumptionUom: stkItems.consumptionUom,
        unitsPerStockUom: stkItems.unitsPerStockUom,
        subunitsPerStockUom: stkItems.subunitsPerStockUom,
        diagramEnabled: stkItems.diagramEnabled,
      })
      .from(stkItems)
      .where(and(eq(stkItems.orgId, ctx.tenantId), inArray(stkItems.id, itemIds))),
  );
  return rows.map((r) => ({
    ...r,
    unitsPerStockUom: r.unitsPerStockUom == null ? null : Number(r.unitsPerStockUom),
    subunitsPerStockUom: r.subunitsPerStockUom == null ? null : Number(r.subunitsPerStockUom),
  }));
}

export type NewItemInput = Omit<typeof stkItems.$inferInsert, 'id' | 'orgId' | 'createdAt' | 'updatedAt'>;

export async function createItem(ctx: CoreCtx, input: NewItemInput): Promise<StkItem> {
  const err = validateItemUomConfig({
    consumptionUom: input.consumptionUom ?? null,
    unitsPerStockUom: input.unitsPerStockUom == null ? null : Number(input.unitsPerStockUom),
  });
  if (err) throw new StockError(err, 'invalid_uom_config');
  const [row] = await withOrgCore(ctx, (tx) => tx.insert(stkItems).values({ ...input, orgId: ctx.tenantId }).returning());
  return row;
}

export async function updateItem(ctx: CoreCtx, id: string, patch: Partial<NewItemInput>): Promise<StkItem | null> {
  return withOrgCore(ctx, async (tx) => {
    const [cur] = await tx.select().from(stkItems).where(and(eq(stkItems.id, id), eq(stkItems.orgId, ctx.tenantId)));
    if (!cur) return null;
    // Merge over the current row — a PATCH only sends the fields it's changing,
    // so the cross-field rule must be checked against the RESULTING config, not
    // just the patch in isolation (e.g. setting consumptionUom alone is fine
    // when unitsPerStockUom was already set on a prior PATCH).
    const consumptionUom = patch.consumptionUom === undefined ? cur.consumptionUom : patch.consumptionUom;
    const unitsPerStockUomRaw = patch.unitsPerStockUom === undefined ? cur.unitsPerStockUom : patch.unitsPerStockUom;
    const err = validateItemUomConfig({
      consumptionUom,
      unitsPerStockUom: unitsPerStockUomRaw == null ? null : Number(unitsPerStockUomRaw),
    });
    if (err) throw new StockError(err, 'invalid_uom_config');
    const [row] = await tx
      .update(stkItems)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(stkItems.id, id), eq(stkItems.orgId, ctx.tenantId)))
      .returning();
    return row ?? null;
  });
}

// ── Warehouses ───────────────────────────────────────────────────────────────

export function listWarehouses(ctx: CoreCtx): Promise<StkWarehouse[]> {
  return withOrgCore(ctx, (tx) => tx.select().from(stkWarehouses).where(eq(stkWarehouses.orgId, ctx.tenantId)).orderBy(asc(stkWarehouses.name)));
}

export type NewWarehouseInput = { name: string; parentId?: string | null };

export async function createWarehouse(ctx: CoreCtx, input: NewWarehouseInput): Promise<StkWarehouse> {
  return withOrgCore(ctx, async (tx) => {
    if (input.parentId) {
      const [parent] = await tx.select({ id: stkWarehouses.id }).from(stkWarehouses).where(and(eq(stkWarehouses.id, input.parentId), eq(stkWarehouses.orgId, ctx.tenantId)));
      if (!parent) throw new StockError('parent warehouse not found', 'parent_not_found');
    }
    const [row] = await tx.insert(stkWarehouses).values({ orgId: ctx.tenantId, name: input.name, parentId: input.parentId ?? null }).returning();
    return row;
  });
}

export async function updateWarehouse(ctx: CoreCtx, id: string, patch: Partial<NewWarehouseInput>): Promise<StkWarehouse | null> {
  return withOrgCore(ctx, async (tx) => {
    if (patch.parentId !== undefined && patch.parentId !== null) {
      const all = await tx.select({ id: stkWarehouses.id, parentId: stkWarehouses.parentId }).from(stkWarehouses).where(eq(stkWarehouses.orgId, ctx.tenantId));
      if (wouldCreateCycle(all, id, patch.parentId)) throw new StockError('would create a cycle in the warehouse tree', 'cycle');
    }
    const [row] = await tx
      .update(stkWarehouses)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(stkWarehouses.id, id), eq(stkWarehouses.orgId, ctx.tenantId)))
      .returning();
    return row ?? null;
  });
}

// ── Entries (draft CRUD) ─────────────────────────────────────────────────────

export interface NewEntryLineInput {
  itemId: string;
  qty: number;
  uom?: string | null;
  rate?: number | null;
  fromWarehouseId?: string | null;
  toWarehouseId?: string | null;
}

export interface NewEntryInput {
  type: EntryType;
  partyId?: string | null;
  note?: string | null;
  lines: NewEntryLineInput[];
}

function isEntryType(t: string): t is EntryType {
  return (ENTRY_TYPES as readonly string[]).includes(t);
}

export function listEntries(ctx: CoreCtx, filters: { status?: string; type?: string; partyId?: string } = {}): Promise<StkEntry[]> {
  return withOrgCore(ctx, (tx) => {
    const conds = [eq(stkEntries.orgId, ctx.tenantId)];
    if (filters.status) conds.push(eq(stkEntries.status, filters.status));
    if (filters.type) conds.push(eq(stkEntries.type, filters.type));
    if (filters.partyId) conds.push(eq(stkEntries.partyId, filters.partyId));
    return tx.select().from(stkEntries).where(and(...conds)).orderBy(desc(stkEntries.createdAt));
  });
}

export async function getEntry(ctx: CoreCtx, id: string): Promise<{ entry: StkEntry; lines: StkEntryLine[] } | null> {
  return withOrgCore(ctx, async (tx) => {
    const [entry] = await tx.select().from(stkEntries).where(and(eq(stkEntries.id, id), eq(stkEntries.orgId, ctx.tenantId)));
    if (!entry) return null;
    const lines = await tx.select().from(stkEntryLines).where(eq(stkEntryLines.entryId, id)).orderBy(asc(stkEntryLines.lineNo));
    return { entry, lines };
  });
}

function linesToRows(orgId: string, entryId: string, lines: NewEntryLineInput[]) {
  return lines.map((l, i) => ({
    orgId,
    entryId,
    itemId: l.itemId,
    qty: String(l.qty),
    uom: l.uom ?? null,
    rate: l.rate == null ? null : String(l.rate),
    fromWarehouseId: l.fromWarehouseId ?? null,
    toWarehouseId: l.toWarehouseId ?? null,
    lineNo: i,
  }));
}

export async function createEntry(ctx: CoreCtx, input: NewEntryInput, actor: Actor): Promise<StkEntry> {
  if (!isEntryType(input.type)) throw new StockError('invalid entry type', 'invalid_type');
  return withOrgCore(ctx, async (tx) => {
    const [entry] = await tx
      .insert(stkEntries)
      .values({ orgId: ctx.tenantId, type: input.type, status: 'draft', partyId: input.partyId ?? null, note: input.note ?? null, createdBy: actor.id })
      .returning();
    if (input.lines.length) await tx.insert(stkEntryLines).values(linesToRows(ctx.tenantId, entry.id, input.lines));
    return entry;
  });
}

export async function updateEntry(ctx: CoreCtx, id: string, input: Partial<NewEntryInput>): Promise<StkEntry | null> {
  return withOrgCore(ctx, async (tx) => {
    const [cur] = await tx.select().from(stkEntries).where(and(eq(stkEntries.id, id), eq(stkEntries.orgId, ctx.tenantId)));
    if (!cur) return null;
    if (cur.status !== 'draft') throw new StockError('only draft entries can be edited', 'not_draft');
    if (input.type !== undefined && !isEntryType(input.type)) throw new StockError('invalid entry type', 'invalid_type');

    if (input.type !== undefined || input.partyId !== undefined || input.note !== undefined) {
      await tx
        .update(stkEntries)
        .set({
          type: input.type ?? cur.type,
          partyId: input.partyId === undefined ? cur.partyId : input.partyId,
          note: input.note === undefined ? cur.note : input.note,
          updatedAt: new Date(),
        })
        .where(eq(stkEntries.id, id));
    }
    if (input.lines) {
      await tx.delete(stkEntryLines).where(eq(stkEntryLines.entryId, id));
      if (input.lines.length) await tx.insert(stkEntryLines).values(linesToRows(ctx.tenantId, id, input.lines));
    }
    const [row] = await tx.select().from(stkEntries).where(eq(stkEntries.id, id));
    return row;
  });
}

export async function deleteEntry(ctx: CoreCtx, id: string): Promise<boolean> {
  return withOrgCore(ctx, async (tx) => {
    const [cur] = await tx.select({ status: stkEntries.status }).from(stkEntries).where(and(eq(stkEntries.id, id), eq(stkEntries.orgId, ctx.tenantId)));
    if (!cur) return false;
    if (cur.status !== 'draft') throw new StockError('only draft entries can be deleted', 'not_draft');
    await tx.delete(stkEntryLines).where(eq(stkEntryLines.entryId, id));
    await tx.delete(stkEntries).where(eq(stkEntries.id, id));
    return true;
  });
}

// ── submit / cancel — the core invariant ────────────────────────────────────

type BinRow = { qty: string; valuationRate: string };

async function lockBins(tx: CoreTx, orgId: string, keys: Iterable<string>): Promise<Map<string, BinState>> {
  const out = new Map<string, BinState>();
  for (const key of keys) {
    const [itemId, warehouseId] = key.split(':');
    const [row] = (await tx
      .select({ qty: stkBins.qty, valuationRate: stkBins.valuationRate })
      .from(stkBins)
      .where(and(eq(stkBins.orgId, orgId), eq(stkBins.itemId, itemId), eq(stkBins.warehouseId, warehouseId)))
      .for('update')) as BinRow[];
    out.set(key, row ? { qty: Number(row.qty), rate: Number(row.valuationRate) } : { ...EMPTY_BIN });
  }
  return out;
}

async function writeBins(tx: CoreTx, orgId: string, bins: Map<string, BinState>): Promise<void> {
  for (const [key, bin] of bins) {
    const [itemId, warehouseId] = key.split(':');
    await tx
      .insert(stkBins)
      .values({ orgId, itemId, warehouseId, qty: String(bin.qty), valuationRate: String(bin.rate) })
      .onConflictDoUpdate({
        target: [stkBins.orgId, stkBins.itemId, stkBins.warehouseId],
        set: { qty: String(bin.qty), valuationRate: String(bin.rate), updatedAt: new Date() },
      });
  }
}

/**
 * Submit a draft entry: ONE withOrgCore tx that locks the entry row + every
 * touched bin (`select ... for update`, the boring-correct choice over
 * upsert-and-hope), validates lines, computes ledger deltas via
 * stock.logic.ts, enforces the negative-stock guard, writes the append-only
 * ledger, upserts bins, and stamps the naming-series human_id. recordAudit
 * runs in its own tx right after (matches the rest of the codebase — see
 * projects.service.ts / workflow.service.ts; audit is best-effort, not
 * part of the atomic invariant).
 */
export async function submitEntry(ctx: CoreCtx, id: string, actor: Actor): Promise<StkEntry> {
  const orgId = ctx.tenantId;
  const result = await withOrgCore(ctx, async (tx) => {
    const [entry] = await tx.select().from(stkEntries).where(and(eq(stkEntries.id, id), eq(stkEntries.orgId, orgId))).for('update');
    if (!entry) throw new StockError('entry not found', 'not_found');
    if (entry.status !== 'draft') throw new StockError(`entry is ${entry.status}, not draft`, 'not_draft'); // double-submit guard

    const lines = await tx.select().from(stkEntryLines).where(eq(stkEntryLines.entryId, id));
    if (!lines.length) throw new StockError('entry has no lines', 'no_lines');
    if (!isEntryType(entry.type)) throw new StockError('invalid entry type', 'invalid_type');
    const type = entry.type;

    const itemIds = [...new Set(lines.map((l) => l.itemId))];
    const items = await tx.select({ id: stkItems.id }).from(stkItems).where(and(eq(stkItems.orgId, orgId), inArray(stkItems.id, itemIds)));
    const itemIdSet = new Set(items.map((i) => i.id));
    const warehouseIds = [...new Set(lines.flatMap((l) => [l.fromWarehouseId, l.toWarehouseId]).filter((x): x is string => !!x))];
    const warehouses = warehouseIds.length
      ? await tx.select({ id: stkWarehouses.id }).from(stkWarehouses).where(and(eq(stkWarehouses.orgId, orgId), inArray(stkWarehouses.id, warehouseIds)))
      : [];
    const warehouseIdSet = new Set(warehouses.map((w) => w.id));

    const lineLikes = lines.map((l) => ({
      itemId: l.itemId,
      qty: Number(l.qty),
      rate: l.rate == null ? null : Number(l.rate),
      fromWarehouseId: l.fromWarehouseId,
      toWarehouseId: l.toWarehouseId,
    }));
    for (const l of lineLikes) {
      if (!itemIdSet.has(l.itemId)) throw new StockError(`item ${l.itemId} not found`, 'item_not_found');
      const errs = validateEntryLine(type, l);
      if (errs.length) throw new StockError(errs.join('; '), 'invalid_line');
      for (const wid of [l.fromWarehouseId, l.toWarehouseId]) {
        if (wid && !warehouseIdSet.has(wid)) throw new StockError(`warehouse ${wid} not found`, 'warehouse_not_found');
      }
    }

    const binKeys = new Set<string>();
    for (const l of lineLikes) for (const leg of expandLine(type, l)) binKeys.add(binKey(l.itemId, leg.warehouseId));
    const binMap = await lockBins(tx, orgId, binKeys);

    const ledgerInserts: Array<typeof stkLedger.$inferInsert> = [];
    for (const l of lineLikes) {
      const legs = expandLine(type, l);
      let carryRate: number | null = null; // transfer: the out-leg's rateUsed feeds the in-leg
      for (const leg of legs) {
        const key = binKey(l.itemId, leg.warehouseId);
        const bin = binMap.get(key)!;
        const rate = leg.rate ?? carryRate;
        if (leg.qtyDelta < 0 && !ALLOW_NEGATIVE_STOCK_V1 && wouldGoNegative(bin, leg.qtyDelta)) {
          throw new StockError(`insufficient stock for item ${l.itemId} in warehouse ${leg.warehouseId}`, 'negative_stock');
        }
        const { valueDelta, rateUsed } = computeLegValue(bin, leg.qtyDelta, rate);
        const next = applyLedgerDelta(bin, leg.qtyDelta, valueDelta);
        binMap.set(key, next);
        if (type === 'transfer' && leg.qtyDelta < 0) carryRate = rateUsed;
        ledgerInserts.push({
          orgId,
          itemId: l.itemId,
          warehouseId: leg.warehouseId,
          entryId: id,
          qtyDelta: String(leg.qtyDelta),
          qtyAfter: String(next.qty),
          valuationRate: String(next.rate),
          valueDelta: String(valueDelta),
        });
      }
    }

    await tx.insert(stkLedger).values(ledgerInserts);
    await writeBins(tx, orgId, binMap);

    const humanId = entry.humanId ?? (await nextSerialId(tx, orgId, 'STE-.YYYY.-', new Date()));
    const [updated] = await tx
      .update(stkEntries)
      .set({ status: 'submitted', humanId, postedAt: new Date(), updatedAt: new Date() })
      .where(eq(stkEntries.id, id))
      .returning();
    // Transactional — pg_notify only delivers on commit, so this rides the same
    // atomicity as the ledger/bin writes above (unlike recordAudit below, which
    // runs in its own tx per the codebase's existing convention).
    await emitHubEvent(tx, { type: 'stock.entry_submitted', orgId, entryId: id, entryType: type });
    return updated;
  });

  await recordAudit(ctx, {
    refType: 'stk_entry',
    refId: id,
    op: 'workflow',
    changes: [{ field: 'status', label: 'Submit', old: 'draft', new: 'submitted' }],
    actor,
  });
  return result;
}

/** Cancel a submitted entry: inserts REVERSING ledger rows (never deletes),
 *  same locking discipline as submit. Exact by construction — see
 *  applyLedgerDelta's doc comment on invertibility. */
export async function cancelEntry(ctx: CoreCtx, id: string, actor: Actor): Promise<StkEntry> {
  const orgId = ctx.tenantId;
  const result = await withOrgCore(ctx, async (tx) => {
    const [entry] = await tx.select().from(stkEntries).where(and(eq(stkEntries.id, id), eq(stkEntries.orgId, orgId))).for('update');
    if (!entry) throw new StockError('entry not found', 'not_found');
    if (entry.status !== 'submitted') throw new StockError(`entry is ${entry.status}, not submitted`, 'not_submitted');

    const origRows = await tx.select().from(stkLedger).where(and(eq(stkLedger.entryId, id), eq(stkLedger.orgId, orgId)));
    if (!origRows.length) throw new StockError('no ledger rows to reverse', 'no_ledger');

    const binKeys = new Set(origRows.map((r) => binKey(r.itemId, r.warehouseId)));
    const binMap = await lockBins(tx, orgId, binKeys);

    const ledgerInserts: Array<typeof stkLedger.$inferInsert> = [];
    for (const r of origRows) {
      const key = binKey(r.itemId, r.warehouseId);
      const bin = binMap.get(key)!;
      const qtyDelta = -Number(r.qtyDelta);
      const valueDelta = -Number(r.valueDelta);
      if (qtyDelta < 0 && !ALLOW_NEGATIVE_STOCK_V1 && wouldGoNegative(bin, qtyDelta)) {
        throw new StockError(`cancelling would take item ${r.itemId} in warehouse ${r.warehouseId} negative`, 'negative_stock');
      }
      const next = applyLedgerDelta(bin, qtyDelta, valueDelta);
      binMap.set(key, next);
      ledgerInserts.push({
        orgId,
        itemId: r.itemId,
        warehouseId: r.warehouseId,
        entryId: id,
        qtyDelta: String(qtyDelta),
        qtyAfter: String(next.qty),
        valuationRate: String(next.rate),
        valueDelta: String(valueDelta),
      });
    }

    await tx.insert(stkLedger).values(ledgerInserts);
    await writeBins(tx, orgId, binMap);

    const [updated] = await tx.update(stkEntries).set({ status: 'cancelled', updatedAt: new Date() }).where(eq(stkEntries.id, id)).returning();
    return updated;
  });

  await recordAudit(ctx, {
    refType: 'stk_entry',
    refId: id,
    op: 'workflow',
    changes: [{ field: 'status', label: 'Cancel', old: 'submitted', new: 'cancelled' }],
    actor,
  });
  return result;
}

// ── Queries: bins + ledger ───────────────────────────────────────────────────

export function getBins(ctx: CoreCtx, filters: { itemId?: string; warehouseId?: string } = {}): Promise<StkBin[]> {
  return withOrgCore(ctx, (tx) => {
    const conds = [eq(stkBins.orgId, ctx.tenantId)];
    if (filters.itemId) conds.push(eq(stkBins.itemId, filters.itemId));
    if (filters.warehouseId) conds.push(eq(stkBins.warehouseId, filters.warehouseId));
    return tx.select().from(stkBins).where(and(...conds));
  });
}

export function getLedger(ctx: CoreCtx, itemId: string, warehouseId?: string): Promise<StkLedgerRow[]> {
  return withOrgCore(ctx, (tx) => {
    const conds = [eq(stkLedger.orgId, ctx.tenantId), eq(stkLedger.itemId, itemId)];
    if (warehouseId) conds.push(eq(stkLedger.warehouseId, warehouseId));
    return tx.select().from(stkLedger).where(and(...conds)).orderBy(desc(stkLedger.postedAt), desc(stkLedger.id));
  });
}

/** Most recent org-wide movements, across all items — the /stock overview's
 *  "recent movements" card. Not item-scoped (unlike getLedger), so it's a
 *  separate small query rather than an optional param on getLedger. */
export function getRecentLedger(ctx: CoreCtx, limit = 20): Promise<StkLedgerRow[]> {
  return withOrgCore(ctx, (tx) =>
    tx.select().from(stkLedger).where(eq(stkLedger.orgId, ctx.tenantId)).orderBy(desc(stkLedger.postedAt), desc(stkLedger.id)).limit(limit),
  );
}

// ── rebuildBins — recovery path ──────────────────────────────────────────────

export interface RebuildResult {
  itemsAffected: number;
  binsWritten: number;
}

/** Replays the ledger into bins (bins are a cache; the ledger is truth).
 *  Scoped to one item when `itemId` is given, else the whole org. */
export async function rebuildBins(ctx: CoreCtx, itemId?: string): Promise<RebuildResult> {
  const orgId = ctx.tenantId;
  return withOrgCore(ctx, async (tx) => {
    const conds = [eq(stkLedger.orgId, orgId)];
    if (itemId) conds.push(eq(stkLedger.itemId, itemId));
    const rows = await tx.select().from(stkLedger).where(and(...conds));

    const replay: LedgerReplayRow[] = rows.map((r) => ({
      itemId: r.itemId,
      warehouseId: r.warehouseId,
      seq: r.id,
      qtyAfter: Number(r.qtyAfter),
      valuationRate: Number(r.valuationRate),
    }));
    const bins = replayBins(replay);

    const binConds = [eq(stkBins.orgId, orgId)];
    if (itemId) binConds.push(eq(stkBins.itemId, itemId));
    await tx.delete(stkBins).where(and(...binConds));
    for (const bin of bins.values()) {
      await tx.insert(stkBins).values({ orgId, itemId: bin.itemId, warehouseId: bin.warehouseId, qty: String(bin.qty), valuationRate: String(bin.rate) });
    }
    return { itemsAffected: new Set([...bins.values()].map((b) => b.itemId)).size, binsWritten: bins.size };
  });
}

// ── Reorder alerts — plugs into the generic notifications tick ──────────────
// Registers a candidate source (mirrors bg-runtime's registerJobHandler): an
// org admin can create a notif_rules row with trigger_table='stk_reorder'
// through the EXISTING /api/notifications/rules CRUD — no new UI needed. The
// dedupe triggerKey notif.service.ts uses for sourced rules is a permanent
// 'threshold' key (matches the plan's resolution: reuse notif_log's existing
// once-per-(rule,entity,key) dedupe rather than adding a state column) —
// ponytail ceiling: a bin alerts once and stays claimed even if it recovers
// above reorder_level and dips again; re-arming needs a recovery marker or a
// ledger scan, add if someone hits it.
registerNotifCandidateSource('stk_reorder', async (tx, orgId) => {
  const rows = (await tx.execute(sql`
    select b.item_id || ':' || b.warehouse_id as id, i.code as item_code, i.name as item_name,
           w.name as warehouse_name, b.qty, i.reorder_level, i.reorder_qty
    from stk_bins b
    join stk_items i on i.id = b.item_id and i.org_id = b.org_id
    join stk_warehouses w on w.id = b.warehouse_id and w.org_id = b.org_id
    where b.org_id = ${orgId} and i.reorder_level is not null and b.qty <= i.reorder_level
  `)) as unknown as Array<Record<string, unknown>>;
  return rows;
});

// ── Consumption map (P5.1) — fin_product → stk_items consumed per unit ─────

export interface ConsumptionRow {
  id: string;
  finProductId: string;
  productName: string;
  productCode: string;
  itemId: string;
  itemName: string;
  itemCode: string;
  uom: string;
  consumptionUom: string | null;
  unitsPerStockUom: number | null;
  subunitsPerStockUom: number | null;
  diagramEnabled: boolean;
  qtyPerUnit: number;
  note: string | null;
}

export function listConsumption(ctx: CoreCtx, filters: { finProductId?: string; itemId?: string } = {}): Promise<ConsumptionRow[]> {
  return withOrgCore(ctx, async (tx) => {
    const conds = [eq(stkConsumption.orgId, ctx.tenantId)];
    if (filters.finProductId) conds.push(eq(stkConsumption.finProductId, filters.finProductId));
    if (filters.itemId) conds.push(eq(stkConsumption.itemId, filters.itemId));
    const rows = await tx
      .select({
        id: stkConsumption.id,
        finProductId: stkConsumption.finProductId,
        productName: finProducts.name,
        productCode: finProducts.code,
        itemId: stkConsumption.itemId,
        itemName: stkItems.name,
        itemCode: stkItems.code,
        uom: stkItems.uom,
        consumptionUom: stkItems.consumptionUom,
        unitsPerStockUom: stkItems.unitsPerStockUom,
        subunitsPerStockUom: stkItems.subunitsPerStockUom,
        diagramEnabled: stkItems.diagramEnabled,
        qtyPerUnit: stkConsumption.qtyPerUnit,
        note: stkConsumption.note,
      })
      .from(stkConsumption)
      .innerJoin(finProducts, eq(finProducts.id, stkConsumption.finProductId))
      .innerJoin(stkItems, eq(stkItems.id, stkConsumption.itemId))
      .where(and(...conds))
      .orderBy(asc(finProducts.name), asc(stkItems.name));
    return rows.map((r) => ({
      ...r,
      qtyPerUnit: Number(r.qtyPerUnit),
      unitsPerStockUom: r.unitsPerStockUom == null ? null : Number(r.unitsPerStockUom),
      subunitsPerStockUom: r.subunitsPerStockUom == null ? null : Number(r.subunitsPerStockUom),
    }));
  });
}

/** Read a single mapping row by id (PATCH route needs the (finProductId, itemId)
 *  natural key before it can call setConsumption's upsert). */
export async function getConsumptionById(ctx: CoreCtx, id: string): Promise<StkConsumption | null> {
  return withOrgCore(ctx, async (tx) => {
    const [row] = await tx.select().from(stkConsumption).where(and(eq(stkConsumption.id, id), eq(stkConsumption.orgId, ctx.tenantId)));
    return row ?? null;
  });
}

export interface SetConsumptionInput {
  finProductId: string;
  itemId: string;
  qtyPerUnit: number;
  note?: string | null;
}

/** Upsert on the (org, fin_product, item) unique key. Validates the item is a
 *  real stock item (not a service-only / non-stock row) and the fin_product
 *  belongs to this org — both are soft refs (no DB FK to fin_products), so
 *  this is the only place that catches a typo'd id. Logs the old→new
 *  qty_per_unit to doc_audit_log (best-effort, own tx — same convention as
 *  submitEntry/cancelEntry above); a no-op change (e.g. only `note` patched)
 *  emits nothing, per recordAudit's own empty-changes guard. */
export async function setConsumption(ctx: CoreCtx, input: SetConsumptionInput, actor: Actor): Promise<StkConsumption> {
  if (!(input.qtyPerUnit > 0)) throw new StockError('qtyPerUnit must be > 0', 'invalid_qty');
  const { row, oldQtyPerUnit } = await withOrgCore(ctx, async (tx) => {
    const [item] = await tx
      .select({ id: stkItems.id, isStockItem: stkItems.isStockItem })
      .from(stkItems)
      .where(and(eq(stkItems.id, input.itemId), eq(stkItems.orgId, ctx.tenantId)));
    if (!item) throw new StockError('item not found', 'item_not_found');
    if (!item.isStockItem) throw new StockError('item is not a stock item', 'not_stock_item');

    const [product] = await tx
      .select({ id: finProducts.id })
      .from(finProducts)
      .where(and(eq(finProducts.id, input.finProductId), eq(finProducts.orgId, ctx.tenantId)));
    if (!product) throw new StockError('fin product not found', 'product_not_found');

    const [existing] = await tx
      .select({ qtyPerUnit: stkConsumption.qtyPerUnit })
      .from(stkConsumption)
      .where(and(eq(stkConsumption.orgId, ctx.tenantId), eq(stkConsumption.finProductId, input.finProductId), eq(stkConsumption.itemId, input.itemId)));

    const [row] = await tx
      .insert(stkConsumption)
      .values({ orgId: ctx.tenantId, finProductId: input.finProductId, itemId: input.itemId, qtyPerUnit: String(input.qtyPerUnit), note: input.note ?? null })
      .onConflictDoUpdate({
        target: [stkConsumption.orgId, stkConsumption.finProductId, stkConsumption.itemId],
        set: { qtyPerUnit: String(input.qtyPerUnit), note: input.note ?? null, updatedAt: new Date() },
      })
      .returning();
    return { row, oldQtyPerUnit: existing ? Number(existing.qtyPerUnit) : null };
  });

  await recordAudit(ctx, {
    refType: 'stk_consumption',
    refId: row.id,
    op: oldQtyPerUnit == null ? 'create' : 'update',
    changes: oldQtyPerUnit === input.qtyPerUnit ? [] : [{ field: 'qtyPerUnit', label: 'Qty per unit', old: oldQtyPerUnit, new: input.qtyPerUnit }],
    actor,
  });
  return row;
}

export async function deleteConsumption(ctx: CoreCtx, id: string): Promise<boolean> {
  return withOrgCore(ctx, async (tx) => {
    const res = await tx
      .delete(stkConsumption)
      .where(and(eq(stkConsumption.id, id), eq(stkConsumption.orgId, ctx.tenantId)))
      .returning({ id: stkConsumption.id });
    return res.length > 0;
  });
}

// ── Invoice ↔ stock interconnect (P5.1) ──────────────────────────────────────
// NEVER writes fin_* rows — the invoice→stock link lives entirely in
// stk_entries.metadata ({source:'invoice', invoiceId, providerRef}); SUSII sync
// delete-replaces fin_invoice_items on every run (finance.service.ts), so
// anything written back there would be silently wiped on the next sync.

export interface InvoicePreviewLine {
  itemId: string;
  itemName: string;
  itemCode: string;
  uom: string;
  /** Stock uom, converted from qtyConsumption and rounded to 4dp — what
   *  actually posts to the ledger. Kept for existing UI callers. */
  qty: number;
  /** Stock uom (existing field, unchanged shape). */
  available: number;
  /** Raw aggregated qty in the item's CONSUMPTION uom (== stock uom when the
   *  item has none set — `qty` above is then identical). */
  qtyConsumption: number;
  consumptionUom: string | null;
  unitsPerStockUom: number | null;
  subunitsPerStockUom: number | null;
  diagramEnabled: boolean;
}

export interface InvoicePreviewUnmatched {
  description: string;
  quantity: number;
}

export interface InvoicePreview {
  lines: InvoicePreviewLine[];
  unmatched: InvoicePreviewUnmatched[];
}

/**
 * Aggregates one invoice's line items into stock-issue lines via two paths:
 *  1. stk_consumption mapping (qty = invoice qty × qty_per_unit), and
 *  2. a 1:1 retail fallback for invoice items whose product maps directly to
 *     a stk_items.fin_product_id (is_stock_item) — but only when path 1 found
 *     NO mapping for that product (dedupe: a mapped product never also falls
 *     back to 1:1).
 * Invoice items hitting neither path are reported in `unmatched` (name-only —
 * nothing to act on without a mapping).
 */
export async function buildInvoiceIssuePreview(ctx: CoreCtx, invoiceId: string, warehouseId: string): Promise<InvoicePreview> {
  return withOrgCore(ctx, async (tx) => {
    const [invoice] = await tx.select({ id: finInvoices.id }).from(finInvoices).where(and(eq(finInvoices.id, invoiceId), eq(finInvoices.orgId, ctx.tenantId)));
    if (!invoice) throw new StockError('invoice not found', 'invoice_not_found');

    const invoiceItems = await tx
      .select({ productId: finInvoiceItems.productId, description: finInvoiceItems.description, quantity: finInvoiceItems.quantity })
      .from(finInvoiceItems)
      .where(eq(finInvoiceItems.invoiceId, invoiceId));

    const productIds = [...new Set(invoiceItems.map((i) => i.productId).filter((id): id is string => !!id))];

    const mappingRows = await tx
      .select({ finProductId: stkConsumption.finProductId, itemId: stkConsumption.itemId, qtyPerUnit: stkConsumption.qtyPerUnit })
      .from(stkConsumption)
      .where(and(eq(stkConsumption.orgId, ctx.tenantId), inArray(stkConsumption.finProductId, productIds)));
    const mappingsByProduct = new Map<string, { itemId: string; qtyPerUnit: number }[]>();
    for (const m of mappingRows) {
      const list = mappingsByProduct.get(m.finProductId) ?? [];
      list.push({ itemId: m.itemId, qtyPerUnit: Number(m.qtyPerUnit) });
      mappingsByProduct.set(m.finProductId, list);
    }

    // 1:1 fallback candidates — retail products sold as themselves. Only used
    // for products with NO mapping row (see dedupe above); if a product maps
    // to several stk_items with is_stock_item, the first one wins (ponytail:
    // no observed case needs more than one 1:1 fallback item per product —
    // upgrade to an explicit priority column if that ever changes).
    const fallbackItems = await tx
      .select({ id: stkItems.id, finProductId: stkItems.finProductId })
      .from(stkItems)
      .where(and(eq(stkItems.orgId, ctx.tenantId), eq(stkItems.isStockItem, true), inArray(stkItems.finProductId, productIds)));
    const fallbackByProduct = new Map<string, string>();
    for (const row of fallbackItems) {
      if (row.finProductId && !fallbackByProduct.has(row.finProductId)) fallbackByProduct.set(row.finProductId, row.id);
    }

    const qtyByItem = new Map<string, number>();
    const unmatched: InvoicePreviewUnmatched[] = [];
    for (const line of invoiceItems) {
      const quantity = Number(line.quantity ?? 0);
      if (!line.productId) {
        unmatched.push({ description: line.description ?? '(no description)', quantity });
        continue;
      }
      const mappings = mappingsByProduct.get(line.productId);
      if (mappings?.length) {
        for (const m of mappings) qtyByItem.set(m.itemId, (qtyByItem.get(m.itemId) ?? 0) + quantity * m.qtyPerUnit);
        continue;
      }
      const fallbackItemId = fallbackByProduct.get(line.productId);
      if (fallbackItemId) {
        qtyByItem.set(fallbackItemId, (qtyByItem.get(fallbackItemId) ?? 0) + quantity);
        continue;
      }
      unmatched.push({ description: line.description ?? '(no description)', quantity });
    }

    const lines = await previewLinesForItemQtys(tx, ctx.tenantId, qtyByItem, warehouseId);
    return { lines, unmatched };
  });
}

/**
 * Shared preview tail for both the invoice and the service paths: given a
 * per-item aggregate in each item's CONSUMPTION uom (identity when the item has
 * no consumptionUom), joins item metadata + warehouse bins and builds the
 * gauge-ready lines (stock-uom `qty` converted authoritatively, plus the raw
 * consumption qty and UOM fields the ConsumptionGauge needs).
 */
async function previewLinesForItemQtys(
  tx: CoreTx,
  orgId: string,
  qtyByItem: Map<string, number>,
  warehouseId: string,
): Promise<InvoicePreviewLine[]> {
  const itemIds = [...qtyByItem.keys()];
  if (!itemIds.length) return [];
  const itemRows = await tx
    .select({
      id: stkItems.id,
      name: stkItems.name,
      code: stkItems.code,
      uom: stkItems.uom,
      consumptionUom: stkItems.consumptionUom,
      unitsPerStockUom: stkItems.unitsPerStockUom,
      subunitsPerStockUom: stkItems.subunitsPerStockUom,
      diagramEnabled: stkItems.diagramEnabled,
    })
    .from(stkItems)
    .where(inArray(stkItems.id, itemIds));
  const itemById = new Map(itemRows.map((r) => [r.id, r]));

  const binRows = await tx
    .select({ itemId: stkBins.itemId, qty: stkBins.qty })
    .from(stkBins)
    .where(and(eq(stkBins.orgId, orgId), eq(stkBins.warehouseId, warehouseId), inArray(stkBins.itemId, itemIds)));
  const availableByItem = new Map(binRows.map((r) => [r.itemId, Number(r.qty)]));

  return itemIds.map((itemId) => {
    const item = itemById.get(itemId);
    const qtyConsumption = qtyByItem.get(itemId)!;
    const unitsPerStockUom = item?.unitsPerStockUom == null ? null : Number(item.unitsPerStockUom);
    return {
      itemId,
      itemName: item?.name ?? itemId,
      itemCode: item?.code ?? '',
      uom: item?.uom ?? 'unit',
      qty: round4(consumptionToStockQty({ unitsPerStockUom }, qtyConsumption)),
      available: availableByItem.get(itemId) ?? 0,
      qtyConsumption,
      consumptionUom: item?.consumptionUom ?? null,
      unitsPerStockUom,
      subunitsPerStockUom: item?.subunitsPerStockUom == null ? null : Number(item.subunitsPerStockUom),
      diagramEnabled: item?.diagramEnabled ?? false,
    };
  });
}

/**
 * Converts client-supplied lines to ledger (stock-uom) qty. Lines carrying a
 * `qtyConsumption` are converted authoritatively server-side (the client's own
 * `qty` is ignored) — the server owns the conversion factor, not the caller's
 * arithmetic. Shared by the invoice and service issue paths.
 */
async function resolveConsumptionLines(
  tx: CoreTx,
  orgId: string,
  lines: CreateIssueFromInvoiceLine[],
): Promise<{ itemId: string; qty: number }[]> {
  const convertItemIds = [...new Set(lines.filter((l) => l.qtyConsumption != null).map((l) => l.itemId))];
  const unitsPerStockUomByItem = new Map<string, number | null>();
  if (convertItemIds.length) {
    const rows = await tx
      .select({ id: stkItems.id, unitsPerStockUom: stkItems.unitsPerStockUom })
      .from(stkItems)
      .where(and(eq(stkItems.orgId, orgId), inArray(stkItems.id, convertItemIds)));
    for (const r of rows) unitsPerStockUomByItem.set(r.id, r.unitsPerStockUom == null ? null : Number(r.unitsPerStockUom));
  }
  return lines.map((l) => {
    if (l.qtyConsumption == null) return { itemId: l.itemId, qty: l.qty };
    const unitsPerStockUom = unitsPerStockUomByItem.get(l.itemId) ?? null;
    return { itemId: l.itemId, qty: round4(consumptionToStockQty({ unitsPerStockUom }, l.qtyConsumption)) };
  });
}

export interface ServicePreview {
  productName: string;
  productCode: string | null;
  lines: InvoicePreviewLine[];
  /** Service products consume only via stk_consumption — a product with no
   *  mapping rows yields an empty preview; `hasMapping` lets the UI say so
   *  rather than render a blank issue. */
  hasMapping: boolean;
}

/**
 * Preview the stock a service/product consumes for `quantity` units performed,
 * with no invoice — reads `stk_consumption` for the product and multiplies each
 * mapped item by `quantity × qty_per_unit`. Mirrors the invoice path's tail so
 * the gauge renders identically; there is no 1:1 retail fallback here (a
 * service consumes what its mapping declares, nothing implicit).
 */
export async function buildServiceIssuePreview(
  ctx: CoreCtx,
  input: { finProductId: string; quantity: number; warehouseId: string },
): Promise<ServicePreview> {
  const quantity = input.quantity > 0 ? input.quantity : 1;
  return withOrgCore(ctx, async (tx) => {
    const [product] = await tx
      .select({ id: finProducts.id, name: finProducts.name, code: finProducts.code })
      .from(finProducts)
      .where(and(eq(finProducts.id, input.finProductId), eq(finProducts.orgId, ctx.tenantId)));
    if (!product) throw new StockError('product not found', 'product_not_found');

    const mappingRows = await tx
      .select({ itemId: stkConsumption.itemId, qtyPerUnit: stkConsumption.qtyPerUnit })
      .from(stkConsumption)
      .where(and(eq(stkConsumption.orgId, ctx.tenantId), eq(stkConsumption.finProductId, input.finProductId)));

    const qtyByItem = new Map<string, number>();
    for (const m of mappingRows) qtyByItem.set(m.itemId, (qtyByItem.get(m.itemId) ?? 0) + quantity * Number(m.qtyPerUnit));

    const lines = await previewLinesForItemQtys(tx, ctx.tenantId, qtyByItem, input.warehouseId);
    return { productName: product.name ?? input.finProductId, productCode: product.code ?? null, lines, hasMapping: mappingRows.length > 0 };
  });
}

export interface CreateServiceIssueInput {
  finProductId: string;
  quantity: number;
  warehouseId: string;
  partyId?: string | null;
  note?: string | null;
  lines: CreateIssueFromInvoiceLine[];
  submit?: boolean;
  actor: Actor;
}

/**
 * Creates (and optionally submits) an `issue` stk_entry for a service performed
 * for a customer, no invoice required. Same append-only ledger path as the
 * invoice issue; the customer rides `party_id` and the procedure notes ride
 * `note`. metadata `{source:'service', finProductId, quantity}` mirrors the
 * invoice link so the item-detail "issued for" views can find it. No duplicate
 * guard — the same service is legitimately performed many times.
 */
export async function createServiceIssue(ctx: CoreCtx, input: CreateServiceIssueInput): Promise<StkEntry> {
  if (!input.lines.length) throw new StockError('at least one stock line is required', 'no_lines');

  const entry = await withOrgCore(ctx, async (tx) => {
    const [product] = await tx
      .select({ id: finProducts.id, name: finProducts.name })
      .from(finProducts)
      .where(and(eq(finProducts.id, input.finProductId), eq(finProducts.orgId, ctx.tenantId)));
    if (!product) throw new StockError('product not found', 'product_not_found');

    const resolvedLines = await resolveConsumptionLines(tx, ctx.tenantId, input.lines);

    const [row] = await tx
      .insert(stkEntries)
      .values({
        orgId: ctx.tenantId,
        type: 'issue',
        status: 'draft',
        partyId: input.partyId ?? null,
        note: input.note ?? `Service: ${product.name}`,
        createdBy: input.actor.id,
        metadata: { source: 'service', finProductId: input.finProductId, quantity: input.quantity },
      })
      .returning();
    await tx.insert(stkEntryLines).values(
      linesToRows(
        ctx.tenantId,
        row.id,
        resolvedLines.map((l) => ({ itemId: l.itemId, qty: l.qty, fromWarehouseId: input.warehouseId })),
      ),
    );
    return row;
  });

  return input.submit ? submitEntry(ctx, entry.id, input.actor) : entry;
}

export interface CreateIssueFromInvoiceLine {
  itemId: string;
  /** Stock uom — ignored when `qtyConsumption` is present (server converts
   *  authoritatively instead of trusting the client's arithmetic). */
  qty: number;
  /** Optional: qty in the item's CONSUMPTION uom. When set, wins over `qty`. */
  qtyConsumption?: number | null;
}

export interface CreateIssueFromInvoiceInput {
  invoiceId: string;
  warehouseId: string;
  lines: CreateIssueFromInvoiceLine[];
  submit?: boolean;
  actor: Actor;
}

/** Creates (and optionally submits) an `issue` stk_entry for an invoice's
 *  computed stock lines. Guards against double-issuing the same invoice via
 *  a non-cancelled entry with the same metadata.invoiceId — checked and
 *  inserted in the same withOrgCore tx, so two concurrent calls still race on
 *  the row lock rather than both slipping through (ponytail: no partial
 *  unique index on metadata->>'invoiceId' backs this — the migration's
 *  already applied to prod, so add one in a follow-up if this guard is ever
 *  found to lose the race in practice). */
export async function createIssueFromInvoice(ctx: CoreCtx, input: CreateIssueFromInvoiceInput): Promise<StkEntry> {
  if (!input.lines.length) throw new StockError('at least one stock line is required', 'no_lines');

  const entry = await withOrgCore(ctx, async (tx) => {
    const [invoice] = await tx
      .select({ id: finInvoices.id, providerRef: finInvoices.providerRef })
      .from(finInvoices)
      .where(and(eq(finInvoices.id, input.invoiceId), eq(finInvoices.orgId, ctx.tenantId)));
    if (!invoice) throw new StockError('invoice not found', 'invoice_not_found');

    const [dup] = await tx
      .select({ id: stkEntries.id })
      .from(stkEntries)
      .where(and(eq(stkEntries.orgId, ctx.tenantId), ne(stkEntries.status, 'cancelled'), sql`${stkEntries.metadata}->>'invoiceId' = ${input.invoiceId}`));
    if (dup) throw new StockError('a stock issue already exists for this invoice', 'duplicate_invoice');

    const resolvedLines = await resolveConsumptionLines(tx, ctx.tenantId, input.lines);

    const [row] = await tx
      .insert(stkEntries)
      .values({
        orgId: ctx.tenantId,
        type: 'issue',
        status: 'draft',
        note: `Invoice issue: ${invoice.providerRef}`,
        createdBy: input.actor.id,
        metadata: { source: 'invoice', invoiceId: input.invoiceId, providerRef: invoice.providerRef },
      })
      .returning();
    await tx.insert(stkEntryLines).values(
      linesToRows(
        ctx.tenantId,
        row.id,
        resolvedLines.map((l) => ({ itemId: l.itemId, qty: l.qty, fromWarehouseId: input.warehouseId })),
      ),
    );
    return row;
  });

  return input.submit ? submitEntry(ctx, entry.id, input.actor) : entry;
}

export interface EntryByInvoiceSummary {
  id: string;
  humanId: string | null;
  status: string;
  type: string;
  postedAt: Date | null;
}

/** Most recent stk_entry linked to this invoice via metadata.invoiceId (any
 *  status — the invoice-detail card wants to show "cancelled" too, not just
 *  hide it), or null when none exists yet. */
export async function findEntryByInvoice(ctx: CoreCtx, invoiceId: string): Promise<EntryByInvoiceSummary | null> {
  return withOrgCore(ctx, async (tx) => {
    const [row] = await tx
      .select({ id: stkEntries.id, humanId: stkEntries.humanId, status: stkEntries.status, type: stkEntries.type, postedAt: stkEntries.postedAt })
      .from(stkEntries)
      .where(and(eq(stkEntries.orgId, ctx.tenantId), sql`${stkEntries.metadata}->>'invoiceId' = ${invoiceId}`))
      .orderBy(desc(stkEntries.createdAt))
      .limit(1);
    return row ?? null;
  });
}

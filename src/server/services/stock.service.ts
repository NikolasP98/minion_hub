import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
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
  type StkItem,
  type StkWarehouse,
  type StkEntry,
  type StkEntryLine,
  type StkBin,
  type StkLedgerRow,
} from '$server/db/pg-schema/stock';
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

export type NewItemInput = Omit<typeof stkItems.$inferInsert, 'id' | 'orgId' | 'createdAt' | 'updatedAt'>;

export async function createItem(ctx: CoreCtx, input: NewItemInput): Promise<StkItem> {
  const [row] = await withOrgCore(ctx, (tx) => tx.insert(stkItems).values({ ...input, orgId: ctx.tenantId }).returning());
  return row;
}

export async function updateItem(ctx: CoreCtx, id: string, patch: Partial<NewItemInput>): Promise<StkItem | null> {
  const [row] = await withOrgCore(ctx, (tx) =>
    tx
      .update(stkItems)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(stkItems.id, id), eq(stkItems.orgId, ctx.tenantId)))
      .returning(),
  );
  return row ?? null;
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

export function listEntries(ctx: CoreCtx, filters: { status?: string; type?: string } = {}): Promise<StkEntry[]> {
  return withOrgCore(ctx, (tx) => {
    const conds = [eq(stkEntries.orgId, ctx.tenantId)];
    if (filters.status) conds.push(eq(stkEntries.status, filters.status));
    if (filters.type) conds.push(eq(stkEntries.type, filters.type));
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

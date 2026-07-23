import { and, asc, desc, eq, gte, inArray, lte, ne, sql } from 'drizzle-orm';
import { withOrgCore, type CoreTx } from '$server/db/with-org-core';
import type { CoreCtx } from '$server/auth/core-ctx';
import {
  posSettings,
  posShifts,
  posTickets,
  posTicketLines,
  posPayments,
  type PosShift,
  type PosTicket,
  type PosTicketLine,
  type PosPayment,
} from '$server/db/pg-pos-schema';
import { nextSerialId } from './naming-series';
import { isModuleEnabled } from './modules.service';
import { resolveDefaultWarehouse } from './stock-accruals.service';
import {
  createSourcedIssue,
  findEntryBySource,
  submitEntry,
  cancelEntry,
  StockError,
  createItem,
  updateItem,
  setConsumption,
  deleteConsumption,
  listConsumption,
  listAllComponentEdges,
  type CreateIssueFromInvoiceLine,
} from './stock.service';
import {
  edgesByParent,
  explodeIssueRoots,
  round4,
  type ComponentEdge,
  type IssueRoot,
  type LineModifier,
} from './stock.logic';
import { stkItems, stkConsumption } from '$server/db/pg-schema/stock';
import { finProducts } from '$server/db/pg-finance-schema';
import { upsertProduct } from './finance-products.service';
import { emitHubEvent } from '$server/events/emit';

export class PosError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = 'PosError';
  }
}

export interface Actor {
  id: string | null;
  name: string | null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

// ---- settings ----

export interface PosSettings {
  methods: string[];
  currency: string;
  requireCustomer: boolean;
  allowPriceOverride: boolean;
}

// Frozen (incl. the methods array) so a stray in-place mutation throws instead
// of silently corrupting defaults for every org in the process.
export const DEFAULT_POS_SETTINGS: PosSettings = Object.freeze({
  methods: Object.freeze(['cash', 'card', 'yape', 'plin', 'transfer']) as string[],
  currency: 'PEN',
  requireCustomer: false,
  allowPriceOverride: true,
});

export async function getPosSettings(ctx: CoreCtx): Promise<PosSettings> {
  const [row] = await withOrgCore(ctx, (tx) =>
    tx.select().from(posSettings).where(eq(posSettings.orgId, ctx.tenantId)).limit(1),
  );
  // Defensive copy — callers get a mutable object, never the shared singleton.
  if (!row) return { ...DEFAULT_POS_SETTINGS, methods: [...DEFAULT_POS_SETTINGS.methods] };
  return {
    methods: row.methods as string[],
    currency: row.currency,
    requireCustomer: row.requireCustomer,
    allowPriceOverride: row.allowPriceOverride,
  };
}

export async function updatePosSettings(
  ctx: CoreCtx,
  patch: Partial<PosSettings>,
): Promise<PosSettings> {
  const current = await getPosSettings(ctx);
  const next: PosSettings = { ...current, ...patch };
  if (
    !Array.isArray(next.methods) ||
    next.methods.length === 0 ||
    next.methods.some((m) => typeof m !== 'string' || m !== m.toLowerCase() || m.length === 0)
  ) {
    throw new PosError(
      'methods must be a non-empty array of non-empty lowercase strings',
      'invalid_methods',
    );
  }
  const [row] = await withOrgCore(ctx, (tx) =>
    tx
      .insert(posSettings)
      .values({ orgId: ctx.tenantId, ...next })
      .onConflictDoUpdate({ target: posSettings.orgId, set: { ...next, updatedAt: new Date() } })
      .returning(),
  );
  return {
    methods: row.methods as string[],
    currency: row.currency,
    requireCustomer: row.requireCustomer,
    allowPriceOverride: row.allowPriceOverride,
  };
}

// ---- shifts ----

export interface ShiftSummary {
  ticketCount: number;
  voidCount: number;
  gross: number;
  byMethod: Record<string, number>;
}

const NON_VOID = ne(posTickets.status, 'void');

/**
 * Expected drawer amounts at close: per-method payment sums, plus the opening
 * float folded into cash ONLY (per the brief — the physical drawer starts with
 * a float; electronic methods have no starting balance to reconcile).
 * Pure, so the math is unit-testable without a db.
 */
export function computeExpected(
  byMethod: Record<string, number>,
  openingFloat: Record<string, number>,
): Record<string, number> {
  const expected = { ...byMethod };
  expected.cash = round2((expected.cash ?? 0) + Number(openingFloat.cash ?? 0));
  return expected;
}

/** Per-method payment sums, joined to non-void tickets, for one shift. */
async function paymentsByMethod(
  tx: CoreTx,
  orgId: string,
  shiftId: string,
): Promise<Record<string, number>> {
  const rows = await tx
    .select({ method: posPayments.method, amount: posPayments.amount })
    .from(posPayments)
    .innerJoin(posTickets, eq(posTickets.id, posPayments.ticketId))
    .where(and(eq(posPayments.orgId, orgId), eq(posPayments.shiftId, shiftId), NON_VOID));
  const byMethod: Record<string, number> = {};
  for (const r of rows) {
    byMethod[r.method] = round2((byMethod[r.method] ?? 0) + Number(r.amount));
  }
  return byMethod;
}

export async function getOpenShift(
  ctx: CoreCtx,
): Promise<{ shift: PosShift; summary: ShiftSummary } | null> {
  const [shift] = await withOrgCore(ctx, (tx) =>
    tx
      .select()
      .from(posShifts)
      .where(and(eq(posShifts.orgId, ctx.tenantId), eq(posShifts.status, 'open')))
      .limit(1),
  );
  if (!shift) return null;
  const summary = await shiftSummary(ctx, shift.id);
  return { shift, summary };
}

export async function openShift(
  ctx: CoreCtx,
  input: { openingFloat: Record<string, number>; actor: Actor },
): Promise<PosShift> {
  return withOrgCore(ctx, async (tx) => {
    const [existing] = await tx
      .select({ id: posShifts.id })
      .from(posShifts)
      .where(and(eq(posShifts.orgId, ctx.tenantId), eq(posShifts.status, 'open')))
      .limit(1);
    if (existing) throw new PosError('a shift is already open for this org', 'shift_already_open');

    const [shift] = await tx
      .insert(posShifts)
      .values({ orgId: ctx.tenantId, openedBy: input.actor.id, openingFloat: input.openingFloat })
      .returning();
    return shift;
  });
}

export async function closeShift(
  ctx: CoreCtx,
  input: { counted: Record<string, number>; note?: string | null; actor: Actor },
): Promise<PosShift> {
  return withOrgCore(ctx, async (tx) => {
    const [open] = await tx
      .select()
      .from(posShifts)
      .where(and(eq(posShifts.orgId, ctx.tenantId), eq(posShifts.status, 'open')))
      .limit(1);
    if (!open) throw new PosError('no open shift for this org', 'no_open_shift');

    const byMethod = await paymentsByMethod(tx, ctx.tenantId, open.id);
    const expected = computeExpected(byMethod, (open.openingFloat as Record<string, number>) ?? {});

    const [closed] = await tx
      .update(posShifts)
      .set({
        status: 'closed',
        closedBy: input.actor.id,
        closedAt: new Date(),
        expected,
        counted: input.counted,
        note: input.note ?? null,
        updatedAt: new Date(),
      })
      .where(and(eq(posShifts.id, open.id), eq(posShifts.orgId, ctx.tenantId)))
      .returning();
    return closed;
  });
}

export function listShifts(ctx: CoreCtx, opts: { limit?: number } = {}): Promise<PosShift[]> {
  return withOrgCore(ctx, (tx) =>
    tx
      .select()
      .from(posShifts)
      .where(eq(posShifts.orgId, ctx.tenantId))
      .orderBy(sql`${posShifts.openedAt} desc`)
      .limit(opts.limit ?? 100),
  );
}

export async function shiftSummary(ctx: CoreCtx, shiftId: string): Promise<ShiftSummary> {
  return withOrgCore(ctx, async (tx) => {
    const byMethod = await paymentsByMethod(tx, ctx.tenantId, shiftId);
    const tickets = await tx
      .select({ status: posTickets.status, total: posTickets.total })
      .from(posTickets)
      .where(and(eq(posTickets.orgId, ctx.tenantId), eq(posTickets.shiftId, shiftId)));

    let gross = 0;
    let voidCount = 0;
    for (const t of tickets) {
      if (t.status === 'void') voidCount++;
      else gross = round2(gross + Number(t.total));
    }
    return { ticketCount: tickets.length, voidCount, gross, byMethod };
  });
}

// ---- tickets ----

export interface TicketLineInput {
  kind: 'service' | 'product';
  finProductId?: string | null;
  bookingId?: string | null;
  description: string;
  qty: number;
  unitPrice: number;
  discount?: number;
}

export interface TicketPaymentInput {
  method: string;
  amount: number;
  tendered?: number | null;
}

export interface SubmitTicketInput {
  lines: TicketLineInput[];
  payments: TicketPaymentInput[];
  partyId?: string | null;
  crmContactId?: string | null;
  customerName?: string | null;
  discount?: number;
  note?: string | null;
  actor: Actor;
}

export interface StockWarning {
  code: string;
  message: string;
  draftEntryId?: string;
}

/**
 * Ticket money math, extracted pure so the arithmetic is unit-testable
 * without a db (same remedy as closeShift's computeExpected): per-line
 * total = round2(qty × unitPrice − line discount), subtotal = round2 Σ,
 * total = round2(subtotal − ticket discount). submitTicket persists
 * exactly these values — this IS the persisted path, not a parallel copy.
 */
export function computeTicketTotals(
  lines: TicketLineInput[],
  discount?: number,
): { lineTotals: number[]; subtotal: number; discount: number; total: number } {
  const lineTotals = lines.map((l) => round2(l.qty * l.unitPrice - (l.discount ?? 0)));
  const subtotal = round2(lineTotals.reduce((a, b) => a + b, 0));
  const ticketDiscount = round2(discount ?? 0);
  return {
    lineTotals,
    subtotal,
    discount: ticketDiscount,
    total: round2(subtotal - ticketDiscount),
  };
}

async function loadTicketRow(ctx: CoreCtx, id: string): Promise<PosTicket | null> {
  const [row] = await withOrgCore(ctx, (tx) =>
    tx
      .select()
      .from(posTickets)
      .where(and(eq(posTickets.id, id), eq(posTickets.orgId, ctx.tenantId)))
      .limit(1),
  );
  return row ?? null;
}

async function stampTicketStock(
  ctx: CoreCtx,
  id: string,
  patch: { stockEntryId: string | null; stockWarning: StockWarning | null },
): Promise<void> {
  await withOrgCore(ctx, (tx) =>
    tx
      .update(posTickets)
      .set({ stockEntryId: patch.stockEntryId, stockWarning: patch.stockWarning })
      .where(and(eq(posTickets.id, id), eq(posTickets.orgId, ctx.tenantId))),
  );
}

/**
 * Line→stock resolution. Lines carrying a bookingId are booking-owned and
 * never issue from here; unmapped lines issue nothing. Aggregated by item so
 * two lines mapping to the same item collapse into one issue line.
 *
 * ★ PRECEDENCE (spec 2026-07-19-pos-stock-split, kept consistent with
 * item-cost.service so cost and issue never disagree) — a sellable may have
 * its own tracked item (the stk_items.fin_product_id bridge), a
 * stk_consumption recipe, or both:
 *
 *   1. A recipe exists → explode it (qty × qtyPerUnit per mapped item) and
 *      ignore the bridge: the ingredients are consumed INSTEAD of the
 *      finished good. A SELF-MAPPING recipe (its only row points at the
 *      product's own item) needs no special case — it falls out of this same
 *      multiplication as a qty multiplier on that item.
 *   2. No recipe → bridge 1:1 (qty × 1).
 *
 * An authored recipe outranks the implicit 1:1 default. `kind` is NOT
 * consulted any more (it stays a display concern): a product-kind sellable
 * may legitimately carry a recipe.
 */
async function resolveIssueLines(
  ctx: CoreCtx,
  lines: PosTicketLine[],
): Promise<CreateIssueFromInvoiceLine[]> {
  // Every issuable line regardless of kind — the bridge AND the recipe are
  // looked up for all of them, and precedence decides per product.
  const finIds = [
    ...new Set(
      lines.filter((l) => !l.bookingId && l.finProductId).map((l) => l.finProductId as string),
    ),
  ];

  const itemByFinProductId = new Map<string, string>();
  const consumptionByFinProductId = new Map<string, { itemId: string; qtyPerUnit: number }[]>();
  if (finIds.length) {
    const [itemRows, consumptionRows] = await Promise.all([
      withOrgCore(ctx, (tx) =>
        tx
          .select({ id: stkItems.id, finProductId: stkItems.finProductId })
          .from(stkItems)
          .where(and(eq(stkItems.orgId, ctx.tenantId), inArray(stkItems.finProductId, finIds))),
      ),
      withOrgCore(ctx, (tx) =>
        tx
          .select({
            finProductId: stkConsumption.finProductId,
            itemId: stkConsumption.itemId,
            qtyPerUnit: stkConsumption.qtyPerUnit,
          })
          .from(stkConsumption)
          .where(
            and(
              eq(stkConsumption.orgId, ctx.tenantId),
              inArray(stkConsumption.finProductId, finIds),
            ),
          ),
      ),
    ]);
    for (const r of itemRows) if (r.finProductId) itemByFinProductId.set(r.finProductId, r.id);
    for (const r of consumptionRows) {
      const list = consumptionByFinProductId.get(r.finProductId) ?? [];
      list.push({ itemId: r.itemId, qtyPerUnit: Number(r.qtyPerUnit) });
      consumptionByFinProductId.set(r.finProductId, list);
    }
  }

  // The component graph, loaded once for every line.
  const { byParent, isStockItem } = await loadComponentGraph(ctx);

  // Resolve AND expand per line, not in two phases: modifiers (#9) are a
  // property of the LINE, so an aggregate-then-expand pass would have already
  // merged away the identity they attach to.
  const stockQtyByItem = new Map<string, number>();
  const consumptionQtyByItem = new Map<string, number>();
  const accumulate = (target: Map<string, number>, additions: Map<string, number>) => {
    for (const [itemId, qty] of additions) target.set(itemId, (target.get(itemId) ?? 0) + qty);
  };
  for (const l of lines) {
    if (l.bookingId || !l.finProductId) continue; // booking-owned or unmapped → issues nothing
    const qty = Number(l.qty);
    const mappings = consumptionByFinProductId.get(l.finProductId);
    const bridgeItemId = itemByFinProductId.get(l.finProductId);
    // Recipe outranks the 1:1 bridge (see PRECEDENCE above).
    const roots: IssueRoot[] = mappings?.length
      ? mappings.map((mp) => ({
          itemId: mp.itemId,
          qty: qty * mp.qtyPerUnit,
          unitKind: 'consumption',
        }))
      : bridgeItemId
        ? [{ itemId: bridgeItemId, qty, unitKind: 'stock' }]
        : [];
    const mods = lineModifiersOf(l);
    const exploded = explodeIssueRoots(roots, qty, byParent, isStockItem, mods);
    accumulate(stockQtyByItem, exploded.stockQtyByItem);
    accumulate(consumptionQtyByItem, exploded.consumptionQtyByItem);
  }
  return [
    ...[...stockQtyByItem].map(([itemId, qty]) => ({ itemId, qty: round4(qty) })),
    ...[...consumptionQtyByItem].map(([itemId, qtyConsumption]) => ({
      itemId,
      // Required compatibility field. The stock service ignores it whenever
      // qtyConsumption is present and converts authoritatively server-side.
      qty: round4(qtyConsumption),
      qtyConsumption: round4(qtyConsumption),
    })),
  ];
}

/** Per-line customer choices, tolerant of legacy rows and hand-written JSON. */
function lineModifiersOf(line: PosTicketLine): LineModifier[] {
  const raw = (line as { modifiers?: unknown }).modifiers;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (mod): mod is LineModifier =>
      !!mod &&
      typeof mod === 'object' &&
      ((mod as LineModifier).action === 'exclude' || (mod as LineModifier).action === 'add') &&
      typeof (mod as LineModifier).itemId === 'string',
  );
}

/**
 * The org's component graph + stock flags, loaded once per issue. When nothing
 * is composed this returns an empty graph, which makes every expansion the
 * identity — so the common case costs one cheap query and behaves exactly as
 * it did before Slice 1b.
 */
export async function loadComponentGraph(
  ctx: CoreCtx,
): Promise<{ byParent: Map<string, ComponentEdge[]>; isStockItem: (id: string) => boolean }> {
  const edges = await listAllComponentEdges(ctx);
  if (edges.length === 0) return { byParent: new Map(), isStockItem: () => true };

  // Only leaves that actually hold stock may be issued.
  const involved = new Set<string>(edges.flatMap((e) => [e.parentItemId, e.childItemId]));
  const flags = await withOrgCore(ctx, (tx) =>
    tx
      .select({ id: stkItems.id, isStockItem: stkItems.isStockItem })
      .from(stkItems)
      .where(and(eq(stkItems.orgId, ctx.tenantId), inArray(stkItems.id, [...involved]))),
  );
  const stockFlag = new Map(flags.map((r) => [r.id, r.isStockItem]));
  // Unknown ids are roots resolved from the catalog, not graph nodes — they are
  // real stock items by construction, so default true.
  return { byParent: edgesByParent(edges), isStockItem: (id) => stockFlag.get(id) ?? true };
}

/**
 * Idempotent post-commit stock engine — both the retry endpoint and the
 * post-commit fail-soft hook in submitTicket call this. Models the same
 * state machine as realizeAccruals in stock-accruals.service.ts: an entry
 * already stamped on the ticket is a no-op; a source-stamped entry left by a
 * prior attempt is found (submitted → stamp, draft → retry-submit) before
 * anything new is created; only a truly fresh ticket resolves lines and
 * creates one.
 */
export async function postTicketStock(
  ctx: CoreCtx,
  ticketId: string,
  actor: Actor,
): Promise<{ entryId: string | null; stockWarning: StockWarning | null }> {
  const ticket = await loadTicketRow(ctx, ticketId);
  if (!ticket) throw new PosError('ticket not found', 'not_found');
  if (ticket.status === 'void') throw new PosError('ticket is void', 'already_void');

  if (ticket.stockEntryId) {
    if (ticket.stockWarning)
      await stampTicketStock(ctx, ticketId, {
        stockEntryId: ticket.stockEntryId,
        stockWarning: null,
      });
    return { entryId: ticket.stockEntryId, stockWarning: null };
  }

  const existing = await findEntryBySource(ctx, 'pos', ticketId);
  if (existing?.status === 'submitted') {
    await stampTicketStock(ctx, ticketId, { stockEntryId: existing.id, stockWarning: null });
    return { entryId: existing.id, stockWarning: null };
  }
  if (existing?.status === 'draft') {
    try {
      const submitted = await submitEntry(ctx, existing.id, actor);
      await stampTicketStock(ctx, ticketId, { stockEntryId: submitted.id, stockWarning: null });
      return { entryId: submitted.id, stockWarning: null };
    } catch (e) {
      if (!(e instanceof StockError)) throw e;
      const warning: StockWarning = { code: e.code, message: e.message, draftEntryId: existing.id };
      await stampTicketStock(ctx, ticketId, { stockEntryId: null, stockWarning: warning });
      return { entryId: null, stockWarning: warning };
    }
  }

  const lines = await withOrgCore(ctx, (tx) =>
    tx
      .select()
      .from(posTicketLines)
      .where(and(eq(posTicketLines.orgId, ctx.tenantId), eq(posTicketLines.ticketId, ticketId))),
  );
  const issueLines = await resolveIssueLines(ctx, lines);
  if (!issueLines.length) {
    await stampTicketStock(ctx, ticketId, { stockEntryId: null, stockWarning: null });
    return { entryId: null, stockWarning: null };
  }

  const warehouseId = await resolveDefaultWarehouse(ctx);
  if (!warehouseId) {
    const warning: StockWarning = { code: 'no_warehouse', message: 'no default warehouse' };
    await stampTicketStock(ctx, ticketId, { stockEntryId: null, stockWarning: warning });
    return { entryId: null, stockWarning: warning };
  }

  try {
    const entry = await createSourcedIssue(ctx, {
      source: 'pos',
      sourceId: ticketId,
      warehouseId,
      lines: issueLines,
      partyId: ticket.partyId,
      note: ticket.humanId,
      submit: true,
      actor,
      metadata: { ticketId },
    });
    await stampTicketStock(ctx, ticketId, { stockEntryId: entry.id, stockWarning: null });
    return { entryId: entry.id, stockWarning: null };
  } catch (e) {
    if (!(e instanceof StockError)) throw e;
    // ponytail: no follow-up findEntryBySource lookup to recover a
    // draftEntryId left behind mid-createSourcedIssue — the next
    // postTicketStock retry finds it itself via findEntryBySource above.
    const warning: StockWarning = { code: e.code, message: e.message };
    await stampTicketStock(ctx, ticketId, { stockEntryId: null, stockWarning: warning });
    return { entryId: null, stockWarning: warning };
  }
}

/**
 * Submit a ticket: money commits first (one tx — ticket + lines + payments +
 * humanId + event), stock is post-commit and fail-soft (mirrors the accrual
 * hook in scheduling-bookings.service.ts:299) — a stock hiccup degrades to a
 * stockWarning on the returned ticket, it never fails the sale.
 */
export async function submitTicket(
  ctx: CoreCtx,
  input: SubmitTicketInput,
): Promise<{ ticket: PosTicket; stockWarning: StockWarning | null }> {
  const settings = await getPosSettings(ctx);

  // ---- pure validation (throw PosError before any write) ----
  if (!input.lines.length) throw new PosError('ticket needs lines', 'no_lines');
  for (const l of input.lines) {
    if (!(l.qty > 0)) throw new PosError('invalid qty', 'invalid_qty');
    if (!(l.unitPrice > 0)) throw new PosError('line needs a price', 'zero_price');
  }
  for (const p of input.payments) {
    if (p.amount < 0) throw new PosError('payment amount must be >= 0', 'invalid_amount');
    if (!settings.methods.includes(p.method))
      throw new PosError(`unknown method ${p.method}`, 'invalid_method');
    if (p.method !== 'cash' && p.tendered != null)
      throw new PosError('tendered is cash-only', 'invalid_tender');
    if (p.method === 'cash' && p.tendered != null && p.tendered < p.amount)
      throw new PosError('tendered below amount', 'invalid_tender');
  }
  const { lineTotals, subtotal, discount, total } = computeTicketTotals(
    input.lines,
    input.discount,
  );
  const paid = round2(input.payments.reduce((a, p) => a + p.amount, 0));
  if (Math.abs(paid - total) >= 0.01)
    throw new PosError(`paid ${paid} != total ${total}`, 'payment_mismatch');
  if (settings.requireCustomer && !input.partyId && !input.customerName)
    throw new PosError('customer required', 'customer_required');

  // ---- money tx ----
  const ticket = await withOrgCore(ctx, async (tx) => {
    const [open] = await tx
      .select()
      .from(posShifts)
      .where(and(eq(posShifts.orgId, ctx.tenantId), eq(posShifts.status, 'open')))
      .limit(1);
    if (!open) throw new PosError('open a shift first', 'no_open_shift');

    const humanId = await nextSerialId(tx, ctx.tenantId, 'POS-.YYYY.-', new Date());
    const [row] = await tx
      .insert(posTickets)
      .values({
        orgId: ctx.tenantId,
        humanId,
        shiftId: open.id,
        partyId: input.partyId ?? null,
        crmContactId: input.crmContactId ?? null,
        customerName: input.customerName ?? null,
        status: 'submitted',
        subtotal: String(subtotal),
        discount: String(discount),
        total: String(total),
        currency: settings.currency,
        note: input.note ?? null,
        createdBy: input.actor.id,
      })
      .returning();

    await tx.insert(posTicketLines).values(
      input.lines.map((l, i) => ({
        orgId: ctx.tenantId,
        ticketId: row.id,
        kind: l.kind,
        finProductId: l.finProductId ?? null,
        bookingId: l.bookingId ?? null,
        description: l.description,
        qty: String(l.qty),
        unitPrice: String(l.unitPrice),
        discount: String(l.discount ?? 0),
        total: String(lineTotals[i]),
        lineNo: i,
      })),
    );

    if (input.payments.length) {
      await tx.insert(posPayments).values(
        input.payments.map((p) => ({
          orgId: ctx.tenantId,
          ticketId: row.id,
          shiftId: open.id,
          method: p.method,
          amount: String(p.amount),
          tendered: p.tendered == null ? null : String(p.tendered),
        })),
      );
    }

    // ponytail: HubEvent's union lives in $server/events/emit.ts, a shared
    // file out of this task's two-file commit scope — cast rather than add
    // the 'pos.ticket_submitted' variant there.
    await emitHubEvent(tx, {
      type: 'pos.ticket_submitted',
      orgId: ctx.tenantId,
      ticketId: row.id,
      total: String(total),
    } as unknown as Parameters<typeof emitHubEvent>[1]);
    return row;
  });

  // ---- POST-COMMIT stock, fail-soft ----
  let stockWarning: StockWarning | null = null;
  try {
    if (await isModuleEnabled(ctx, 'stock')) {
      const posted = await postTicketStock(ctx, ticket.id, input.actor);
      stockWarning = posted.stockWarning;
    }
  } catch (e) {
    console.error('[pos] post-commit stock failed', ticket.id, e);
    stockWarning = {
      code: 'stock_post_failed',
      message: e instanceof Error ? e.message : String(e),
    };
  }
  return { ticket, stockWarning };
}

/**
 * Void guard order: not_found → already_void → reconciled (invoice already
 * points at this ticket) → shift_closed → cancel the linked stock entry
 * (StockError degrades to a stored void_stock_failed warning but the void
 * PROCEEDS) → mark void.
 */
export async function voidTicket(ctx: CoreCtx, id: string, actor: Actor): Promise<PosTicket> {
  const ticket = await loadTicketRow(ctx, id);
  if (!ticket) throw new PosError('ticket not found', 'not_found');
  if (ticket.status === 'void') throw new PosError('ticket already void', 'already_void');
  if (ticket.invoiceProviderRef)
    throw new PosError('ticket is reconciled to an invoice', 'reconciled');

  const [shift] = await withOrgCore(ctx, (tx) =>
    tx
      .select({ status: posShifts.status })
      .from(posShifts)
      .where(and(eq(posShifts.id, ticket.shiftId), eq(posShifts.orgId, ctx.tenantId)))
      .limit(1),
  );
  if (!shift || shift.status !== 'open') throw new PosError('shift is closed', 'shift_closed');

  let stockWarning: StockWarning | null = null;
  if (ticket.stockEntryId) {
    try {
      await cancelEntry(ctx, ticket.stockEntryId, actor);
    } catch (e) {
      if (!(e instanceof StockError)) throw e;
      stockWarning = { code: 'void_stock_failed', message: e.message };
    }
  }

  const [row] = await withOrgCore(ctx, (tx) =>
    tx
      .update(posTickets)
      .set({
        status: 'void',
        voidedAt: new Date(),
        voidedBy: actor.id,
        ...(stockWarning ? { stockWarning } : {}),
      })
      .where(and(eq(posTickets.id, id), eq(posTickets.orgId, ctx.tenantId)))
      .returning(),
  );
  return row;
}

export function listTickets(
  ctx: CoreCtx,
  opts: { shiftId?: string; from?: Date; to?: Date; limit?: number } = {},
): Promise<PosTicket[]> {
  return withOrgCore(ctx, (tx) => {
    const conds = [eq(posTickets.orgId, ctx.tenantId)];
    if (opts.shiftId) conds.push(eq(posTickets.shiftId, opts.shiftId));
    if (opts.from) conds.push(gte(posTickets.submittedAt, opts.from));
    if (opts.to) conds.push(lte(posTickets.submittedAt, opts.to));
    return tx
      .select()
      .from(posTickets)
      .where(and(...conds))
      .orderBy(desc(posTickets.submittedAt))
      .limit(opts.limit ?? 100);
  });
}

export async function getTicket(
  ctx: CoreCtx,
  id: string,
): Promise<{ ticket: PosTicket; lines: PosTicketLine[]; payments: PosPayment[] } | null> {
  return withOrgCore(ctx, async (tx) => {
    const [ticket] = await tx
      .select()
      .from(posTickets)
      .where(and(eq(posTickets.id, id), eq(posTickets.orgId, ctx.tenantId)))
      .limit(1);
    if (!ticket) return null;
    const lines = await tx
      .select()
      .from(posTicketLines)
      .where(eq(posTicketLines.ticketId, id))
      .orderBy(asc(posTicketLines.lineNo));
    const payments = await tx
      .select()
      .from(posPayments)
      .where(eq(posPayments.ticketId, id))
      .orderBy(asc(posPayments.paidAt));
    return { ticket, lines, payments };
  });
}

// ---- sellables ----

/** Auto-code from a product name when the wizard leaves code blank: uppercase,
 *  non-alphanumeric runs collapsed to a single '-', no leading/trailing dash
 *  (`BOTOX 50U` → `BOTOX-50U`). Pure so the slugification is unit-testable
 *  without a db — same remedy as computeExpected/computeTicketTotals above. */
export function slugifyCode(name: string): string {
  return name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export interface SellableRow {
  productId: string;
  code: string;
  name: string;
  category: string | null;
  unitPrice: number | null;
  active: boolean;
  kind: 'product' | 'service';
  itemId: string | null;
  stockQty: number | null;
  hasMapping: boolean;
}

type SellableSqlRow = {
  id: string;
  code: string;
  name: string;
  category: string | null;
  unit_price: string | null;
  active: boolean;
  item_id: string | null;
  stock_qty: string | number | null;
  has_mapping: boolean;
};

/** `kind` is DERIVED, never stored: a product row is 'product' iff a stk_items
 *  row links to it via finProductId, else 'service'. An item that exists but
 *  has no bins yet still yields stockQty 0 (the query's coalesce + this `?? 0`
 *  belt-and-suspenders) — null means "not stock-tracked", never a crash. */
function mapSellableRow(r: SellableSqlRow): SellableRow {
  return {
    productId: String(r.id),
    code: String(r.code),
    name: String(r.name),
    category: r.category != null ? String(r.category) : null,
    unitPrice: r.unit_price != null ? Number(r.unit_price) : null,
    active: r.active === true,
    kind: r.item_id != null ? 'product' : 'service',
    itemId: r.item_id != null ? String(r.item_id) : null,
    stockQty: r.item_id != null ? Number(r.stock_qty ?? 0) : null,
    hasMapping: r.has_mapping === true,
  };
}

const SELLABLE_MERGE_SQL = sql`
      select p.id, p.code, p.name, p.category, p.unit_price, p.active,
             i.id as item_id,
             coalesce(sum(b.qty), 0)::float8 as stock_qty,
             exists(select 1 from stk_consumption c where c.fin_product_id = p.id) as has_mapping
      from fin_products p
      left join stk_items i on i.fin_product_id = p.id and i.org_id = p.org_id
      left join stk_bins b on b.item_id = i.id and b.org_id = p.org_id`;

/**
 * Merged catalog, point of entry for POS item pickers: active fin_products
 * left-joined to their linked stk_items (1:1 via stk_items.fin_product_id),
 * Σ stk_bins.qty for the item, and an exists-flag on stk_consumption — ONE
 * query, no N+1 per row.
 */
export async function listSellables(ctx: CoreCtx): Promise<SellableRow[]> {
  return withOrgCore(ctx, async (tx) => {
    const rows = (await tx.execute(sql`${SELLABLE_MERGE_SQL}
      where p.org_id = ${ctx.tenantId} and p.active = true
      group by p.id, i.id
      order by p.name`)) as unknown as SellableSqlRow[];
    return rows.map(mapSellableRow);
  });
}

/** Same merge as listSellables for a single product, active-or-not — create
 *  and update both need the fresh row back regardless of active state. */
async function getSellableRow(ctx: CoreCtx, productId: string): Promise<SellableRow> {
  const rows = (await withOrgCore(ctx, (tx) =>
    tx.execute(sql`${SELLABLE_MERGE_SQL}
      where p.org_id = ${ctx.tenantId} and p.id = ${productId}
      group by p.id, i.id`),
  )) as unknown as SellableSqlRow[];
  if (!rows[0]) throw new PosError('sellable not found', 'not_found');
  return mapSellableRow(rows[0]);
}

/** Translate a raw pg unique-violation into the domain error — same
 *  convention as enqueueJob in finance-sync-jobs.service.ts. */
function isUniqueViolation(e: unknown): boolean {
  return !!e && typeof e === 'object' && 'code' in e && (e as { code?: string }).code === '23505';
}

export interface SellableInput {
  name: string;
  code?: string;
  category?: string | null;
  unitPrice: number | null;
  kind: 'product' | 'service';
  trackStock?: boolean;
  uom?: string;
  /**
   * Publish an EXISTING stk_item as this sellable (the raw-material case: a
   * mask, a vial — "the POS section can publish raw ingredients"). Links that
   * item's finProductId instead of creating a new one, which also makes the
   * sellable product-kind for free (`kind` is derived from the link).
   * Mutually exclusive with `trackStock`; when both are sent, this wins.
   */
  itemId?: string;
  consumption?: Array<{ itemId: string; qtyPerUnit: number }>;
  active?: boolean;
}

/**
 * Cross-module create wizard: product (upsertProduct — idempotent on code, so
 * a retried call after a partial failure is safe), then — for a product-kind
 * sellable with trackStock — a linked stk_items row (finProductId passed
 * straight through NewItemInput, no separate updateItem link-up needed), then
 * consumption mapping rows. SEQUENTIAL ctx-level calls, NOT one giant tx:
 * withOrgCore doesn't nest (same reason as the accrual hook in
 * stock-accruals.service.ts) — a failed item/consumption write after the
 * product commits is acceptable, re-running with the same input heals it.
 */
export async function createSellable(
  ctx: CoreCtx,
  input: SellableInput,
  actor: Actor,
): Promise<SellableRow> {
  const code = input.code?.trim() || slugifyCode(input.name);
  if (!code) throw new PosError('name or code required', 'invalid_code');
  const active = input.active ?? true;

  try {
    await upsertProduct(ctx, {
      code,
      name: input.name,
      category: input.category ?? null,
      unitPrice: input.unitPrice,
      active,
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new PosError(`code ${code} is already taken`, 'code_taken');
    throw e;
  }

  const [product] = await withOrgCore(ctx, (tx) =>
    tx
      .select({ id: finProducts.id })
      .from(finProducts)
      .where(and(eq(finProducts.orgId, ctx.tenantId), eq(finProducts.code, code)))
      .limit(1),
  );
  if (!product) throw new PosError('product write did not persist', 'write_failed');

  if (input.itemId) {
    // Publish an existing raw material. The partial unique index
    // (stk_items_org_fin_product_uniq) is the real guard against two items
    // claiming one product; catching it here just turns 23505 into a usable
    // error instead of a 500.
    try {
      const linked = await updateItem(ctx, input.itemId, { finProductId: product.id });
      if (!linked) throw new PosError('stock item not found', 'item_not_found');
    } catch (e) {
      if (isUniqueViolation(e))
        throw new PosError('that item is already published as a sellable', 'item_taken');
      throw e;
    }
  } else if (input.kind === 'product' && input.trackStock) {
    await createItem(ctx, {
      code,
      name: input.name,
      uom: input.uom ?? 'unit',
      finProductId: product.id,
    });
  }

  if (input.consumption?.length) {
    for (const c of input.consumption) {
      await setConsumption(
        ctx,
        { finProductId: product.id, itemId: c.itemId, qtyPerUnit: c.qtyPerUnit },
        actor,
      );
    }
  }

  return getSellableRow(ctx, product.id);
}

/**
 * Patch product fields via upsertProduct (unset patch fields fall back to the
 * current row). `consumption` PRESENT (even `[]`) is a replace-set FOR THIS
 * PRODUCT ONLY: listConsumption is filtered by finProductId, so a mapping
 * belonging to another product is never read or deleted — rows missing from
 * the new array are removed via deleteConsumption, the rest upserted via
 * setConsumption. `consumption` omitted leaves existing mappings untouched.
 */
export async function updateSellable(
  ctx: CoreCtx,
  productId: string,
  patch: Partial<SellableInput>,
  actor: Actor,
): Promise<SellableRow> {
  const [current] = await withOrgCore(ctx, (tx) =>
    tx
      .select()
      .from(finProducts)
      .where(and(eq(finProducts.id, productId), eq(finProducts.orgId, ctx.tenantId)))
      .limit(1),
  );
  if (!current) throw new PosError('sellable not found', 'not_found');

  const code = patch.code?.trim() || current.code;
  const name = patch.name ?? current.name;
  const category = patch.category !== undefined ? patch.category : current.category;
  const unitPrice =
    patch.unitPrice !== undefined
      ? patch.unitPrice
      : current.unitPrice == null
        ? null
        : Number(current.unitPrice);
  const active = patch.active !== undefined ? patch.active : current.active;

  try {
    await upsertProduct(ctx, { code, name, category, unitPrice, active });
  } catch (e) {
    if (isUniqueViolation(e)) throw new PosError(`code ${code} is already taken`, 'code_taken');
    throw e;
  }

  if (patch.consumption !== undefined) {
    const existing = await listConsumption(ctx, { finProductId: productId });
    const keep = new Set(patch.consumption.map((c) => c.itemId));
    for (const row of existing) {
      if (!keep.has(row.itemId)) await deleteConsumption(ctx, row.id);
    }
    for (const c of patch.consumption) {
      await setConsumption(
        ctx,
        { finProductId: productId, itemId: c.itemId, qtyPerUnit: c.qtyPerUnit },
        actor,
      );
    }
  }

  return getSellableRow(ctx, productId);
}

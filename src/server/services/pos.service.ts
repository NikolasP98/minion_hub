import { and, asc, desc, eq, gte, inArray, lte, ne, sql } from 'drizzle-orm';
import { withOrgCore, type CoreTx } from '$server/db/with-org-core';
import type { CoreCtx } from '$server/auth/core-ctx';
import {
  posSettings,
  posShifts,
  posTickets,
  posTicketLines,
  posPayments,
  posEmissions,
  type PosShift,
  type PosTicket,
  type PosTicketLine,
  type PosPayment,
  type PosEmission,
} from '$server/db/pg-pos-schema';
import type { EmissionDocType } from '$server/finance/emission';
import { nextSerialId } from './naming-series';
import { isModuleEnabled } from './modules.service';
import { resolveDefaultWarehouse } from './stock-accruals.service';
import {
  createSourcedIssue,
  findEntryBySource,
  submitEntry,
  cancelEntry,
  StockError,
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
import { bustFinanceCache } from './finance.service';
import { emitHubEvent } from '$server/events/emit';
// Deliberate circular import: pos-emission.service.ts imports PosError/
// PosSettings (types + a class, never touched at module-eval time) back from
// here. Safe under ESM — neither module reads the other's export until a
// function actually runs, well after both have finished initializing.
import {
  triggerShadowEmission,
  seedShadowSeries,
  listEmissionsForTicket,
} from './pos-emission.service';
// The ONE code-format rail, shared with the client wizard. Pure module, no
// runtime deps — see the drift note in $lib/catalog/code.ts for why it is not
// duplicated here the way the old slugifyCode/slugify pair was.
import { codeError, normalizeCode, suggestCode } from '$lib/catalog/code';
import {
  classify,
  inferCategory,
  LINE_LABELS,
  ZONE_LABELS,
  type Taxonomy,
} from '$lib/catalog/taxonomy';

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

/**
 * A configurable POS payment method. `id` is the stable key persisted on
 * `pos_payments.method` — renaming `label` never touches historical tickets.
 * `takesTendered` replaces the old `method === 'cash'` special-case (spec
 * 2026-08-14-pos-payment-methods-config-spec).
 */
export interface PaymentMethod {
  id: string;
  label: string;
  enabled: boolean;
  takesTendered: boolean;
  surcharge?: { type: 'percent' | 'fixed'; amount: number };
  documentDefault?: '03' | '01' | null;
}

/**
 * `mode: 'shadow'` fires a real (zero-legal-effect) emission to SUNAT's beta
 * sandbox on every ticket, for pipeline validation ahead of a production
 * cutover. `'prod'` is DELIBERATELY not a member of this union — the value
 * doesn't exist yet (spec 2026-08-14-pos-shadow-emission-spec.md §1); a raw
 * string outside `EmissionSettings` is rejected by `validateEmission`.
 */
export interface EmissionSettings {
  mode: 'off' | 'shadow';
  docTypeDefault: EmissionDocType;
}

export interface PosSettings {
  methods: PaymentMethod[];
  currency: string;
  requireCustomer: boolean;
  allowPriceOverride: boolean;
  emission: EmissionSettings;
}

function capitalize(s: string): string {
  return s.length ? s[0].toUpperCase() + s.slice(1) : s;
}

/**
 * Accepts either shape a `pos_settings.methods` jsonb value may hold: the
 * legacy `string[]` (pre-2026-08-14 rows) or the current `PaymentMethod[]`.
 * A bare string `s` is upgraded to an object, guessing `takesTendered` from
 * the one legacy special-case — `'cash'` may appear as a literal HERE ONLY,
 * a one-time migration guess, never as branching logic elsewhere.
 */
export function normalizeMethods(raw: unknown): PaymentMethod[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((m) =>
    typeof m === 'string'
      ? {
          id: m,
          label: capitalize(m),
          enabled: true,
          takesTendered: m === 'cash',
          documentDefault: null,
        }
      : (m as PaymentMethod),
  );
}

// Frozen (incl. the methods array, and each method object) so a stray
// in-place mutation throws instead of silently corrupting defaults for every
// org in the process.
export const DEFAULT_POS_SETTINGS: PosSettings = Object.freeze({
  methods: Object.freeze(
    [
      { id: 'cash', label: 'Efectivo', enabled: true, takesTendered: true, documentDefault: null },
      { id: 'card', label: 'Tarjeta', enabled: true, takesTendered: false, documentDefault: null },
      { id: 'yape', label: 'Yape', enabled: true, takesTendered: false, documentDefault: null },
      { id: 'plin', label: 'Plin', enabled: true, takesTendered: false, documentDefault: null },
      {
        id: 'transfer',
        label: 'Transferencia',
        enabled: true,
        takesTendered: false,
        documentDefault: null,
      },
    ].map((m) => Object.freeze(m)),
  ) as PaymentMethod[],
  currency: 'PEN',
  requireCustomer: false,
  allowPriceOverride: true,
  emission: Object.freeze({ mode: 'off', docTypeDefault: '03' }) as EmissionSettings,
});

/** Tolerant of a row whose `emission` column predates this slice's migration
 *  default (shouldn't happen post-migration, but a stray legacy row or a hand
 *  edit is cheap to guard against). */
function normalizeEmission(raw: unknown): EmissionSettings {
  const r = raw as Partial<EmissionSettings> | null | undefined;
  return {
    mode: r?.mode === 'shadow' ? 'shadow' : 'off',
    docTypeDefault: r?.docTypeDefault === '01' ? '01' : '03',
  };
}

export async function getPosSettings(ctx: CoreCtx): Promise<PosSettings> {
  const [row] = await withOrgCore(ctx, (tx) =>
    tx.select().from(posSettings).where(eq(posSettings.orgId, ctx.tenantId)).limit(1),
  );
  // Defensive copy — callers get a mutable object, never the shared singleton.
  if (!row)
    return {
      ...DEFAULT_POS_SETTINGS,
      methods: DEFAULT_POS_SETTINGS.methods.map((m) => ({ ...m })),
      emission: { ...DEFAULT_POS_SETTINGS.emission },
    };
  return {
    methods: normalizeMethods(row.methods),
    currency: row.currency,
    requireCustomer: row.requireCustomer,
    allowPriceOverride: row.allowPriceOverride,
    emission: normalizeEmission(row.emission),
  };
}

/** ids unique + non-empty lowercase, at least one enabled, surcharge >= 0. */
function validateMethods(methods: PaymentMethod[]): void {
  if (!Array.isArray(methods) || methods.length === 0) {
    throw new PosError('methods must be a non-empty array', 'invalid_methods');
  }
  const seen = new Set<string>();
  let anyEnabled = false;
  for (const m of methods) {
    const id = (m as Partial<PaymentMethod> | null)?.id;
    if (typeof id !== 'string' || id.length === 0 || id !== id.toLowerCase()) {
      throw new PosError('method id must be a non-empty lowercase string', 'invalid_methods');
    }
    if (seen.has(id)) throw new PosError(`duplicate method id ${id}`, 'duplicate_method_id');
    seen.add(id);
    if (m.enabled) anyEnabled = true;
    if (m.surcharge && !(m.surcharge.amount >= 0)) {
      throw new PosError('surcharge amount must be >= 0', 'invalid_surcharge');
    }
  }
  if (!anyEnabled) throw new PosError('at least one method must be enabled', 'invalid_methods');
}

/** `'prod'` (or anything else) is REJECTED here by construction — it's simply
 *  not one of the two branches, same as an unrecognised docTypeDefault. */
function validateEmission(emission: EmissionSettings): void {
  if (emission.mode !== 'off' && emission.mode !== 'shadow') {
    throw new PosError(`invalid emission mode ${String(emission.mode)}`, 'invalid_emission_mode');
  }
  if (emission.docTypeDefault !== '03' && emission.docTypeDefault !== '01') {
    throw new PosError(
      `invalid emission docTypeDefault ${String(emission.docTypeDefault)}`,
      'invalid_emission_doctype',
    );
  }
}

export async function updatePosSettings(
  ctx: CoreCtx,
  patch: Partial<PosSettings>,
): Promise<PosSettings> {
  const current = await getPosSettings(ctx);
  const next: PosSettings = { ...current, ...patch };
  validateMethods(next.methods);
  validateEmission(next.emission);
  const [row] = await withOrgCore(ctx, async (tx) => {
    const [updated] = await tx
      .insert(posSettings)
      .values({ orgId: ctx.tenantId, ...next })
      .onConflictDoUpdate({ target: posSettings.orgId, set: { ...next, updatedAt: new Date() } })
      .returning();
    // Enabling shadow mode auto-seeds the beta series if absent (spec §2),
    // idempotently, in the SAME transaction as the settings write.
    if (next.emission.mode === 'shadow') await seedShadowSeries(tx, ctx.tenantId);
    return [updated];
  });
  return {
    methods: normalizeMethods(row.methods),
    currency: row.currency,
    requireCustomer: row.requireCustomer,
    allowPriceOverride: row.allowPriceOverride,
    emission: normalizeEmission(row.emission),
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
 * float folded into whichever method(s) are `takesTendered` (per the brief —
 * the physical drawer starts with a float; electronic methods have no
 * starting balance to reconcile; cash stays the float method in practice).
 * Pure, so the math is unit-testable without a db.
 */
export function computeExpected(
  byMethod: Record<string, number>,
  openingFloat: Record<string, number>,
  methods: PaymentMethod[],
): Record<string, number> {
  const expected = { ...byMethod };
  for (const m of methods) {
    if (!m.takesTendered) continue;
    expected[m.id] = round2((expected[m.id] ?? 0) + Number(openingFloat[m.id] ?? 0));
  }
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
  // withOrgCore doesn't nest (same reason as the accrual hook in
  // stock-accruals.service.ts) — fetch settings outside the tx block.
  const settings = await getPosSettings(ctx);
  return withOrgCore(ctx, async (tx) => {
    const [open] = await tx
      .select()
      .from(posShifts)
      .where(and(eq(posShifts.orgId, ctx.tenantId), eq(posShifts.status, 'open')))
      .limit(1);
    if (!open) throw new PosError('no open shift for this org', 'no_open_shift');

    const byMethod = await paymentsByMethod(tx, ctx.tenantId, open.id);
    const expected = computeExpected(
      byMethod,
      (open.openingFloat as Record<string, number>) ?? {},
      settings.methods,
    );

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
    const method = settings.methods.find((m) => m.id === p.method);
    if (!method) throw new PosError(`unknown method ${p.method}`, 'invalid_method');
    if (!method.takesTendered && p.tendered != null)
      throw new PosError('tendered is cash-only', 'invalid_tender');
    if (method.takesTendered && p.tendered != null && p.tendered < p.amount)
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

  // ---- POST-COMMIT shadow emission, fail-soft (spec 2026-08-14-pos-shadow-
  // emission-spec.md §4) — invisible to the cashier, never blocks checkout.
  if (settings.emission.mode === 'shadow') {
    await triggerShadowEmission(ctx, ticket, settings);
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
): Promise<{
  ticket: PosTicket;
  lines: PosTicketLine[];
  payments: PosPayment[];
  emissions: PosEmission[];
} | null> {
  const found = await withOrgCore(ctx, async (tx) => {
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
  if (!found) return null;
  // Rows stuck 'pending' here are the shadow-emission loss measure (spec §4
  // step 3 — a frozen/crashed runtime never got to update the row).
  const emissions = await listEmissionsForTicket(ctx, id);
  return { ...found, emissions };
}

// ---- sellables ----

/**
 * Auto-code from a product name when the wizard leaves code blank.
 *
 * Delegates to the shared rail: initials of the words, capped at 4 chars,
 * uppercase alphanumerics only (`Malar Saypha Volume Plus` → `MSVP`). The old
 * implementation produced hyphenated, unbounded codes (`BOTOX 50U` →
 * `BOTOX-50U`), which is what let 6-character hyphenated near-twins like
 * `CM-SVP` and `RS-SVP` into the catalog beside `CMSVP` and `RSSVP`.
 *
 * Kept as a named export (not inlined) because the API layer and tests both
 * reference it as POS's entry point to code generation.
 */
export function slugifyCode(name: string): string {
  return suggestCode(name.trim());
}

export interface SellableRow {
  productId: string;
  code: string;
  name: string;
  /** Free-text `fin_products.category`. NOT the taxonomy — see `taxonomy.kind`. */
  category: string | null;
  unitPrice: number | null;
  active: boolean;
  /**
   * DERIVED, never stored, and checked in this precedence:
   *   bundle  — has fin_product_components rows (it delivers other sellables)
   *   product — a stk_items row links to it (it has physical stock)
   *   service — neither
   * Bundle wins because a bundle that ALSO carried its own stock item would be
   * two contradictory fulfilment models on one row; see the invariant note on
   * `isBundle` below.
   */
  kind: 'product' | 'service' | 'bundle';
  itemId: string | null;
  stockQty: number | null;
  hasMapping: boolean;
  /**
   * The two grouping axes, DERIVED on every read rather than stored.
   *
   * Deliberate: an inferred classification written into the table becomes
   * indistinguishable from a confirmed one, and 47 of 81 products have no stock
   * mapping to confirm against. Deriving keeps `$lib/catalog/taxonomy.ts` the
   * single source of truth, makes improving the rules a code change instead of a
   * data migration, and means nothing false is ever persisted. `metadata.zone` /
   * `metadata.line` are read as MANUAL OVERRIDES only, and win when present.
   */
  taxonomy: Taxonomy;
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
  is_bundle: boolean;
  metadata: unknown;
  consumed_item_names: string[] | null;
};

/** `kind` is DERIVED, never stored: a product row is 'product' iff a stk_items
 *  row links to it via finProductId, else 'service'. An item that exists but
 *  has no bins yet still yields stockQty 0 (the query's coalesce + this `?? 0`
 *  belt-and-suspenders) — null means "not stock-tracked", never a crash. */
/**
 * Manual overrides only. A stored value is trusted (a human set it); anything
 * absent or unrecognised falls back to the derived value, so a typo in metadata
 * can never mint a phantom group the way a free-text column would.
 */
function applyTaxonomyOverrides(
  derived: Taxonomy,
  metadata: unknown,
  storedCategory?: string | null,
): Taxonomy {
  // A non-null `fin_products.category` is a human classification (the 2026-07-25
  // cleanup set Retail/Prenda explicitly). It outranks whatever the name-based
  // rules would infer, so the board groups those rows where a person put them.
  const withCategory = (t: Taxonomy): Taxonomy =>
    storedCategory ? { ...t, category: storedCategory as Taxonomy['category'] } : t;
  if (!metadata || typeof metadata !== 'object') return withCategory(derived);
  const md = metadata as { zone?: unknown; line?: unknown };
  const out = { ...derived };
  if (typeof md.zone === 'string' && md.zone in ZONE_LABELS) {
    out.zone = md.zone as Taxonomy['zone'];
    out.zoneSource = 'manual';
  }
  if (typeof md.line === 'string' && md.line in LINE_LABELS) {
    out.line = md.line as Taxonomy['line'];
    out.lineSource = 'manual';
    // The coarse kind follows the line, so an overridden line must re-derive it.
    out.category = inferCategory(out.line);
  }
  return withCategory(out);
}

function mapSellableRow(r: SellableSqlRow): SellableRow {
  const name = String(r.name);
  const code = String(r.code);
  const consumed = Array.isArray(r.consumed_item_names) ? r.consumed_item_names : [];
  const isBundle = r.is_bundle === true;
  return {
    productId: String(r.id),
    code,
    name,
    category: r.category != null ? String(r.category) : null,
    unitPrice: r.unit_price != null ? Number(r.unit_price) : null,
    active: r.active === true,
    kind: isBundle ? 'bundle' : r.item_id != null ? 'product' : 'service',
    itemId: r.item_id != null ? String(r.item_id) : null,
    stockQty: r.item_id != null ? Number(r.stock_qty ?? 0) : null,
    hasMapping: r.has_mapping === true,
    taxonomy: applyTaxonomyOverrides(
      classify(name, code, consumed, isBundle),
      r.metadata,
      r.category != null ? String(r.category) : null,
    ),
  };
}

const SELLABLE_MERGE_SQL = sql`
      select p.id, p.code, p.name, p.category, p.unit_price, p.active, p.metadata,
             i.id as item_id,
             coalesce(sum(b.qty), 0)::float8 as stock_qty,
             exists(select 1 from stk_consumption c where c.fin_product_id = p.id) as has_mapping,
             exists(
               select 1 from fin_product_components bc
               where bc.bundle_product_id = p.id and bc.org_id = p.org_id
             ) as is_bundle,
             -- Every insumo this product consumes, for taxonomy derivation. A
             -- correlated aggregate, NOT another join: joining stk_consumption
             -- here would multiply the stk_bins rows and inflate stock_qty.
             coalesce((
               select array_agg(ci.name order by ci.name)
               from stk_consumption cc
               join stk_items ci on ci.id = cc.item_id and ci.org_id = cc.org_id
               where cc.fin_product_id = p.id and cc.org_id = p.org_id
             ), '{}')::text[] as consumed_item_names
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

/**
 * Single source of truth for "is this a product, is it stock-tracked, what
 * uom is it in" — reuses getSellableRow's `kind`/`itemId` derivation (see the
 * doc comment on `SellableRow.kind`) rather than redefining it; only the uom
 * lookup is new, since SellableRow doesn't carry it. Used by both the read
 * path (implicitly, via getSellableRow) and updateSellable's write-guard.
 */
export async function deriveSellableFacts(
  ctx: CoreCtx,
  finProductId: string,
): Promise<{
  kind: 'service' | 'product' | 'bundle';
  trackStock: boolean;
  uom: string | null;
  itemId: string | null;
}> {
  const row = await getSellableRow(ctx, finProductId);
  const itemId = row.itemId;
  let uom: string | null = null;
  if (itemId) {
    const uomRows = (await withOrgCore(ctx, (tx) =>
      tx.execute(sql`select uom from stk_items where id = ${itemId} and org_id = ${ctx.tenantId}`),
    )) as unknown as Array<{ uom: string | null }>;
    uom = uomRows[0]?.uom ?? null;
  }
  return {
    // The true derived kind, bundle included. `SellableInput.kind` (what a
    // PATCH can submit) has no 'bundle' variant, so a bundle can never equal
    // patch.kind below — every kind patch on a bundle refuses with
    // 'kind_derived' instead of a same-as-service patch (e.g. kind: 'service')
    // comparing equal-by-coincidence and silently passing through as a no-op.
    kind: row.kind,
    trackStock: itemId != null,
    uom,
    itemId,
  };
}

/** trim + case-fold for uom comparison; null/undefined both normalize to ''
 *  so "not tracked" only ever compares equal to another "not tracked". */
function normalizeUomForCompare(v: string | null | undefined): string {
  return (v ?? '').trim().toLowerCase();
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
 * The ONE place that creates or links the stk_items row backing a sellable —
 * extracted from createSellable's original inline item-sync so updateSellable's
 * trackStock false→true transition (S2 of
 * 2026-08-17-hub-updatesellable-silent-drop-spec) observes identical
 * defaulting/validation instead of drifting from create's behavior. Takes the
 * caller's already-open `tx` (not ctx) so a failed item write rolls back
 * together with whatever fin_products change the caller makes in the same
 * transaction — createSellable and updateSellable each wrap their own call in
 * their own withOrgCore.
 */
async function syncSellableItem(
  tx: CoreTx,
  ctx: CoreCtx,
  finProductId: string,
  desired: {
    trackStock: boolean;
    uom?: string | null;
    itemId?: string;
    code: string;
    name: string;
  },
): Promise<{ itemId: string | null }> {
  if (desired.itemId) {
    // Publish an existing raw material. The partial unique index
    // (stk_items_org_fin_product_uniq) is the real guard against two items
    // claiming one product; catching it here just turns 23505 into a usable
    // error instead of a 500.
    const [cur] = await tx
      .select({ id: stkItems.id })
      .from(stkItems)
      .where(and(eq(stkItems.id, desired.itemId), eq(stkItems.orgId, ctx.tenantId)));
    if (!cur) throw new PosError('stock item not found', 'item_not_found');
    try {
      const [row] = await tx
        .update(stkItems)
        .set({ finProductId, updatedAt: new Date() })
        .where(and(eq(stkItems.id, desired.itemId), eq(stkItems.orgId, ctx.tenantId)))
        .returning({ id: stkItems.id });
      return { itemId: row?.id ?? null };
    } catch (e) {
      if (isUniqueViolation(e))
        throw new PosError('that item is already published as a sellable', 'item_taken');
      throw e;
    }
  }

  if (!desired.trackStock) return { itemId: null };

  try {
    const [row] = await tx
      .insert(stkItems)
      .values({
        orgId: ctx.tenantId,
        code: desired.code,
        name: desired.name,
        uom: desired.uom ?? 'unit',
        finProductId,
      })
      .returning({ id: stkItems.id });
    return { itemId: row?.id ?? null };
  } catch (e) {
    // Two concurrent false→true PATCHes both pass the "not yet tracked"
    // guard and race to insert; the partial unique index lets only one
    // through — the loser gets a typed conflict, never a partial write.
    if (isUniqueViolation(e))
      throw new PosError(
        'stock tracking was just applied to this sellable by another request',
        'stock_tracking_conflict',
      );
    throw e;
  }
}

/**
 * Cross-module create wizard: product (upsertProduct — idempotent on code, so
 * a retried call after a partial failure is safe), then — for a product-kind
 * sellable with trackStock, or one publishing an existing item — a linked
 * stk_items row via syncSellableItem, then consumption mapping rows.
 * SEQUENTIAL ctx-level calls, NOT one giant tx: withOrgCore doesn't nest
 * (same reason as the accrual hook in stock-accruals.service.ts) — a failed
 * item/consumption write after the product commits is acceptable, re-running
 * with the same input heals it.
 */
export async function createSellable(
  ctx: CoreCtx,
  input: SellableInput,
  actor: Actor,
): Promise<SellableRow> {
  const code = input.code ? normalizeCode(input.code) : slugifyCode(input.name);
  // Validate at the trust boundary, not just in the wizard: this is also the
  // path the gateway's pos tools and any direct API caller take, and `code`
  // becomes a permanent business key the invoice sync resolves against.
  const err = codeError(code);
  if (err) {
    throw new PosError(
      err === 'empty' ? 'name or code required' : `code ${code} is not a valid catalog code`,
      'invalid_code',
    );
  }
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

  if (input.itemId || (input.kind === 'product' && input.trackStock)) {
    // itemId wins when both are sent — syncSellableItem checks it first.
    await withOrgCore(ctx, (tx) =>
      syncSellableItem(tx, ctx, product.id, {
        trackStock: !!input.trackStock,
        uom: input.uom,
        itemId: input.itemId,
        code,
        name: input.name,
      }),
    );
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

  const code = patch.code ? normalizeCode(patch.code) : current.code;
  const name = patch.name ?? current.name;
  const category = patch.category !== undefined ? patch.category : current.category;
  const unitPrice =
    patch.unitPrice !== undefined
      ? patch.unitPrice
      : current.unitPrice == null
        ? null
        : Number(current.unitPrice);
  const active = patch.active !== undefined ? patch.active : current.active;

  if (codeError(code) !== null) {
    throw new PosError(`code ${code} is not a valid catalog code`, 'invalid_code');
  }

  /*
   * ★ A code change must RENAME this row, never insert a new one.
   *
   * This used to call upsertProduct, which conflicts on (org_id, code). With a
   * CHANGED code there is no conflict, so it INSERTED a second product and left
   * the original untouched — the edit silently forked the catalog. That is
   * exactly how `CM-SVP`, `RS-SVP`, `RS-O4` and `RO-I` appeared on 2026-07-20
   * within four minutes of each other, each a hyphenated twin of a code that
   * already existed, each with zero sales. Updating by id makes a rename a
   * rename, and turns the unique index into the right error instead of a
   * silent duplicate.
   */
  if (code !== current.code) {
    // `code` is the SUSII sync's business key: loadProductMap() maps
    // fin_products.code → id, and upsertInvoicesBatch re-inserts every invoice
    // line resolving product_id through it. Renaming a product that already has
    // billing history detaches that history the next time those invoices sync.
    // Refuse until the alias table exists to carry the old code forward.
    const billedRows = (await withOrgCore(ctx, (tx) =>
      tx.execute(
        sql`select count(*)::int as n from fin_invoice_items
            where org_id = ${ctx.tenantId} and code = ${current.code}`,
      ),
    )) as unknown as Array<{ n: number }> | undefined;
    const billedCount = billedRows?.[0]?.n ?? 0;
    if (billedCount > 0) {
      throw new PosError(
        `code ${current.code} has ${billedCount} billed invoice lines and cannot be renamed`,
        'code_locked',
      );
    }
  }

  // Stop the silent drop: kind/trackStock/uom are all projections of the
  // linked stk_items row, not columns on fin_products, so a naive .set()
  // below would accept these fields and discard them (operator sees a green
  // save, reopens, the old value is back). An unchanged resubmit — the
  // wizard's normal full-object save — stays a 200 no-op; a real change is
  // refused with a typed 400 rather than silently lost. Only derive facts
  // when one of the three is actually submitted, so a plain price/name edit
  // costs nothing extra.
  // Set when this PATCH performs the safe trackStock false→true transition
  // (S2 of 2026-08-17-hub-updatesellable-silent-drop-spec) — applied inside
  // the same transaction as the fin_products write below, via
  // syncSellableItem, rather than refused.
  let trackStockTransition: { uom?: string } | null = null;

  if (patch.kind !== undefined || patch.trackStock !== undefined || patch.uom !== undefined) {
    const facts = await deriveSellableFacts(ctx, productId);

    if (patch.trackStock !== undefined && patch.trackStock !== facts.trackStock) {
      if (patch.trackStock === true) {
        trackStockTransition = { uom: patch.uom };
      } else {
        // true→false (untrack) stays refused — S3 of the sibling spec, out of
        // scope here; unlinking a possibly-historied item needs its own
        // dedicated code and unlink path.
        throw new PosError(
          'stock tracking cannot be changed on an existing sellable yet',
          'stock_tracking_immutable',
        );
      }
    }

    // `kind` is derived by design and is never a directly settable field in
    // any slice of this fix — refusing a direct write is the permanent,
    // correct behavior, not deferred work. Checked against the state that
    // will exist AFTER a supported trackStock transition, not just the
    // pre-update derived state, so a coupled `{kind:'product',trackStock:true}`
    // PATCH (the wizard's full-object shape) is accepted.
    const effectiveKind = trackStockTransition ? 'product' : facts.kind;
    if (patch.kind !== undefined && patch.kind !== effectiveKind) {
      throw new PosError(
        'kind follows the linked stock item; publish or unlink an item to change it',
        'kind_derived',
      );
    }

    // The trackStock transition's uom is the create-parity value for the
    // NEW link (handled by syncSellableItem below), not a change against the
    // previous — nonexistent — tracked uom, so this guard only applies when
    // no transition is in play.
    if (
      !trackStockTransition &&
      patch.uom !== undefined &&
      normalizeUomForCompare(patch.uom) !== normalizeUomForCompare(facts.uom)
    ) {
      // TODO(handoff): apply a uom change when the linked item is pristine
      // (no ledger history) instead of refusing unconditionally — S2/S3 of
      // 2026-08-17-hub-updatesellable-silent-drop-spec. Refusing is safe
      // (never silently dropped) but not yet the preferred branch.
      throw new PosError(
        'unit of measure cannot be changed on an existing sellable yet',
        'uom_immutable',
      );
    }
  }

  try {
    await withOrgCore(ctx, async (tx) => {
      await tx
        .update(finProducts)
        .set({
          code,
          name,
          category,
          unitPrice: unitPrice == null ? null : String(unitPrice),
          active,
          updatedAt: new Date(),
        })
        .where(and(eq(finProducts.id, productId), eq(finProducts.orgId, ctx.tenantId)));
      // Same transaction as the fin_products write above: a failed item
      // insert rolls back the update instead of leaving a product that
      // claims trackStock with no linked stk_items row.
      if (trackStockTransition) {
        await syncSellableItem(tx, ctx, productId, {
          trackStock: true,
          uom: trackStockTransition.uom,
          code,
          name,
        });
      }
    });
    await bustFinanceCache(ctx);
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

// ---- bundles (fin_product_components) ----

export interface BundleEdge {
  id: string;
  bundleProductId: string;
  childProductId: string;
  childName: string;
  childCode: string;
  childUnitPrice: number | null;
  qty: number;
  lineNo: number;
}

/**
 * Every bundle edge in the org, joined to the child's display fields.
 *
 * Org-wide in ONE query (same shape as listAllComponentEdges): the catalog page
 * renders children under any number of expanded bundles, and a per-bundle fetch
 * would be an N+1 across the whole table.
 */
export async function listBundleEdges(ctx: CoreCtx): Promise<BundleEdge[]> {
  const rows = (await withOrgCore(ctx, (tx) =>
    tx.execute(sql`
      select bc.id, bc.bundle_product_id, bc.child_product_id, bc.qty, bc.line_no,
             cp.name as child_name, cp.code as child_code, cp.unit_price as child_unit_price
      from fin_product_components bc
      join fin_products cp on cp.id = bc.child_product_id and cp.org_id = bc.org_id
      where bc.org_id = ${ctx.tenantId}
      order by bc.bundle_product_id, bc.line_no, cp.name`),
  )) as unknown as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: String(r.id),
    bundleProductId: String(r.bundle_product_id),
    childProductId: String(r.child_product_id),
    childName: String(r.child_name),
    childCode: String(r.child_code),
    childUnitPrice: r.child_unit_price != null ? Number(r.child_unit_price) : null,
    qty: Number(r.qty),
    lineNo: Number(r.line_no ?? 0),
  }));
}

/**
 * Add or update one bundle → child edge (idempotent on the pair).
 *
 * Cycle guard is ONE level deep on purpose: a bundle may not contain a product
 * that is itself a bundle. Nesting would need a full DAG walk (and a decision
 * about how nested pricing and stock issue compose), and nothing in this
 * catalog needs it — "Dúo MIFILL" contains two leaf services. Rejecting it
 * outright is far safer than allowing a graph the rest of the code cannot yet
 * traverse. Lift this to a real path check when a nested bundle is actually
 * required.
 */
export async function setBundleComponent(
  ctx: CoreCtx,
  input: { bundleProductId: string; childProductId: string; qty: number; lineNo?: number },
): Promise<void> {
  if (input.bundleProductId === input.childProductId) {
    throw new PosError('a bundle cannot contain itself', 'bundle_self_ref');
  }
  if (!(input.qty > 0)) throw new PosError('qty must be greater than 0', 'invalid_qty');

  const guard = (await withOrgCore(ctx, (tx) =>
    tx.execute(sql`
      select
        (select count(*)::int from fin_products p
          where p.org_id = ${ctx.tenantId}
            and p.id in (${input.bundleProductId}, ${input.childProductId})) as found,
        (select count(*)::int from fin_product_components c
          where c.org_id = ${ctx.tenantId}
            and c.bundle_product_id = ${input.childProductId}) as child_is_bundle`),
  )) as unknown as Array<{ found: number; child_is_bundle: number }>;
  // Both ids must belong to THIS org — an id from another tenant would
  // otherwise be linkable, since these are plain uuid columns.
  if ((guard[0]?.found ?? 0) !== 2) throw new PosError('product not found', 'not_found');
  if ((guard[0]?.child_is_bundle ?? 0) > 0) {
    throw new PosError('a bundle cannot contain another bundle', 'bundle_nested');
  }

  await withOrgCore(ctx, (tx) =>
    tx.execute(sql`
      insert into fin_product_components (org_id, bundle_product_id, child_product_id, qty, line_no)
      values (${ctx.tenantId}, ${input.bundleProductId}, ${input.childProductId},
              ${String(input.qty)}, ${input.lineNo ?? 0})
      on conflict (org_id, bundle_product_id, child_product_id)
      do update set qty = excluded.qty, line_no = excluded.line_no, updated_at = now()`),
  );
  await bustFinanceCache(ctx);
}

export async function deleteBundleComponent(ctx: CoreCtx, id: string): Promise<boolean> {
  const rows = (await withOrgCore(ctx, (tx) =>
    tx.execute(sql`
      delete from fin_product_components
      where id = ${id} and org_id = ${ctx.tenantId}
      returning id`),
  )) as unknown as unknown[];
  if (rows.length) await bustFinanceCache(ctx);
  return rows.length > 0;
}

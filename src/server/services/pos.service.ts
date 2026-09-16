import { and, asc, desc, eq, gte, inArray, isNull, lte, ne, notInArray, sql } from 'drizzle-orm';
import { withOrgCore, type CoreTx } from '$server/db/with-org-core';
import type { CoreCtx } from '$server/auth/core-ctx';
import {
  posSettings,
  posShifts,
  posTickets,
  posTicketLines,
  posPayments,
  posEmissions,
  posClientLedger,
  posPackageGrants,
  posPackageRedemptions,
  posPaymentPlans,
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
  createItem,
  updateItem,
  setConsumption,
  deleteConsumption,
  listConsumption,
  listAllComponentEdges,
  type CreateIssueFromInvoiceLine,
} from './stock.service';
import {
  consumptionToStockQty,
  edgesByParent,
  explodeIssueRoots,
  round4,
  type ComponentEdge,
  type ExplodedIssueQuantities,
  type IssueRoot,
  type LineModifier,
} from './stock.logic';
import { stkItems, stkConsumption, stkBins } from '$server/db/pg-schema/stock';
import { schedBookings } from '$server/db/pg-scheduling-schema';
import { finProducts, finProductComponents } from '$server/db/pg-finance-schema';
import { upsertProduct } from './finance-products.service';
import { getParty } from './party.service';
import { bustFinanceCache, getFinSettings } from './finance.service';
// Packages / plans / client credit (spec 2026-09-13-pos-scheduling-packages-
// payment-plans-spec.md §3). These three modules import PosError + getPosSettings
// back from here — the same deliberate cycle pos-emission.service.ts already
// lives in, and safe for the same reason: nothing is touched at module-eval
// time, only inside functions.
import {
  addLedgerEntryInTx,
  clientKeyOf,
  clientMatch,
  settlePlanIfPaid,
  type ClientRef,
} from './pos-accounts.service';
import { createGrantsForTicketLine, reverseRedemptionInTx } from './pos-packages.service';
import {
  expiryFrom,
  grantToday,
  ledgerBalance,
  toAmount,
  type PackageEdge,
} from './pos-accounts.logic';
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

/** How hard an org asks for one thing on a ticket. `'optional'` is a nudge the
 *  UI may surface; only `'required'` blocks a submit. */
export const REQUIREMENT_LEVELS = ['off', 'optional', 'required'] as const;
export type RequirementLevel = (typeof REQUIREMENT_LEVELS)[number];

/**
 * Per-org ticket requirements. An OPEN map rather than one boolean column per
 * rule: FACES needs an identity document on every invoice, other orgs need
 * none, and the next one will need something else again. Absent key = `'off'`.
 */
export interface PosRequirements {
  /** A DNI/RUC on the ticket's customer (party spine `doc_number`). */
  identityDocument: RequirementLevel;
}

export interface PosSettings {
  methods: PaymentMethod[];
  currency: string;
  requireCustomer: boolean;
  allowPriceOverride: boolean;
  emission: EmissionSettings;
  requirements: PosRequirements;
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
  requirements: Object.freeze({ identityDocument: 'off' }) as PosRequirements,
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

/** A row written before the requirements migration (or by hand) holds `{}` —
 *  every unknown or absent level reads as `'off'`, never as a silent block. */
function normalizeRequirements(raw: unknown): PosRequirements {
  const r = raw as Partial<Record<keyof PosRequirements, unknown>> | null | undefined;
  const level = (v: unknown): RequirementLevel =>
    (REQUIREMENT_LEVELS as readonly unknown[]).includes(v) ? (v as RequirementLevel) : 'off';
  return { identityDocument: level(r?.identityDocument) };
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
      requirements: { ...DEFAULT_POS_SETTINGS.requirements },
    };
  return {
    methods: normalizeMethods(row.methods),
    currency: row.currency,
    requireCustomer: row.requireCustomer,
    allowPriceOverride: row.allowPriceOverride,
    emission: normalizeEmission(row.emission),
    requirements: normalizeRequirements(row.requirements),
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

/** Unlike `normalizeRequirements` (used on READ, where a legacy/malformed row
 *  must degrade to 'off' rather than break the page), a WRITE with a bad
 *  shape should be rejected the same way `validateMethods`/`validateEmission`
 *  reject theirs — as a 400 PosError, not silently coerced then persisted,
 *  and never left to reach the DB layer unchecked. */
function validateRequirements(requirements: PosRequirements): void {
  if (!(REQUIREMENT_LEVELS as readonly unknown[]).includes(requirements.identityDocument)) {
    throw new PosError(
      `invalid requirements.identityDocument ${String(requirements.identityDocument)}`,
      'invalid_requirements',
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
  // Validate the RAW patch shape first — normalizeRequirements is a lenient
  // reader-side default-on-garbage helper (a legacy `{}` row must still
  // resolve, not 500); running it before validation would coerce a bad value
  // to 'off' and the check below would never see it.
  validateRequirements(next.requirements);
  next.requirements = normalizeRequirements(next.requirements);
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
    requirements: normalizeRequirements(row.requirements),
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
  /** Instalment line: this line pays down `pos_payment_plans.id` (spec §3.4).
   *  The ticket still balances exactly — a plan is N fully-paid tickets. */
  planId?: string | null;
  /** This line is covered by a package session already drawn at booking time
   *  (`pos_package_redemptions.id`, spec §3.2). Such a line may be priced at 0
   *  — it is the ONE case `zero_price` does not apply. */
  redemptionId?: string | null;
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
  /** Manager/owner override (rbac 'pos'/'manage', enforced by the route):
   *  submit even when a tracked line lacks stock. The short line(s) are
   *  excluded from the stock issue (never partially negative — stock.service
   *  has no negative-issue support, see ALLOW_NEGATIVE_STOCK_V1) and recorded
   *  in the returned stockWarning; every in-stock line still issues. */
  allowNegativeStock?: boolean;
}

export interface StockShortfallLine {
  itemId: string;
  itemName: string;
  itemCode: string;
  requested: number;
  available: number;
}

export interface StockWarning {
  code: string;
  message: string;
  draftEntryId?: string;
  /** Per-line detail when code is 'negative_stock' / 'insufficient_stock'. */
  items?: StockShortfallLine[];
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
interface IssueResolution {
  itemByFinProductId: Map<string, string>;
  consumptionByFinProductId: Map<string, { itemId: string; qtyPerUnit: number }[]>;
  byParent: Map<string, ComponentEdge[]>;
  isStockItem: (id: string) => boolean;
}

/** The bridge, the recipe and the component graph for a set of sellables —
 *  three queries total, shared by ticket issuing and catalog availability. */
async function loadIssueResolution(ctx: CoreCtx, finIds: string[]): Promise<IssueResolution> {
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
  return { itemByFinProductId, consumptionByFinProductId, byParent, isStockItem };
}

/** ONE line → stock-leaf quantities, precedence applied (see resolveIssueLines). */
function explodeLineForIssue(
  finProductId: string,
  qty: number,
  modifiers: LineModifier[],
  res: IssueResolution,
): ExplodedIssueQuantities {
  const mappings = res.consumptionByFinProductId.get(finProductId);
  const bridgeItemId = res.itemByFinProductId.get(finProductId);
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
  return explodeIssueRoots(roots, qty, res.byParent, res.isStockItem, modifiers);
}

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
  const res = await loadIssueResolution(ctx, finIds);

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
    const exploded = explodeLineForIssue(l.finProductId, Number(l.qty), lineModifiersOf(l), res);
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

/**
 * How many units of ONE sellable the current bins cover: the bottleneck
 * ingredient decides — min over stock leaves of floor(on-hand ÷ needed per
 * unit), needs converted to each item's STOCK uom first (a recipe is written
 * in consumption uom, bins are kept in stock uom). Null when nothing is needed.
 */
export function recipeBottleneck(
  needs: { itemId: string; stockQty: number; consumptionQty: number }[],
  binQtyByItem: Map<string, number>,
  unitsPerStockUomByItem: Map<string, number | null>,
): number | null {
  let min: number | null = null;
  for (const n of needs) {
    const needed =
      n.stockQty +
      consumptionToStockQty(
        { unitsPerStockUom: unitsPerStockUomByItem.get(n.itemId) ?? null },
        n.consumptionQty,
      );
    if (!(needed > 0)) continue;
    const covers = Math.floor((binQtyByItem.get(n.itemId) ?? 0) / needed);
    min = min == null ? covers : Math.min(min, covers);
  }
  return min;
}

/**
 * A recipe's stock IS its ingredients' stock (owner rule 2026-09-16): every
 * sellable with a stk_consumption recipe gets `stockQty` replaced by the
 * bottleneck count, Σ bins across warehouses like the plain product badge.
 * Recipe outranks the bridge here exactly as it does when issuing.
 */
async function applyRecipeAvailability(ctx: CoreCtx, rows: SellableRow[]): Promise<void> {
  const recipeRows = rows.filter((r) => r.hasMapping);
  if (!recipeRows.length) return;
  const res = await loadIssueResolution(
    ctx,
    recipeRows.map((r) => r.productId),
  );
  const needsByProduct = new Map<string, ExplodedIssueQuantities>();
  const leafIds = new Set<string>();
  for (const r of recipeRows) {
    const exploded = explodeLineForIssue(r.productId, 1, [], res);
    needsByProduct.set(r.productId, exploded);
    for (const id of exploded.stockQtyByItem.keys()) leafIds.add(id);
    for (const id of exploded.consumptionQtyByItem.keys()) leafIds.add(id);
  }
  if (!leafIds.size) return;
  const ids = [...leafIds];
  const [bins, items] = await Promise.all([
    withOrgCore(ctx, (tx) =>
      tx
        .select({
          itemId: stkBins.itemId,
          qty: sql<number>`coalesce(sum(${stkBins.qty}), 0)::float8`,
        })
        .from(stkBins)
        .where(and(eq(stkBins.orgId, ctx.tenantId), inArray(stkBins.itemId, ids)))
        .groupBy(stkBins.itemId),
    ),
    withOrgCore(ctx, (tx) =>
      tx
        .select({ id: stkItems.id, unitsPerStockUom: stkItems.unitsPerStockUom })
        .from(stkItems)
        .where(and(eq(stkItems.orgId, ctx.tenantId), inArray(stkItems.id, ids))),
    ),
  ]);
  const binQtyByItem = new Map(bins.map((b) => [b.itemId, Number(b.qty)]));
  const unitsByItem = new Map(
    items.map((i) => [i.id, i.unitsPerStockUom == null ? null : Number(i.unitsPerStockUom)]),
  );
  for (const r of recipeRows) {
    const ex = needsByProduct.get(r.productId)!;
    const needs = [...ids].map((itemId) => ({
      itemId,
      stockQty: ex.stockQtyByItem.get(itemId) ?? 0,
      consumptionQty: ex.consumptionQtyByItem.get(itemId) ?? 0,
    }));
    const covers = recipeBottleneck(needs, binQtyByItem, unitsByItem);
    if (covers != null) r.stockQty = covers;
  }
}

/**
 * Preflight for submitTicket (F-something: partial-shortfall integrity).
 * Resolves the same issue lines postTicketStock would create, joins current
 * bin qty at the org's default warehouse, and returns one entry per item
 * whose requested qty exceeds what's available — empty when everything
 * covers. Never throws for infra gaps (no warehouse / stock disabled) — the
 * caller treats those as "can't check, don't block the sale", same as the
 * existing post-commit fail-soft path.
 */
async function checkStockShortfalls(
  ctx: CoreCtx,
  issueLines: CreateIssueFromInvoiceLine[],
  warehouseId: string,
): Promise<StockShortfallLine[]> {
  if (!issueLines.length) return [];
  const itemIds = [...new Set(issueLines.map((l) => l.itemId))];
  const [bins, items] = await Promise.all([
    withOrgCore(ctx, (tx) =>
      tx
        .select({ itemId: stkBins.itemId, qty: stkBins.qty })
        .from(stkBins)
        .where(
          and(
            eq(stkBins.orgId, ctx.tenantId),
            eq(stkBins.warehouseId, warehouseId),
            inArray(stkBins.itemId, itemIds),
          ),
        ),
    ),
    withOrgCore(ctx, (tx) =>
      tx
        .select({
          id: stkItems.id,
          name: stkItems.name,
          code: stkItems.code,
          unitsPerStockUom: stkItems.unitsPerStockUom,
        })
        .from(stkItems)
        .where(and(eq(stkItems.orgId, ctx.tenantId), inArray(stkItems.id, itemIds))),
    ),
  ]);
  const availableByItem = new Map(bins.map((b) => [b.itemId, Number(b.qty)]));
  const itemById = new Map(items.map((i) => [i.id, i]));
  const shortfalls: StockShortfallLine[] = [];
  for (const l of issueLines) {
    const available = availableByItem.get(l.itemId) ?? 0;
    const item = itemById.get(l.itemId);
    // Bins are kept in STOCK uom; a recipe line arrives in CONSUMPTION uom
    // (5 ml of a 500 ml box), so convert before comparing — same conversion
    // createSourcedIssue applies when it posts.
    const requested =
      l.qtyConsumption != null
        ? round4(
            consumptionToStockQty(
              {
                unitsPerStockUom:
                  item?.unitsPerStockUom == null ? null : Number(item.unitsPerStockUom),
              },
              l.qtyConsumption,
            ),
          )
        : l.qty;
    if (requested > available) {
      shortfalls.push({
        itemId: l.itemId,
        itemName: item?.name ?? l.itemId,
        itemCode: item?.code ?? '',
        requested,
        available,
      });
    }
  }
  return shortfalls;
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

  // Never drop the whole entry for one short item (F-partial-stock-
  // shortfall). submitTicket already refused the sale up front on a
  // shortfall it could see — this is a FRESH check, right before the actual
  // issue, so a line that only went short in the race window between that
  // preflight and this post-commit step (another concurrent sale, an
  // allowNegativeStock override, or a retry of this same idempotent call)
  // still gets excluded here rather than aborting createSourcedIssue's
  // single all-or-nothing entry and losing every other line with it.
  // TODO(handoff): this narrows the race window, it does not close it —
  // the ticket (money) and the stock issue are still two transactions, not
  // one. A concurrent sale that wins between this check and
  // createSourcedIssue's own locked-bin check still throws StockError below
  // and is caught the old fail-soft way (whole entry lost for THIS ticket,
  // but the winning ticket's stock is correct). Closing it fully means
  // moving the issue into the same transaction as the ticket insert.
  const shortfalls = await checkStockShortfalls(ctx, issueLines, warehouseId);
  const filteredIssueLines = shortfalls.length
    ? issueLines.filter((l) => !shortfalls.some((s) => s.itemId === l.itemId))
    : issueLines;
  const shortfallWarning: StockWarning | null = shortfalls.length
    ? {
        code: 'negative_stock',
        message: `sold below available stock: ${shortfalls
          .map(
            (s) =>
              `${s.itemName} (${s.itemCode}): requested ${s.requested}, available ${s.available}`,
          )
          .join('; ')}`,
        items: shortfalls,
      }
    : null;

  if (!filteredIssueLines.length) {
    await stampTicketStock(ctx, ticketId, { stockEntryId: null, stockWarning: shortfallWarning });
    return { entryId: null, stockWarning: shortfallWarning };
  }

  try {
    const entry = await createSourcedIssue(ctx, {
      source: 'pos',
      sourceId: ticketId,
      warehouseId,
      lines: filteredIssueLines,
      partyId: ticket.partyId,
      note: ticket.humanId,
      submit: true,
      actor,
      metadata: { ticketId },
    });
    await stampTicketStock(ctx, ticketId, {
      stockEntryId: entry.id,
      stockWarning: shortfallWarning,
    });
    return { entryId: entry.id, stockWarning: shortfallWarning };
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

// ---- packages, plans, client credit (spec §3) ----

/**
 * The payment-method id that draws on `pos_client_ledger` instead of a real
 * tender. Registered per-org as an ordinary `pos_settings.methods` entry with
 * `takesTendered = false` (spec §3.5), so the ID IS the contract — an org must
 * not name a credit-CARD method `credit`.
 */
// TODO(handoff): the id is the ONLY signal. An org that names a credit-CARD
// method `credit` would silently draw down stored value on every card sale.
// Needs a `drawsOnCredit: true` flag on PaymentMethod (and a settings guard)
// rather than a magic id — see meta
// proposals/2026-09-13-pos-packages-plans-s1-followups.md.
export const CREDIT_METHOD_ID = 'credit';

/** `fin_products.metadata.packageValidityDays` — absent/invalid = no expiry. */
export function packageValidityDays(metadata: unknown): number | null {
  const raw = (metadata as Record<string, unknown> | null | undefined)?.packageValidityDays;
  const n = Number(raw);
  return raw == null || !Number.isFinite(n) || n <= 0 ? null : Math.floor(n);
}

interface PackageSpec {
  edges: PackageEdge[];
  validityDays: number | null;
}

/**
 * Which of these sellables are PACKAGES — i.e. carry `fin_product_components`
 * edges — plus their validity window.
 *
 * Read OUTSIDE the money transaction on purpose: catalog composition is
 * slow-moving config, while the grant rows it drives are still written inside
 * the tx, so a sale can never half-commit. Costs nothing for a ticket whose
 * lines carry no product at all.
 */
async function resolvePackageSpecs(
  ctx: CoreCtx,
  productIds: string[],
): Promise<Map<string, PackageSpec>> {
  if (!productIds.length) return new Map();
  const rows = await withOrgCore(ctx, (tx) =>
    tx
      .select({
        bundleProductId: finProductComponents.bundleProductId,
        childProductId: finProductComponents.childProductId,
        qty: finProductComponents.qty,
        metadata: finProducts.metadata,
      })
      .from(finProductComponents)
      .innerJoin(finProducts, eq(finProducts.id, finProductComponents.bundleProductId))
      .where(
        and(
          eq(finProductComponents.orgId, ctx.tenantId),
          inArray(finProductComponents.bundleProductId, productIds),
        ),
      ),
  );
  const out = new Map<string, PackageSpec>();
  for (const r of rows) {
    const spec = out.get(r.bundleProductId) ?? {
      edges: [],
      validityDays: packageValidityDays(r.metadata),
    };
    spec.edges.push({ childProductId: r.childProductId, qty: Number(r.qty) });
    out.set(r.bundleProductId, spec);
  }
  return out;
}

/**
 * Every plan a ticket's lines claim must exist IN THIS ORG and still be open —
 * `plan_id` is a plain uuid column, so an unchecked id from the wire would
 * otherwise let a caller attach money to another tenant's plan.
 */
async function assertPlansUsable(ctx: CoreCtx, planIds: string[]): Promise<void> {
  if (!planIds.length) return;
  const rows = await withOrgCore(ctx, (tx) =>
    tx
      .select({ id: posPaymentPlans.id, status: posPaymentPlans.status })
      .from(posPaymentPlans)
      .where(and(eq(posPaymentPlans.orgId, ctx.tenantId), inArray(posPaymentPlans.id, planIds))),
  );
  if (rows.length !== planIds.length) throw new PosError('plan not found', 'not_found');
  if (rows.some((r) => r.status === 'cancelled'))
    throw new PosError('plan is cancelled', 'plan_cancelled');
}

/**
 * Same trust-boundary check for `redemption_id`: ours, not already handed back,
 * and not already billed on another ticket.
 *
 * This is the EARLY, friendly check. The race-free one is the conditional
 * `set ticket_id where ticket_id is null` inside the money transaction
 * (`stampRedemptionInTx`) — two clerks ringing the same drawn session up at
 * once both pass here and the second one loses at the UPDATE.
 */
async function assertRedemptionsUsable(ctx: CoreCtx, redemptionIds: string[]): Promise<void> {
  if (!redemptionIds.length) return;
  const rows = await withOrgCore(ctx, (tx) =>
    tx
      .select({ id: posPackageRedemptions.id, ticketId: posPackageRedemptions.ticketId })
      .from(posPackageRedemptions)
      .where(
        and(
          eq(posPackageRedemptions.orgId, ctx.tenantId),
          inArray(posPackageRedemptions.id, redemptionIds),
          isNull(posPackageRedemptions.reversedAt),
        ),
      ),
  );
  if (rows.length !== redemptionIds.length)
    throw new PosError('redemption not found or already reversed', 'not_found');
  if (rows.some((r) => r.ticketId))
    throw new PosError('session is already billed on another ticket', 'redemption_already_billed');
}

/**
 * Back-link one drawn session to the line that billed it, inside the money tx.
 *
 * `where ticket_id is null` is the whole point: it is an atomic claim, so a
 * session can never carry two live ticket lines (spec §3.2, proposals §20).
 * `voidTicket` clears the stamp again, which is what makes a corrected re-ring
 * possible.
 */
async function stampRedemptionInTx(
  tx: CoreTx,
  orgId: string,
  args: { redemptionId: string; ticketId: string; ticketLineId: string },
): Promise<void> {
  const claimed = await tx
    .update(posPackageRedemptions)
    .set({ ticketId: args.ticketId, ticketLineId: args.ticketLineId })
    .where(
      and(
        eq(posPackageRedemptions.orgId, orgId),
        eq(posPackageRedemptions.id, args.redemptionId),
        isNull(posPackageRedemptions.reversedAt),
        isNull(posPackageRedemptions.ticketId),
      ),
    )
    .returning({ id: posPackageRedemptions.id });
  if (!claimed.length)
    throw new PosError('session is already billed on another ticket', 'redemption_already_billed');
}

/**
 * Spend stored value on this ticket, inside the money tx.
 *
 * The advisory lock is what makes the balance check real: two clerks charging
 * the same client's credit at once serialise on it, so the second one sees the
 * first one's negative row instead of both passing a stale balance.
 */
async function chargeClientCredit(
  tx: CoreTx,
  orgId: string,
  args: {
    client: ClientRef;
    amount: number;
    currency: string;
    ticketId: string;
    note: string;
    actor: Actor;
  },
): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext(${`pos-credit:${orgId}:${clientKeyOf(args.client)}`}))`,
  );
  const rows = await tx
    .select({ amount: posClientLedger.amount })
    .from(posClientLedger)
    .where(and(eq(posClientLedger.orgId, orgId), clientMatch(args.client, posClientLedger)));
  const balance = ledgerBalance(rows);
  // Same 1-cent tolerance the payment_mismatch guard uses.
  if (balance + 0.005 < args.amount)
    throw new PosError(
      `credit balance ${balance} does not cover ${args.amount}`,
      'insufficient_credit',
    );
  await addLedgerEntryInTx(tx, orgId, {
    client: args.client,
    kind: 'redemption',
    amount: -args.amount,
    currency: args.currency,
    ticketId: args.ticketId,
    note: args.note,
    actor: args.actor,
  });
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
    // A line covered by a package session is legitimately FREE — its money
    // moved when the package was sold (spec §3.2). That is the only exemption;
    // a negative price is still a bug either way.
    if (l.unitPrice < 0 || (!(l.unitPrice > 0) && !l.redemptionId))
      throw new PosError('line needs a price', 'zero_price');
    if (l.discount != null && l.discount > round2(l.qty * l.unitPrice))
      throw new PosError('line discount cannot exceed the line total', 'invalid_discount');
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
  if (discount > subtotal || total < 0)
    throw new PosError('order discount cannot exceed the order total', 'invalid_discount');
  const paid = round2(input.payments.reduce((a, p) => a + p.amount, 0));
  if (Math.abs(paid - total) >= 0.01)
    throw new PosError(`paid ${paid} != total ${total}`, 'payment_mismatch');
  if (settings.requireCustomer && !input.partyId && !input.customerName)
    throw new PosError('customer required', 'customer_required');
  // Identity document (FACES: a DNI/RUC per invoice). The party spine is the
  // authority — a typed-in `customerName` is not an identity, and the number
  // the browser claims is not evidence. Only queried when the org asked for it,
  // so an org with the requirement off pays nothing for it.
  // TODO(handoff): `'optional'` is STORED and surfaced in /pos/settings but is
  // inert here and in the till — it behaves exactly like `'off'`. It exists so
  // the level is already modelled when the nudge (a non-blocking warning on the
  // charge button) is built. See meta
  // proposals/2026-09-13-pos-packages-plans-s1-followups.md §30.
  if (settings.requirements.identityDocument === 'required') {
    const party = input.partyId ? await getParty(ctx, input.partyId) : null;
    if (!party?.docNumber)
      throw new PosError(
        'this organization requires an identity document on every ticket',
        'identity_document_required',
      );
  }

  // ---- packages / plans / credit: resolve + validate before any write ----
  const client: ClientRef = {
    partyId: input.partyId ?? null,
    crmContactId: input.crmContactId ?? null,
  };
  const hasClient = Boolean(client.partyId || client.crmContactId);
  const packages = await resolvePackageSpecs(ctx, [
    ...new Set(input.lines.map((l) => l.finProductId).filter((v): v is string => Boolean(v))),
  ]);
  // A grant belongs to somebody. Selling sessions to an anonymous walk-in
  // would mint credit nobody can ever redeem.
  if (packages.size && !hasClient)
    throw new PosError('a package sale needs an identified client', 'package_requires_customer');
  const expiryByProduct = new Map<string, string | null>();
  if (packages.size) {
    const today = grantToday((await getFinSettings(ctx)).timezone);
    for (const [productId, spec] of packages)
      expiryByProduct.set(productId, expiryFrom(today, spec.validityDays));
  }
  const planIds = [
    ...new Set(input.lines.map((l) => l.planId).filter((v): v is string => Boolean(v))),
  ];
  await assertPlansUsable(ctx, planIds);
  await assertRedemptionsUsable(ctx, [
    ...new Set(input.lines.map((l) => l.redemptionId).filter((v): v is string => Boolean(v))),
  ]);
  const creditPaid = round2(
    input.payments.filter((p) => p.method === CREDIT_METHOD_ID).reduce((a, p) => a + p.amount, 0),
  );
  if (creditPaid > 0 && !hasClient)
    throw new PosError('paying with credit needs an identified client', 'client_required');

  // ---- stock preflight (F-partial-stock-shortfall): check BEFORE payment is
  // taken, not after commit. A short line used to be discovered post-commit
  // and dropped the WHOLE stock entry (every in-stock line lost, void had
  // nothing to restore). Refuse up front unless the caller (route-enforced
  // 'pos'/'manage') explicitly opts into selling below available stock —
  // this is a SNAPSHOT read purely to decide refuse-vs-proceed; postTicketStock
  // (post-commit) re-checks fresh right before it actually issues, so a line
  // that only goes short in the race window between here and there (or under
  // an override) is excluded there too, never silently dropping every other
  // line with it. ----
  if (await isModuleEnabled(ctx, 'stock')) {
    const candidateWarehouseId = await resolveDefaultWarehouse(ctx);
    if (candidateWarehouseId) {
      const candidateIssueLines = await resolveIssueLines(
        ctx,
        input.lines as unknown as PosTicketLine[],
      );
      const stockShortfalls = await checkStockShortfalls(
        ctx,
        candidateIssueLines,
        candidateWarehouseId,
      );
      if (stockShortfalls.length && !input.allowNegativeStock) {
        const detail = stockShortfalls
          .map(
            (s) =>
              `${s.itemName} (${s.itemCode}): requested ${s.requested}, available ${s.available}`,
          )
          .join('; ');
        throw new PosError(`insufficient stock: ${detail}`, 'insufficient_stock');
      }
    }
  }

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

    const insertedLines = await tx
      .insert(posTicketLines)
      .values(
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
          planId: l.planId ?? null,
          redemptionId: l.redemptionId ?? null,
        })),
      )
      // Keyed back by lineNo, not by array position — RETURNING order is not a
      // contract, lineNo is.
      .returning({ id: posTicketLines.id, lineNo: posTicketLines.lineNo });
    const lineIdByNo = new Map(insertedLines.map((r) => [r.lineNo, r.id]));

    // Back-link every drawn session to the line that bills it, in THIS
    // transaction — the atomic claim that stops one session being billed twice.
    for (const [i, l] of input.lines.entries()) {
      if (!l.redemptionId) continue;
      const lineId = lineIdByNo.get(i);
      if (!lineId) throw new PosError('ticket line was not persisted', 'line_insert_failed');
      await stampRedemptionInTx(tx, ctx.tenantId, {
        redemptionId: l.redemptionId,
        ticketId: row.id,
        ticketLineId: lineId,
      });
    }

    // Bundle explosion: every package line mints one grant per child edge,
    // inside THIS transaction, so sessions commit with the money (spec §3.1).
    for (const [i, l] of input.lines.entries()) {
      const spec = l.finProductId ? packages.get(l.finProductId) : undefined;
      if (!spec) continue;
      const lineId = lineIdByNo.get(i);
      if (!lineId) throw new PosError('ticket line was not persisted', 'line_insert_failed');
      await createGrantsForTicketLine(tx, ctx.tenantId, {
        line: {
          ticketId: row.id,
          lineId,
          packageProductId: l.finProductId as string,
          qty: l.qty,
          total: lineTotals[i],
        },
        edges: spec.edges,
        client,
        expiresAt: expiryByProduct.get(l.finProductId as string) ?? null,
      });
    }

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

    // `credit` is just another tender: the sum(payments) === total invariant
    // above already held, this only moves the stored value that backs it.
    if (creditPaid > 0) {
      await chargeClientCredit(tx, ctx.tenantId, {
        client,
        amount: creditPaid,
        currency: settings.currency,
        ticketId: row.id,
        note: humanId,
        actor: input.actor,
      });
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

  // ---- POST-COMMIT plan settlement, fail-soft ----
  // Derived from the lines that just committed, so a failure here only leaves a
  // fully-paid plan sitting at `open` until the next write recomputes it — it
  // never un-takes the money.
  for (const planId of planIds) {
    try {
      await settlePlanIfPaid(ctx, planId);
    } catch (e) {
      console.error('[pos] plan settle failed', planId, e);
    }
  }

  // ---- POST-COMMIT shadow emission, fail-soft (spec 2026-08-14-pos-shadow-
  // emission-spec.md §4) — invisible to the cashier, never blocks checkout.
  if (settings.emission.mode === 'shadow') {
    await triggerShadowEmission(ctx, ticket, settings);
  }

  return { ticket, stockWarning };
}

/**
 * What a void has to undo on the package side: the sessions this ticket drew,
 * and the grants it minted.
 *
 * A grant may only be cancelled while nothing has been drawn from it ELSEWHERE
 * — a redemption belonging to this same ticket doesn't count, because the void
 * hands it back in the same breath. Anything else is 409 `package_in_use`
 * (spec §3.6): the client must never silently lose a session they already took.
 */
async function packageReversalPlan(
  tx: CoreTx,
  orgId: string,
  ticketId: string,
): Promise<{ redemptionIds: string[]; stampedIds: string[]; grantIds: string[] }> {
  // Every redemption this ticket touched — the ones it DREW at the till
  // (no booking) and the ones it merely BILLED for an existing appointment.
  const redemptions = await tx
    .select({
      id: posPackageRedemptions.id,
      bookingId: posPackageRedemptions.bookingId,
      reversedAt: posPackageRedemptions.reversedAt,
    })
    .from(posPackageRedemptions)
    .where(
      and(eq(posPackageRedemptions.orgId, orgId), eq(posPackageRedemptions.ticketId, ticketId)),
    );
  // Only a session this ticket itself drew goes back on the void. One drawn at
  // BOOKING time stays drawn — the appointment still stands; the void only
  // un-bills it (the stamp is cleared below), so it can be rung up again.
  const reverseIds = redemptions.filter((r) => !r.bookingId && !r.reversedAt).map((r) => r.id);
  const grants = await tx
    .select({ id: posPackageGrants.id })
    .from(posPackageGrants)
    .where(
      and(
        eq(posPackageGrants.orgId, orgId),
        eq(posPackageGrants.sourceTicketId, ticketId),
        ne(posPackageGrants.status, 'cancelled'),
      ),
    );
  const grantIds = grants.map((g) => g.id);
  if (grantIds.length) {
    const live = await tx
      .select({ id: posPackageRedemptions.id })
      .from(posPackageRedemptions)
      .where(
        and(
          eq(posPackageRedemptions.orgId, orgId),
          inArray(posPackageRedemptions.grantId, grantIds),
          isNull(posPackageRedemptions.reversedAt),
          // "Live ELSEWHERE" = not one of the sessions this void hands back.
          ...(reverseIds.length ? [notInArray(posPackageRedemptions.id, reverseIds)] : []),
        ),
      )
      .limit(1);
    if (live.length)
      throw new PosError('a session of this package is already booked', 'package_in_use');
  }
  return { redemptionIds: reverseIds, stampedIds: redemptions.map((r) => r.id), grantIds };
}

/**
 * Void guard order: not_found → already_void → reconciled (invoice already
 * points at this ticket) → shift_closed → package_in_use → cancel the linked
 * stock entry (StockError degrades to a stored void_stock_failed warning but
 * the void PROCEEDS) → reverse redemptions + cancel grants + write opposing
 * ledger rows + mark void, in one transaction.
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

  // ponytail: read once, BEFORE the stock cancel, so a package_in_use refusal
  // never leaves a cancelled stock entry behind on a ticket that stays live.
  // The residual window (a booking redeeming one of these grants between this
  // read and the tx below) is milliseconds wide and costs a re-void at worst;
  // re-checking inside the tx is the upgrade if it ever bites.
  const reversal = await withOrgCore(ctx, (tx) => packageReversalPlan(tx, ctx.tenantId, id));

  let stockWarning: StockWarning | null = null;
  if (ticket.stockEntryId) {
    try {
      await cancelEntry(ctx, ticket.stockEntryId, actor);
    } catch (e) {
      if (!(e instanceof StockError)) throw e;
      stockWarning = { code: 'void_stock_failed', message: e.message };
    }
  }

  const reason = `void of ${ticket.humanId}`;
  const [row] = await withOrgCore(ctx, async (tx) => {
    for (const redemptionId of reversal.redemptionIds)
      await reverseRedemptionInTx(tx, ctx.tenantId, redemptionId, { reason, actor });
    // Un-bill: the sessions this ticket charged for are free to be rung up on a
    // corrected ticket. Without this a void would strand them as "already
    // billed" forever (`redemption_already_billed`).
    if (reversal.stampedIds.length) {
      await tx
        .update(posPackageRedemptions)
        .set({ ticketId: null, ticketLineId: null })
        .where(
          and(
            eq(posPackageRedemptions.orgId, ctx.tenantId),
            inArray(posPackageRedemptions.id, reversal.stampedIds),
          ),
        );
    }
    if (reversal.grantIds.length) {
      await tx
        .update(posPackageGrants)
        .set({ status: 'cancelled', cancelledAt: new Date(), cancelledBy: actor.id })
        .where(
          and(
            eq(posPackageGrants.orgId, ctx.tenantId),
            inArray(posPackageGrants.id, reversal.grantIds),
          ),
        );
    }
    // The ledger is append-only, so unwinding stored value is an opposing row,
    // never an edit. `metadata.voidOf` keeps it idempotent if this ever runs
    // twice (it cannot today — `already_void` guards the entry).
    const ledgerRows = await tx
      .select()
      .from(posClientLedger)
      .where(and(eq(posClientLedger.orgId, ctx.tenantId), eq(posClientLedger.ticketId, id)));
    for (const entry of ledgerRows) {
      if ((entry.metadata as Record<string, unknown> | null)?.voidOf) continue;
      const amount = round2(-toAmount(entry.amount));
      if (!amount) continue;
      await addLedgerEntryInTx(tx, ctx.tenantId, {
        client: { partyId: entry.partyId, crmContactId: entry.crmContactId },
        kind: 'adjustment',
        amount,
        currency: entry.currency,
        ticketId: id,
        planId: entry.planId,
        bookingId: entry.bookingId,
        note: reason,
        metadata: { voidOf: entry.id },
        actor,
      });
    }
    return tx
      .update(posTickets)
      .set({
        status: 'void',
        voidedAt: new Date(),
        voidedBy: actor.id,
        ...(stockWarning ? { stockWarning } : {}),
      })
      .where(and(eq(posTickets.id, id), eq(posTickets.orgId, ctx.tenantId)))
      .returning();
  });
  // TODO(handoff): voiding an instalment ticket un-pays its plan (paid-to-date
  // is derived over non-void tickets) but does NOT flip a `settled` plan back
  // to `open` — settlePlanIfPaid only ever settles. Harmless today (the derived
  // progress on every read is correct); the stored status can lie. See meta
  // proposals/2026-09-13-pos-packages-plans-s1-followups.md.
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
 *
 * `includeInactive` defaults to false (unchanged behavior for every existing
 * caller — POS sell screen, gateway query tool); only the catalog manager
 * passes it true so deactivated sellables stay reachable/reactivatable.
 */
export async function listSellables(
  ctx: CoreCtx,
  opts: { includeInactive?: boolean } = {},
): Promise<SellableRow[]> {
  return withOrgCore(ctx, async (tx) => {
    const activeFilter = opts.includeInactive ? sql`` : sql`and p.active = true`;
    const rows = (await tx.execute(sql`${SELLABLE_MERGE_SQL}
      where p.org_id = ${ctx.tenantId} ${activeFilter}
      group by p.id, i.id
      order by p.name`)) as unknown as SellableSqlRow[];
    return rows.map(mapSellableRow);
  }).then(async (rows) => {
    await applyRecipeAvailability(ctx, rows);
    return rows;
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
  const row = mapSellableRow(rows[0]);
  await applyRecipeAvailability(ctx, [row]);
  return row;
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
 *  convention as enqueueJob in finance-sync-jobs.service.ts. Exported for
 *  pos-emission.service.ts's seedShadowSeries (same idiom, different file —
 *  avoids a second copy of the `code === '23505'` duck-type check). */
export function isUniqueViolation(e: unknown): boolean {
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
  consumption?: Array<{ itemId: string; qtyPerUnit: number; note?: string | null }>;
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
        {
          finProductId: product.id,
          itemId: c.itemId,
          qtyPerUnit: c.qtyPerUnit,
          note: c.note ?? null,
        },
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
  if (patch.kind !== undefined || patch.trackStock !== undefined || patch.uom !== undefined) {
    const facts = await deriveSellableFacts(ctx, productId);
    if (patch.kind !== undefined && patch.kind !== facts.kind) {
      // `kind` is derived by design and is never a directly settable field in
      // any slice of this fix — refusing a direct write is the permanent,
      // correct behavior, not deferred work.
      throw new PosError(
        'kind follows the linked stock item; publish or unlink an item to change it',
        'kind_derived',
      );
    }
    if (patch.trackStock !== undefined && patch.trackStock !== facts.trackStock) {
      // TODO(handoff): apply the safe trackStock transitions (false→true:
      // create the link; true→false on a pristine item: unlink) instead of
      // refusing unconditionally — S2/S3 of
      // 2026-08-17-hub-updatesellable-silent-drop-spec. Refusing is safe
      // (never silently dropped) but not yet the preferred branch.
      throw new PosError(
        'stock tracking cannot be changed on an existing sellable yet',
        'stock_tracking_immutable',
      );
    }
    if (
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
    await withOrgCore(ctx, (tx) =>
      tx
        .update(finProducts)
        .set({
          code,
          name,
          category,
          unitPrice: unitPrice == null ? null : String(unitPrice),
          active,
          updatedAt: new Date(),
        })
        .where(and(eq(finProducts.id, productId), eq(finProducts.orgId, ctx.tenantId))),
    );
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
        {
          finProductId: productId,
          itemId: c.itemId,
          qtyPerUnit: c.qtyPerUnit,
          note: c.note ?? null,
        },
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

/**
 * `packageValidityDays` lives in `fin_products.metadata` rather than a column:
 * it is meaningful only for a sellable that HAS bundle edges, and the catalog
 * already carries per-product metadata (aliases, taxonomy). Null clears it.
 */
export async function setPackageValidityDays(
  ctx: CoreCtx,
  productId: string,
  days: number | null,
): Promise<void> {
  const value = days == null || !(days > 0) ? null : Math.floor(days);
  const [row] = await withOrgCore(ctx, (tx) =>
    tx
      .update(finProducts)
      .set({
        // Merge, never replace — metadata holds aliases the invoice sync
        // resolves through.
        metadata: sql`coalesce(${finProducts.metadata}, '{}'::jsonb) || ${JSON.stringify({ packageValidityDays: value })}::jsonb`,
        updatedAt: new Date(),
      })
      .where(and(eq(finProducts.id, productId), eq(finProducts.orgId, ctx.tenantId)))
      .returning({ id: finProducts.id }),
  );
  if (!row) throw new PosError('product not found', 'not_found');
  await bustFinanceCache(ctx);
}

export async function getPackageValidityDays(
  ctx: CoreCtx,
  productId: string,
): Promise<number | null> {
  const [row] = await withOrgCore(ctx, (tx) =>
    tx
      .select({ metadata: finProducts.metadata })
      .from(finProducts)
      .where(and(eq(finProducts.id, productId), eq(finProducts.orgId, ctx.tenantId)))
      .limit(1),
  );
  if (!row) throw new PosError('product not found', 'not_found');
  return packageValidityDays(row.metadata);
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

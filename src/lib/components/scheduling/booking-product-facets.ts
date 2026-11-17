/**
 * Spec 126 (F5): the shared, client-safe wire for what a visit SOLD, so the
 * POS calendar hover and the detail drawer render one projection. Pure — no
 * server import — so the serializer used by both read paths lives here.
 *
 * The versioned detail envelope (`BookingProductFacets`) and the reduced calendar variant
 * (`CalendarProductFacets`: sold + payment + stock anchor, no basic/planned) live here with their
 * strict decoders; money is only ever read from an `available` payment facet.
 */

import type { BookingVisit, FinancialVisitRow, VisitProductLine } from './visit';

/** The header every detail and calendar-window GET must send; a missing or other value is HTTP 409. */
export const BOOKING_PRODUCTS_VERSION_HEADER = 'X-Minion-Booking-Products-Version';
export const BOOKING_PRODUCTS_VERSION = 1;

export type BookingReadFacet<T> =
  | { state: 'available'; value: T }
  | { state: 'empty' }
  | { state: 'denied' }
  | {
      state: 'unavailable';
      reason:
        'read_failed' | 'invalid_projection' | 'refresh_required' | 'capacity' | 'not_in_slice';
    };

export type SoldRelation = 'direct' | 'group' | 'co_ticket_unassigned';

/** One product line of a non-void sale that belongs to the visit. */
export interface SoldProductBasic {
  ticketId: string;
  lineId: string;
  productId: string | null;
  bookingId: string | null;
  ticketHumanId: string | null;
  description: string;
  qty: number;
  relation: SoldRelation;
  /** true when the recorded line total is 0; null unless financial fields are admitted. */
  gift: boolean | null;
}

export type SoldFacet = BookingReadFacet<{ rows: SoldProductBasic[] }>;

/** A product line of a linked sale, as the POS read returns it (server side only: carries `total`). */
export interface SoldLineRecord {
  ticketId: string;
  ticketHumanId: string | null;
  lineId: string;
  productId: string | null;
  bookingId: string | null;
  description: string;
  qty: number;
  total: number;
}

/**
 * The decision table of contracts/behavior.md: a line is `direct` on the visit
 * anchor, `group` on another authorized member, `co_ticket_unassigned` with no
 * booking, and EXCLUDED when it names a booking outside the visit. Rows are
 * deduplicated by (ticketId, lineId), never by description.
 */
export function soldRowsForVisit(
  lines: ReadonlyArray<SoldLineRecord>,
  visit: { anchorId: string; memberIds: ReadonlySet<string> },
  canReadFinancialFields: boolean,
): SoldFacet {
  const seen = new Set<string>();
  const rows: SoldProductBasic[] = [];
  for (const l of lines) {
    const key = `${l.ticketId}:${l.lineId}`;
    if (seen.has(key)) continue;
    let relation: SoldRelation;
    if (l.bookingId === null) relation = 'co_ticket_unassigned';
    else if (l.bookingId === visit.anchorId) relation = 'direct';
    else if (visit.memberIds.has(l.bookingId)) relation = 'group';
    else continue;
    seen.add(key);
    rows.push({
      ticketId: l.ticketId,
      lineId: l.lineId,
      productId: l.productId,
      bookingId: l.bookingId,
      ticketHumanId: l.ticketHumanId,
      description: l.description,
      qty: l.qty,
      relation,
      gift: canReadFinancialFields ? l.total === 0 : null,
    });
  }
  return rows.length ? { state: 'available', value: { rows } } : { state: 'empty' };
}

const REASONS = new Set([
  'read_failed',
  'invalid_projection',
  'refresh_required',
  'capacity',
  'not_in_slice',
]);
const RELATIONS = new Set<string>(['direct', 'group', 'co_ticket_unassigned']);

function isSoldRow(v: unknown): v is SoldProductBasic {
  const r = v as Record<string, unknown> | null;
  return (
    !!r &&
    typeof r.ticketId === 'string' &&
    typeof r.lineId === 'string' &&
    (r.productId === null || typeof r.productId === 'string') &&
    (r.bookingId === null || typeof r.bookingId === 'string') &&
    (r.ticketHumanId === null || typeof r.ticketHumanId === 'string') &&
    typeof r.description === 'string' &&
    typeof r.qty === 'number' &&
    Number.isFinite(r.qty) &&
    typeof r.relation === 'string' &&
    RELATIONS.has(r.relation) &&
    (r.gift === null || typeof r.gift === 'boolean')
  );
}

/** Strict decoder: a missing or malformed facet is `unavailable`, never an empty list. */
export function decodeSoldFacet(input: unknown): SoldFacet {
  const f = input as { state?: unknown; value?: { rows?: unknown }; reason?: unknown } | null;
  if (!f || typeof f !== 'object') return { state: 'unavailable', reason: 'invalid_projection' };
  if (f.state === 'empty') return { state: 'empty' };
  if (f.state === 'denied') return { state: 'denied' };
  if (f.state === 'unavailable')
    return typeof f.reason === 'string' && REASONS.has(f.reason)
      ? { state: 'unavailable', reason: f.reason as never }
      : { state: 'unavailable', reason: 'invalid_projection' };
  if (f.state === 'available') {
    const rows = f.value?.rows;
    if (Array.isArray(rows) && rows.length > 0 && rows.every(isSoldRow))
      return { state: 'available', value: { rows } };
  }
  return { state: 'unavailable', reason: 'invalid_projection' };
}

/** Rows of an available sold facet; empty for every other state (callers that must tell them apart read `state`). */
export function soldRows(f: SoldFacet | undefined): SoldProductBasic[] {
  return f?.state === 'available' ? f.value.rows : [];
}

// ── US2: persistent stock-recovery facet (decoded client side) ───────────────

export type RecoveryEligibility = 'retry_saved' | 'confirm_open' | 'not_needed' | 'manual_review';

export interface RecoveryOpenRowWire {
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

export interface StockRecoveryMemberWire {
  bookingId: string;
  status: string;
  openCount: number;
  realizedCount: number;
  releasedCount: number;
  sourceEntry: { id: string; status: 'draft' | 'submitted' } | null;
  eligibility: RecoveryEligibility;
  /** Only `confirm_open` carries it; `null` otherwise or when the open set cannot be offered. */
  confirmation: {
    openCount: number;
    rows: RecoveryOpenRowWire[];
    expectedOpenFingerprint: string;
  } | null;
}

export type RecoveryFacet = BookingReadFacet<StockRecoveryMemberWire[]>;

const ELIGIBILITY = new Set<string>(['retry_saved', 'confirm_open', 'not_needed', 'manual_review']);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isNumOrNull = (v: unknown): v is number | null => v === null || isNum(v);
const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

function isOpenRow(v: unknown): v is RecoveryOpenRowWire {
  const r = v as Record<string, unknown> | null;
  return (
    !!r &&
    isStr(r.accrualId) &&
    isStr(r.itemId) &&
    typeof r.itemName === 'string' &&
    typeof r.uom === 'string' &&
    (r.consumptionUom === null || typeof r.consumptionUom === 'string') &&
    isNumOrNull(r.unitsPerStockUom) &&
    isNumOrNull(r.subunitsPerStockUom) &&
    typeof r.diagramEnabled === 'boolean' &&
    isNum(r.qty) &&
    isNum(r.qtyConsumption)
  );
}

/** A member whose shape or confirmation set is inconsistent is rejected whole. */
function decodeRecoveryMember(v: unknown): StockRecoveryMemberWire | null {
  const r = v as Record<string, unknown> | null;
  if (
    !r ||
    !isStr(r.bookingId) ||
    typeof r.status !== 'string' ||
    !isNum(r.openCount) ||
    !isNum(r.realizedCount) ||
    !isNum(r.releasedCount) ||
    typeof r.eligibility !== 'string' ||
    !ELIGIBILITY.has(r.eligibility)
  )
    return null;
  const entry = r.sourceEntry as { id?: unknown; status?: unknown } | null;
  if (
    entry !== null &&
    !(isStr(entry?.id) && (entry?.status === 'draft' || entry?.status === 'submitted'))
  )
    return null;
  let confirmation: StockRecoveryMemberWire['confirmation'] = null;
  const c = r.confirmation as {
    state?: unknown;
    value?: { openCount?: unknown; rows?: unknown; expectedOpenFingerprint?: unknown };
  } | null;
  if (c && c.state === 'available') {
    const v2 = c.value;
    const rows = v2?.rows;
    if (
      !v2 ||
      !Array.isArray(rows) ||
      !rows.every(isOpenRow) ||
      !isNum(v2.openCount) ||
      v2.openCount !== rows.length ||
      new Set(rows.map((x) => x.accrualId)).size !== rows.length ||
      typeof v2.expectedOpenFingerprint !== 'string' ||
      !/^[0-9a-f]{64}$/.test(v2.expectedOpenFingerprint)
    )
      return null;
    confirmation = {
      openCount: v2.openCount,
      rows,
      expectedOpenFingerprint: v2.expectedOpenFingerprint,
    };
  }
  // confirm_open without a complete, agreeing open set is never actionable.
  if (
    r.eligibility === 'confirm_open' &&
    (!confirmation || confirmation.openCount < 1 || confirmation.openCount !== r.openCount)
  )
    return null;
  return {
    bookingId: r.bookingId,
    status: r.status,
    openCount: r.openCount,
    realizedCount: r.realizedCount,
    releasedCount: r.releasedCount,
    sourceEntry:
      entry === null
        ? null
        : { id: entry.id as string, status: entry.status as 'draft' | 'submitted' },
    eligibility: r.eligibility as RecoveryEligibility,
    confirmation,
  };
}

/** Strict: anything malformed is `unavailable`, never "nothing to recover". */
export function decodeRecoveryFacet(input: unknown): RecoveryFacet {
  const f = input as { state?: unknown; value?: unknown; reason?: unknown } | null;
  if (!f || typeof f !== 'object') return { state: 'unavailable', reason: 'invalid_projection' };
  if (f.state === 'empty') return { state: 'empty' };
  if (f.state === 'denied') return { state: 'denied' };
  if (f.state === 'unavailable')
    return typeof f.reason === 'string' && REASONS.has(f.reason)
      ? { state: 'unavailable', reason: f.reason as never }
      : { state: 'unavailable', reason: 'invalid_projection' };
  if (f.state === 'available' && Array.isArray(f.value) && f.value.length > 0) {
    const members = f.value.map(decodeRecoveryMember);
    if (members.every((m): m is StockRecoveryMemberWire => m !== null))
      return { state: 'available', value: members };
  }
  return { state: 'unavailable', reason: 'invalid_projection' };
}

// ── Versioned detail envelope (contracts/wire.md) ────────────────────────────

export type BasicVisitMember = {
  id: string;
  seq: number;
  eventTypeId: string;
  eventTypeTitle: string;
  productId: string | null;
  minutes: number;
  status: string;
  /** null unless the parent-removal guard could be resolved under POS and stock admission. */
  canRemoveService: boolean | null;
};
export type BasicVisit = { anchorId: string; groupId: string | null; members: BasicVisitMember[] };
export type PlannedProductBasic = { productId: string; name: string; qty: number };
export type ServiceFinancialRow = {
  bookingId: string;
  paid: boolean;
  price: number | null;
  paidAmount: number;
  currency: string | null;
  funding: 'cash' | 'grant' | 'plan';
  ticketIds: string[];
};
export type BookingStockCostFacet =
  | { state: 'empty' }
  | { state: 'denied' }
  | {
      state: 'unavailable';
      reason:
        | 'valuation_currency_unverified'
        | 'read_failed'
        | 'invalid_projection'
        | 'capacity'
        | 'not_in_slice';
    };
export type FullBookingTicketWire = {
  ticketId: string;
  humanId: string | null;
  submittedAt: string | null;
  status: string;
  currency: string;
  lineTotal: string;
  subtotal: string;
  discount: string;
  total: string;
  note: string | null;
  payments: { method: string; amount: string }[];
  otherLines: string[];
  lineCount: number;
  emission: { docType: string; serie: string; correlativo: number; status: string } | null;
  createdByName: string | null;
  invoiceId: string | null;
};
export type BookingGrantWire = {
  grant: { id: string; sessionsTotal: number; unitValue: string; expiresAt: string | null };
  sessionsUsed: number;
  sessionsRemaining: number;
  status: string;
  packageName: string | null;
};
export type BookingPlanWire = {
  plan: { id: string; title: string; totalAmount: string; currency: string; status: string };
  paidToDate: number;
  remaining: number;
  isPaid: boolean;
  nextDue: { dueOn: string; amount: number } | null;
  scheduleIssue: 'invalid_rows' | 'principal_mismatch' | 'too_many_rows' | null;
};
export type BookingFinancialProjection = {
  services: ServiceFinancialRow[];
  planned: VisitProductLine[];
  soldTotals: { ticketId: string; lineId: string; total: number }[];
  tickets: FullBookingTicketWire[];
  bookingInvoiceId: string | null;
  grant: BookingGrantWire | null;
  plan: BookingPlanWire | null;
  accrualCost: BookingStockCostFacet;
};
export type AnchorAccrualWire = {
  open: number;
  realized: number;
  released: number;
  realizedEntryId: string | null;
};
export type BookingStockFacetValue = {
  anchorAccrual: AnchorAccrualWire | null;
  recovery: RecoveryFacet;
};
export type BookingProductFacets = {
  version: 1;
  basic: BookingReadFacet<BasicVisit>;
  planned: BookingReadFacet<{ rows: PlannedProductBasic[] }>;
  sold: SoldFacet;
  payment: BookingReadFacet<BookingFinancialProjection>;
  stock: BookingReadFacet<BookingStockFacetValue>;
};

const INVALID = { state: 'unavailable', reason: 'invalid_projection' } as const;
const isObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const isNullableStr = (v: unknown): v is string | null => v === null || typeof v === 'string';
const isStrAny = (v: unknown): v is string => typeof v === 'string';
const FUNDING = new Set(['cash', 'grant', 'plan']);

/** Shared state handling: only `available` reaches `value`, and a bad value is `unavailable`, never empty. */
function decodeFacet<T>(input: unknown, value: (v: unknown) => T | null): BookingReadFacet<T> {
  if (!isObj(input)) return INVALID;
  if (input.state === 'empty') return { state: 'empty' };
  if (input.state === 'denied') return { state: 'denied' };
  if (input.state === 'unavailable')
    return typeof input.reason === 'string' && REASONS.has(input.reason)
      ? { state: 'unavailable', reason: input.reason as never }
      : INVALID;
  if (input.state === 'available') {
    const v = value(input.value);
    return v === null ? INVALID : { state: 'available', value: v };
  }
  return INVALID;
}

function decodeBasic(v: unknown): BasicVisit | null {
  if (!isObj(v) || !isStr(v.anchorId) || !isNullableStr(v.groupId) || !Array.isArray(v.members))
    return null;
  const members = v.members as unknown[];
  if (members.length < 1 || members.length > 8) return null;
  const out: BasicVisitMember[] = [];
  for (const m of members) {
    if (
      !isObj(m) ||
      !isStr(m.id) ||
      !isNum(m.seq) ||
      !isStr(m.eventTypeId) ||
      !isStrAny(m.eventTypeTitle) ||
      !isNullableStr(m.productId) ||
      !isNum(m.minutes) ||
      !isStr(m.status) ||
      !(m.canRemoveService === null || typeof m.canRemoveService === 'boolean')
    )
      return null;
    out.push(m as unknown as BasicVisitMember);
  }
  if (new Set(out.map((m) => m.id)).size !== out.length || out[0]!.id !== v.anchorId) return null;
  return { anchorId: v.anchorId, groupId: v.groupId, members: out };
}

function decodePlanned(v: unknown): { rows: PlannedProductBasic[] } | null {
  const rows = isObj(v) ? v.rows : null;
  if (
    !Array.isArray(rows) ||
    rows.length < 1 ||
    !rows.every((r) => isObj(r) && isStr(r.productId) && isStrAny(r.name) && isNum(r.qty)) ||
    new Set(rows.map((r) => r.productId)).size !== rows.length
  )
    return null;
  return { rows: rows as PlannedProductBasic[] };
}

function decodeCostFacet(v: unknown): BookingStockCostFacet | null {
  if (!isObj(v)) return null;
  // Closed non-value union: any value-bearing key is a defect.
  if ('value' in v || 'estValue' in v || 'realizedValue' in v || 'currency' in v) return null;
  if (v.state === 'empty' || v.state === 'denied') return { state: v.state };
  if (
    v.state === 'unavailable' &&
    typeof v.reason === 'string' &&
    (REASONS.has(v.reason) || v.reason === 'valuation_currency_unverified')
  )
    return { state: 'unavailable', reason: v.reason as never };
  return null;
}

function decodeTicket(t: unknown): FullBookingTicketWire | null {
  if (
    !isObj(t) ||
    !isStr(t.ticketId) ||
    !isNullableStr(t.humanId) ||
    !isNullableStr(t.submittedAt) ||
    !isStr(t.status) ||
    t.status === 'void' ||
    t.status === 'voided' ||
    !isStrAny(t.currency) ||
    !isStrAny(t.lineTotal) ||
    !isStrAny(t.subtotal) ||
    !isStrAny(t.discount) ||
    !isStrAny(t.total) ||
    !isNullableStr(t.note) ||
    !Array.isArray(t.payments) ||
    !t.payments.every((p) => isObj(p) && isStrAny(p.method) && isStrAny(p.amount)) ||
    !Array.isArray(t.otherLines) ||
    !t.otherLines.every(isStrAny) ||
    !isNum(t.lineCount) ||
    !(t.emission === null || isObj(t.emission)) ||
    !isNullableStr(t.createdByName) ||
    !isNullableStr(t.invoiceId)
  )
    return null;
  return t as unknown as FullBookingTicketWire;
}

function decodePayment(v: unknown): BookingFinancialProjection | null {
  if (
    !isObj(v) ||
    !Array.isArray(v.services) ||
    !Array.isArray(v.planned) ||
    !Array.isArray(v.tickets)
  )
    return null;
  for (const r of v.services) {
    if (
      !isObj(r) ||
      !isStr(r.bookingId) ||
      typeof r.paid !== 'boolean' ||
      !(r.price === null || isNum(r.price)) ||
      !isNum(r.paidAmount) ||
      !isNullableStr(r.currency) ||
      typeof r.funding !== 'string' ||
      !FUNDING.has(r.funding) ||
      !Array.isArray(r.ticketIds) ||
      !r.ticketIds.every(isStr)
    )
      return null;
  }
  if (
    new Set((v.services as { bookingId: string }[]).map((r) => r.bookingId)).size !==
    v.services.length
  )
    return null;
  for (const p of v.planned) {
    if (
      !isObj(p) ||
      !isStr(p.productId) ||
      !isStrAny(p.name) ||
      !(p.unitPrice === null || isNum(p.unitPrice)) ||
      !isNum(p.qty) ||
      typeof p.paid !== 'boolean'
    )
      return null;
  }
  const tickets = v.tickets.map(decodeTicket);
  if (tickets.some((t) => t === null)) return null;
  if (
    !Array.isArray(v.soldTotals) ||
    !v.soldTotals.every((t) => isObj(t) && isStr(t.ticketId) && isStr(t.lineId) && isNum(t.total))
  )
    return null;
  if (!isNullableStr(v.bookingInvoiceId)) return null;
  const grant =
    v.grant === null
      ? null
      : isObj(v.grant) && isObj(v.grant.grant) && isStr(v.grant.grant.id)
        ? (v.grant as unknown as BookingGrantWire)
        : undefined;
  const plan =
    v.plan === null
      ? null
      : isObj(v.plan) && isObj(v.plan.plan) && isStr(v.plan.plan.id)
        ? (v.plan as unknown as BookingPlanWire)
        : undefined;
  if (grant === undefined || plan === undefined) return null;
  const accrualCost = decodeCostFacet(v.accrualCost);
  if (!accrualCost) return null;
  return {
    services: v.services as ServiceFinancialRow[],
    planned: v.planned as VisitProductLine[],
    soldTotals: v.soldTotals as BookingFinancialProjection['soldTotals'],
    tickets: tickets as FullBookingTicketWire[],
    bookingInvoiceId: v.bookingInvoiceId,
    grant,
    plan,
    accrualCost,
  };
}

function decodeAnchor(a: unknown): AnchorAccrualWire | null | undefined {
  if (a === null) return null;
  if (
    isObj(a) &&
    isNum(a.open) &&
    isNum(a.realized) &&
    isNum(a.released) &&
    isNullableStr(a.realizedEntryId)
  )
    return a as unknown as AnchorAccrualWire;
  return undefined;
}

function decodeStock(v: unknown): BookingStockFacetValue | null {
  if (!isObj(v)) return null;
  const anchorAccrual = decodeAnchor(v.anchorAccrual);
  if (anchorAccrual === undefined) return null;
  return { anchorAccrual, recovery: decodeRecoveryFacet(v.recovery) };
}

/** `null` for a missing or other version (the caller must refresh); otherwise each facet decoded on its own. */
export function decodeProductFacets(input: unknown): BookingProductFacets | null {
  if (!isObj(input) || input.version !== BOOKING_PRODUCTS_VERSION) return null;
  return {
    version: 1,
    basic: decodeFacet(input.basic, decodeBasic),
    planned: decodeFacet(input.planned, decodePlanned),
    sold: decodeSoldFacet(input.sold),
    payment: decodeFacet(input.payment, decodePayment),
    stock: decodeFacet(input.stock, decodeStock),
  };
}

/** The server anchor, only from a validated basic facet; otherwise source-dependent writes stay off. */
export function visitAnchorIdFromFacets(f: BookingProductFacets | null | undefined): string | null {
  return f?.basic.state === 'available' ? f.basic.value.anchorId : null;
}

/**
 * Joins basic and payment into complete financial rows. Both must be available with the same member
 * and planned-product identity sets; every other state propagates (never a fabricated empty list, a
 * `0`, or an unpaid row). No `referenced` placeholder is constructed.
 */
export function financialVisitRows(f: BookingProductFacets | null | undefined): BookingReadFacet<{
  rows: FinancialVisitRow[];
  products: VisitProductLine[];
  plan: BookingPlanWire | null;
}> {
  if (!f) return INVALID;
  if (f.basic.state === 'denied' || f.payment.state === 'denied') return { state: 'denied' };
  if (f.basic.state !== 'available') return f.basic.state === 'empty' ? INVALID : f.basic;
  if (f.payment.state === 'unavailable') return f.payment;
  if (f.payment.state !== 'available') return INVALID; // empty payment for a nonempty basic visit
  const { members } = f.basic.value;
  const pay = f.payment.value;
  const byBooking = new Map(pay.services.map((r) => [r.bookingId, r]));
  if (pay.services.length !== members.length || members.some((m) => !byBooking.has(m.id)))
    return INVALID;
  const plannedIds =
    f.planned.state === 'available' ? f.planned.value.rows.map((r) => r.productId).sort() : [];
  if (
    f.planned.state === 'unavailable' ||
    f.planned.state === 'denied' ||
    plannedIds.join() !==
      pay.planned
        .map((p) => p.productId)
        .sort()
        .join()
  )
    return INVALID;
  const rows: FinancialVisitRow[] = members.map((mb) => {
    const r = byBooking.get(mb.id)!;
    return {
      id: mb.id,
      eventTypeId: mb.eventTypeId,
      title: mb.eventTypeTitle,
      minutes: mb.minutes,
      status: mb.status,
      paid: r.paid,
      price: r.price,
      paidAmount: r.paidAmount,
      currency: r.currency,
      funding: r.funding,
    };
  });
  return { state: 'available', value: { rows, products: pay.planned, plan: pay.plan } };
}

/** `BookingVisit`-shaped view of the basic facet for the structural-only helpers (header, anchor). */
export function basicMembers(f: BookingProductFacets | null | undefined): BasicVisitMember[] {
  return f?.basic.state === 'available' ? f.basic.value.members : [];
}
export type { BookingVisit };

// ── Calendar variant (reduced) ───────────────────────────────────────────────

/** What the calendar window carries per booking: the sold facet (shared with the detail), a REDUCED
 *  payment facet (paid / funding / ticket ids only: the window has no price or amount readers) and the
 *  anchor stock counts. No basic or planned facet: the grid already holds the structure. */
export type CalendarPayment = {
  paid: boolean;
  funding: 'cash' | 'grant' | 'plan';
  tickets: { id: string; humanId: string | null }[];
};
export type CalendarProductFacets = {
  version: 1;
  sold: SoldFacet;
  payment: BookingReadFacet<CalendarPayment>;
  stock: BookingReadFacet<{ anchorAccrual: AnchorAccrualWire | null }>;
};

function decodeCalendarPayment(v: unknown): CalendarPayment | null {
  if (
    !isObj(v) ||
    typeof v.paid !== 'boolean' ||
    typeof v.funding !== 'string' ||
    !FUNDING.has(v.funding) ||
    !Array.isArray(v.tickets) ||
    !v.tickets.every((t) => isObj(t) && isStr(t.id) && isNullableStr(t.humanId))
  )
    return null;
  return v as unknown as CalendarPayment;
}

export function decodeCalendarFacets(input: unknown): CalendarProductFacets | null {
  if (!isObj(input) || input.version !== BOOKING_PRODUCTS_VERSION) return null;
  return {
    version: 1,
    sold: decodeSoldFacet(input.sold),
    payment: decodeFacet(input.payment, decodeCalendarPayment),
    stock: decodeFacet(input.stock, (v) => {
      if (!isObj(v)) return null;
      const a = decodeAnchor(v.anchorAccrual);
      return a === undefined ? null : { anchorAccrual: a };
    }),
  };
}

/** True when every member of a box has an `available` payment facet — the only state a payment
 *  action (charge, sale, paid-cancel, delete) may be offered from. */
export function paymentReady(
  members: ReadonlyArray<{ productFacets?: CalendarProductFacets }>,
): boolean {
  return (
    members.length > 0 &&
    members.every((m) => decodeCalendarFacets(m.productFacets)?.payment.state === 'available')
  );
}

export type CalendarTicketOverlay = {
  id: string;
  humanId: string | null;
  at: string;
  total: number;
  currency: string;
  customerName: string | null;
  lines: { id: string; description: string; bookingId: string | null }[];
};
export type TicketOverlayFacet = BookingReadFacet<{ rows: CalendarTicketOverlay[] }>;

function decodeOverlay(v: unknown): { rows: CalendarTicketOverlay[] } | null {
  const rows = isObj(v) ? v.rows : null;
  if (
    !Array.isArray(rows) ||
    rows.length < 1 ||
    !rows.every(
      (r) =>
        isObj(r) &&
        isStr(r.id) &&
        isNullableStr(r.humanId) &&
        isStr(r.at) &&
        !Number.isNaN(Date.parse(r.at)) &&
        isNum(r.total) &&
        isStrAny(r.currency) &&
        isNullableStr(r.customerName) &&
        Array.isArray(r.lines) &&
        r.lines.every(
          (l) => isObj(l) && isStr(l.id) && isStrAny(l.description) && isNullableStr(l.bookingId),
        ),
    ) ||
    new Set(rows.map((r) => r.id)).size !== rows.length
  )
    return null;
  return { rows: rows as CalendarTicketOverlay[] };
}

/** A read facet, never an unconditional `[]` from malformed data. */
export function availableTicketOverlayRows(input: unknown): TicketOverlayFacet {
  return decodeFacet(input, decodeOverlay);
}

/** `null` = old protocol or malformed top level (refresh); legacy money keys are rejected outright. */
export function decodeBookingCalendarProjection<B>(
  input: unknown,
): { bookings: B[]; tagOptions: unknown[]; ticketOverlay: TicketOverlayFacet } | null {
  if (
    !isObj(input) ||
    input.productProjectionVersion !== BOOKING_PRODUCTS_VERSION ||
    'invoices' in input ||
    'accrualSummaries' in input ||
    !Array.isArray(input.bookings) ||
    !Array.isArray(input.tagOptions)
  )
    return null;
  return {
    bookings: input.bookings as B[],
    tagOptions: input.tagOptions,
    ticketOverlay: availableTicketOverlayRows(input.ticketOverlay),
  };
}

/** The strict detail envelope: everything but `productFacets` passes through typed by the caller. */
export function decodeBookingDetailWire<T extends object>(
  input: unknown,
): (T & { productFacets: BookingProductFacets }) | null {
  if (!isObj(input)) return null;
  const facets = decodeProductFacets(input.productFacets);
  if (!facets) return null;
  return { ...(input as unknown as T), productFacets: facets };
}

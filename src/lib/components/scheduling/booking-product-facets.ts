/**
 * Spec 126 (F5): the shared, client-safe wire for what a visit SOLD, so the
 * POS calendar hover and the detail drawer render one projection. Pure — no
 * server import — so the serializer used by both read paths lives here.
 *
 * shortcut: only the sold and stock-anchor facets are typed here; the full
 * `BookingProductFacets` envelope of contracts/wire.md is not built (see the
 * deviations in specs/126-booking-product-consistency/tasks.md).
 */

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

/**
 * A visit = ONE calendar event with ONE client, ONE professional and MANY
 * services (owner ask 2026-10-07: "events are separate from treatments; an event
 * can contain one or more services"). Storage is unchanged — each service is
 * still its own `sched_bookings` row sharing `metadata.groupId` (see
 * `scheduling-bookings.service.ts` "A merged visit is VIRTUAL") — this is the
 * wire shape the detail drawer uses to list, add, remove, reorder and separate
 * the services of the event it has open.
 */
import { isInactiveMemberStatus } from './booking-groups';

export type VisitReference = 'ticket' | 'order' | 'accrual';

export interface VisitMember {
  id: string;
  /** `metadata.groupSeq` — 0 is the lead (the row the calendar box carries). */
  seq: number;
  eventTypeId: string;
  eventTypeTitle: string;
  /** The service's own minutes (`metadata.groupLength`), not the visit window. */
  minutes: number;
  status: string;
  /** A non-void POS ticket line charged this service. */
  paid: boolean;
  /** List price of the service (`fin_products.unit_price` through the
   *  booking's `product_id`, else its event type's); null when the service is
   *  not linked to a catalog product — render "—", never 0. */
  price: number | null;
  /** Sum of the non-void ticket line totals that charged this service. */
  paidAmount: number;
  /** Currency of `paidAmount` (the ticket's) or of `price` (the org default);
   *  null only when nothing is known. */
  currency: string | null;
  /** How this service is settled: a package grant draws it, an instalment
   *  plan pays it off, or it is charged at the till. Per ROW — one event can
   *  mix a grant-covered service with a cash one. */
  funding: 'cash' | 'grant' | 'plan';
  /** Non-void tickets that carry a line for this service. */
  ticketIds: string[];
  /** What downstream still points at this row — a non-empty list means the row
   *  cannot be removed (only cancelled or separated), same triple `deleteBooking`
   *  refuses on. */
  referenced: VisitReference[];
}

export interface BookingVisit {
  groupId: string;
  /** Every member of ANY status, in `seq` order — cancelled ones render struck. */
  members: VisitMember[];
}

/** `POST …/[id]/group` bodies the visit section sends (see `_handlers.ts`). */
export type VisitAddBody = { addEventTypeId: string; overrideConflicts?: boolean };
export type VisitRemoveBody = { removeService: true };

/** One row the drawer's Services section renders — a `VisitMember` when the
 *  booking has a visit, else the booking itself standing in as its own only
 *  service (same shape either way, so the section never special-cases it). */
export interface VisitRow {
  id: string;
  eventTypeId: string;
  title: string;
  minutes: number;
  status: string;
  paid: boolean;
  /** List price — null when the service has no catalog product ("—", never 0). */
  price: number | null;
  /** What the till already took for this service. */
  paidAmount: number;
  currency: string | null;
  funding: 'cash' | 'grant' | 'plan';
  referenced: VisitReference[];
}

/** One of the event's POS tickets, as the ungrouped fallback reads it. */
type RowTicket = { status: string; lineTotal: string | number; currency: string | null };

/** Builds the Services section's rows: the visit's members in order, or the
 *  booking alone when it has no visit (a single-service event). */
export function visitRows(input: {
  visit: BookingVisit | null;
  booking: { id: string; eventTypeId: string; status: string };
  eventTypeTitle: string;
  minutes: number;
  paid: boolean;
  /** Ungrouped fallback only — a visit's members carry their own money. The
   *  booking has no price of its own here (nothing joins its product), so the
   *  row's money is what its tickets took; VOIDED tickets took nothing. */
  tickets?: readonly RowTicket[];
  /** Ungrouped fallback only: `grant` / `plan` when the booking draws on one. */
  funding?: 'cash' | 'grant' | 'plan';
}): VisitRow[] {
  if (input.visit) {
    return input.visit.members.map((mb) => ({
      id: mb.id,
      eventTypeId: mb.eventTypeId,
      title: mb.eventTypeTitle,
      minutes: mb.minutes,
      status: mb.status,
      paid: mb.paid,
      price: mb.price,
      paidAmount: mb.paidAmount,
      currency: mb.currency,
      funding: mb.funding,
      referenced: mb.referenced,
    }));
  }
  const charged = (input.tickets ?? []).filter((t) => t.status !== 'voided');
  return [
    {
      id: input.booking.id,
      eventTypeId: input.booking.eventTypeId,
      title: input.eventTypeTitle,
      minutes: input.minutes,
      status: input.booking.status,
      paid: input.paid,
      price: null,
      paidAmount: charged.reduce((sum, t) => sum + (Number(t.lineTotal) || 0), 0),
      currency: charged[0]?.currency ?? null,
      funding: input.funding ?? 'cash',
      referenced: [],
    },
  ];
}

export interface VisitSummary {
  n: number;
  paid: number;
  unpaid: number;
  /** Σ what the till already took across the services. */
  paidTotal: number;
  /** Σ list price of the unpaid services the till can still charge. */
  pendingTotal: number;
  /** Unpaid till-funded services with no price — they cannot join the sum. */
  pendingUnknown: number;
  /** The one currency every service agrees on; `null` when they disagree (the
   *  UI then shows counts only — a mixed-currency sum would be a lie) or when
   *  nothing is known yet. */
  currency: string | null;
}

/** The section's summary line: counts, and the money behind them. A grant-drawn
 *  service owes nothing; an instalment-plan one is pending against the PLAN's
 *  own remaining figure, not this event's, so neither joins `pendingTotal`. */
export function visitSummary(rows: VisitRow[]): VisitSummary {
  const currencies = new Set<string>();
  let paid = 0;
  let unpaid = 0;
  let paidTotal = 0;
  let pendingTotal = 0;
  let pendingUnknown = 0;
  for (const r of rows) {
    paidTotal += r.paidAmount;
    if (r.currency) currencies.add(r.currency);
    if (r.paid) {
      paid++;
      continue;
    }
    // A cancelled / rejected / no-show service owes nothing: it is neither
    // "unpaid" nor pending — the same rule the Charge button applies.
    if (isInactiveMemberStatus(r.status)) continue;
    unpaid++;
    if (r.funding !== 'cash') continue;
    if (r.price === null) pendingUnknown++;
    else pendingTotal += r.price;
  }
  return {
    n: rows.length,
    paid,
    unpaid,
    paidTotal,
    pendingTotal,
    pendingUnknown,
    currency: currencies.size === 1 ? [...currencies][0] : null,
  };
}

/** A row may only be removed outright when nothing downstream references it
 *  (same triple `deleteBooking` refuses on) — otherwise it can still be
 *  cancelled or separated. */
export function canRemoveService(referenced: VisitReference[]): boolean {
  return referenced.length === 0;
}

/**
 * Moves the id at `idx` one step `dir`ection (-1 up, +1 down) and returns a
 * NEW array — or the SAME array reference when the move is out of bounds, so
 * a caller can skip a no-op reorder POST by identity.
 */
export function nextOrder(ids: string[], idx: number, dir: -1 | 1): string[] {
  const j = idx + dir;
  if (idx < 0 || idx >= ids.length || j < 0 || j >= ids.length) return ids;
  const out = [...ids];
  [out[idx], out[j]] = [out[j], out[idx]];
  return out;
}

/**
 * The id every drawer write must carry: the event's LEAD service (`seq 0`), not
 * whichever row happened to be clicked. Opened from a non-lead service, the
 * tray would otherwise title itself after that one service and write its
 * notes, tags and status onto that single row. `null` with no detail loaded.
 */
export function visitAnchorId(
  detail: { booking: { id: string }; visit: BookingVisit | null } | null,
): string | null {
  if (!detail) return null;
  return detail.visit?.members[0]?.id ?? detail.booking.id;
}

/**
 * The header of a multi-service event: every service in visit order, including
 * the cancelled ones (the Services list right below shows them struck, so
 * dropping them here would make the header disagree with the list). `null` for
 * a single-service event, which keeps its own event-type title.
 */
export function visitHeaderTitle(members: Pick<VisitMember, 'eventTypeTitle'>[]): string | null {
  if (members.length < 2) return null;
  return members.map((mb) => mb.eventTypeTitle).join(' · ');
}

/**
 * The status the event reads as — the first ACTIVE member, falling back to the
 * lead when every member is inactive. Exactly the calendar box's `statusLead`
 * rule (`booking-groups.ts`), so the tray badge and the box agree. `leadStatus`
 * stands in when there is no visit at all.
 */
export function visitHeaderStatus(
  members: Pick<VisitMember, 'status'>[],
  leadStatus: string,
): string {
  const active = members.find((mb) => !isInactiveMemberStatus(mb.status));
  return active?.status ?? members[0]?.status ?? leadStatus;
}

/**
 * The title a calendar EVENT reads as in a list: every service joined " · "
 * (`visitHeaderTitle`'s rule, cancelled ones included, so the board card, the
 * table row and the tray header all say the same thing), or the single
 * service's own title. `titleOf` resolves an event-type id to its label —
 * the views already have that lookup over their loaded event types.
 */
export function servicesTitle(
  members: readonly { eventTypeId: string }[],
  titleOf: (eventTypeId: string) => string,
): string {
  return (
    visitHeaderTitle(members.map((mb) => ({ eventTypeTitle: titleOf(mb.eventTypeId) }))) ??
    titleOf(members[0]?.eventTypeId ?? '')
  );
}

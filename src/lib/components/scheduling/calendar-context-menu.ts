/**
 * What a right-click on a calendar event offers (owner ask 2026-10-10: "calendar
 * should have a context menu / right click interactions").
 *
 * Pure: event detail + the caller's capabilities in, menu entries out. The
 * labels stay with the host (Paraglide `m.*()` must not be called at module
 * scope), so an entry carries only its `kind` and — for a split — the service
 * title the host renders into "Dividir <title>".
 *
 * Every condition is the SAME rule the detail drawer already applies, imported
 * rather than re-derived: `chargeableRows` for "is anything still owed",
 * `visitHeaderStatus` for the event's own status, `isInactiveMemberStatus` for
 * "this service is closed".
 */
import { isInactiveMemberStatus } from './booking-groups';
import {
  chargeableRows,
  visitHeaderStatus,
  visitRows,
  type BookingVisit,
  type VisitProductLine,
  type VisitRow,
} from './visit';

/**
 * The slice of `GET /api/{pos/appointments,scheduling/bookings}/[id]` this menu
 * reads — the detail drawer's own serialized `Detail`, narrowed (a client module
 * must not import from `$server`, and `json()` turns every Date into a string).
 */
export interface EventMenuDetail {
  booking: {
    id: string;
    status: string;
    title: string | null;
    eventTypeId: string;
    productId: string | null;
    partyId: string | null;
    startTime: string;
    endTime: string;
    attendeeName: string | null;
    attendeePhone: string | null;
  };
  eventType: { title: string } | null;
  contact: { partyId: string | null } | null;
  grant: unknown | null;
  plan: { plan: { id: string }; isPaid: boolean } | null;
  tickets: ReadonlyArray<{ status: string; lineTotal: string; currency: string | null }>;
  visit: BookingVisit | null;
  products: VisitProductLine[];
}

export type CalendarMenuKind =
  'loading' | 'charge' | 'split' | 'splitAll' | 'splitOne' | 'unschedule' | 'delete';

export interface CalendarMenuEntry {
  /** Stable key — also the DOM id the host keys its `{#each}` on. */
  id: string;
  kind: CalendarMenuKind;
  /** A `splitOne` entry's booking id (the member to separate). */
  bookingId?: string;
  /** A `splitOne` entry's service title, for the host's label. */
  title?: string;
  disabled?: boolean;
  danger?: boolean;
  /** `split`'s one nested level. */
  children?: CalendarMenuEntry[];
}

/** The event's services, exactly as the drawer's Services section reads them. */
export function eventServiceRows(d: EventMenuDetail): VisitRow[] {
  return visitRows({
    visit: d.visit,
    booking: d.booking,
    eventTypeTitle: d.eventType?.title ?? d.booking.title ?? '—',
    minutes: Math.round(
      (new Date(d.booking.endTime).getTime() - new Date(d.booking.startTime).getTime()) / 60_000,
    ),
    // A VOIDED ticket took no money — it must not read as paid, or the event
    // loses its charge entry (same gate as the drawer).
    paid: d.tickets.some((t) => t.status !== 'voided'),
    tickets: d.tickets,
    funding: d.grant ? 'grant' : d.plan ? 'plan' : 'cash',
  });
}

/**
 * The menu for one event, in the owner's order: charge, split, then the
 * destructive pair (only ONE of unschedule/delete ever shows — which one
 * depends on whether the till already took money for a service of this event).
 *
 * `detail === null` means the fetch is still in flight: one disabled row, so
 * the menu opens instantly at the pointer instead of after a round trip.
 */
export function calendarMenuEntries(input: {
  detail: EventMenuDetail | null;
  /** Host can hand the event to the till (`pos:edit` on the POS calendar). */
  canPay: boolean;
  /** Host can mutate bookings (split / unschedule / cancel). */
  canEdit: boolean;
}): CalendarMenuEntry[] {
  const d = input.detail;
  if (!d) return [{ id: 'loading', kind: 'loading', disabled: true }];

  const rows = eventServiceRows(d);
  const chargeable = chargeableRows(rows);
  const headStatus = visitHeaderStatus(d.visit?.members ?? [], d.booking.status);
  // Nothing left to sell, but the anchor is on an open instalment plan: the
  // till takes the next instalment (the drawer's `instalmentOnly`).
  const instalmentOnly =
    chargeable.length === 0 && rows[0]?.funding === 'plan' && d.plan != null && !d.plan.isPaid;

  const entries: CalendarMenuEntry[] = [];

  if (
    input.canPay &&
    !isInactiveMemberStatus(headStatus) &&
    (chargeable.length > 0 || instalmentOnly)
  )
    entries.push({ id: 'charge', kind: 'charge' });

  const members = d.visit?.members ?? [];
  if (input.canEdit && members.length > 1)
    entries.push({
      id: 'split',
      kind: 'split',
      children: [
        { id: 'split-all', kind: 'splitAll' },
        ...members.map((mb) => ({
          id: `split-${mb.id}`,
          kind: 'splitOne' as const,
          bookingId: mb.id,
          title: mb.eventTypeTitle,
        })),
      ],
    });

  // "Delete" is a CANCEL (there is no hard delete of a booking). When the till
  // already charged a service of this event, cancelling alone would strand that
  // money on a ticket line pointing at a dead booking — that case is
  // "unschedule" instead, which hands the paid services back to the
  // "Servicios pagados sin agendar" tray.
  // A completed service was performed: neither action applies to it, so an
  // event with only completed/inactive members offers no destructive entry.
  const active = rows.some((r) => !isInactiveMemberStatus(r.status) && r.status !== 'completed');
  if (input.canEdit && active)
    entries.push(
      rows.some((r) => r.paid)
        ? { id: 'unschedule', kind: 'unschedule', danger: true }
        : { id: 'delete', kind: 'delete', danger: true },
    );

  return entries;
}

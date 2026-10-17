/**
 * What a right-click on a calendar event offers (owner ask 2026-10-10: "calendar
 * should have a context menu / right click interactions"; 2026-10-13: "the
 * context menus need to be pre-populated … some context menus are completely
 * empty").
 *
 * Pure and SYNCHRONOUS: the box the calendar already renders in, the caller's
 * capabilities in, menu entries out. Every condition reads the window payload
 * (`CalendarBooking.status/paid/funding`, spec 2026-10-13 D3) — no fetch on
 * open, and a mounted menu always has at least one entry: a closed visit
 * (cancelled / rejected / no-show / completed) offers "Ver detalle".
 *
 * The labels stay with the host (Paraglide `m.*()` must not be called at
 * module scope), so an entry carries only its `kind` and — for a split — the
 * member id the host renders into "Dividir <title>".
 */
import { isInactiveMemberStatus, type BookingBox } from './booking-groups';
import type { CalendarBooking } from './calendar-window';
import { visitRows, type BookingVisit, type VisitProductLine, type VisitRow } from './visit';

/**
 * The slice of `GET /api/{pos/appointments,scheduling/bookings}/[id]` the
 * CHARGE action reads once picked (the till handoff needs the drawer's rows
 * and products) — the detail drawer's own serialized `Detail`, narrowed (a
 * client module must not import from `$server`, and `json()` turns every Date
 * into a string).
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
  'detail' | 'charge' | 'split' | 'splitAll' | 'splitOne' | 'delete' | 'cancel-paid';

export interface CalendarMenuEntry {
  /** Stable key — also the DOM id the host keys its `{#each}` on. */
  id: string;
  kind: CalendarMenuKind;
  /** A `splitOne` entry's booking id (the member to separate). */
  bookingId?: string;
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

/** A member still open for work: not closed, not already performed. */
function isActive(m: Pick<CalendarBooking, 'status'>): boolean {
  return !isInactiveMemberStatus(m.status) && m.status !== 'completed';
}

/**
 * The menu for one event, in the owner's order: charge, split, then ONE
 * destructive entry — `delete` while the till took nothing, `cancel-paid`
 * (void the ticket(s), choose the refund, cancel the visit) once any service
 * is paid. A closed visit offers only `detail`.
 */
export function calendarMenuEntries(input: {
  box: Pick<BookingBox, 'members'>;
  /** Host can hand the event to the till (`pos:edit` on the POS calendar). */
  canPay: boolean;
  /** Host can mutate bookings (split / cancel). */
  canEdit: boolean;
  /** Host can void a ticket (`pos:manage`, what `POST /tickets/:id/void` requires). */
  canVoid: boolean;
}): CalendarMenuEntry[] {
  const members = input.box.members;
  if (!members.some(isActive)) return [{ id: 'detail', kind: 'detail' }];

  const entries: CalendarMenuEntry[] = [];

  // TODO(handoff): an open instalment plan with nothing left to sell (the
  // drawer's `instalmentOnly`) no longer offers charge here — `plan.isPaid` is
  // not in the window payload. The drawer still offers it. Ledger:
  // proposals/2026-10-13-hub-calendar-context-menu-followups.md
  if (
    input.canPay &&
    members.some((m) => isActive(m) && (m.funding ?? 'cash') === 'cash' && !m.paid)
  )
    entries.push({ id: 'charge', kind: 'charge' });

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
        })),
      ],
    });

  // "Delete" is a CANCEL (there is no hard delete of a booking). Once the till
  // charged a service of this event, cancelling alone would strand that money
  // on a ticket line pointing at a dead booking — that case voids the whole
  // ticket first (spec 2026-10-13 I3/I6).
  // A host who may edit but not void gets NO destructive entry on a paid event
  // (FACES 2026-10-16: `staff` holds pos edit, not manage — the entry 403'd).
  if (input.canEdit) {
    if (!members.some((m) => m.paid)) entries.push({ id: 'delete', kind: 'delete', danger: true });
    else if (input.canVoid) entries.push({ id: 'cancel-paid', kind: 'cancel-paid', danger: true });
  }

  return entries;
}

/** Why `POST /api/pos/tickets/:id/void` refused, for the dialog's failure line.
 *  A SvelteKit `error(403)` body is `{message}`, the pos refusals are
 *  `{error, code}` — `other` carries whichever text the server sent. */
export function voidRefusalKey(
  status: number,
  body: { code?: string },
): 'forbidden' | 'no_open_shift' | 'other' {
  if (status === 403) return 'forbidden';
  if (body.code === 'no_open_shift') return 'no_open_shift';
  return 'other';
}

/** What the cancel-paid dialog names: every distinct non-void ticket of the
 *  visit (in member order) and the members it will cancel. */
export function cancelPaidTickets(
  members: ReadonlyArray<Pick<CalendarBooking, 'tickets'>>,
): { id: string; humanId: string | null }[] {
  const seen = new Set<string>();
  const out: { id: string; humanId: string | null }[] = [];
  for (const m of members)
    for (const t of m.tickets ?? []) {
      if (seen.has(t.id)) continue;
      seen.add(t.id);
      out.push(t);
    }
  return out;
}

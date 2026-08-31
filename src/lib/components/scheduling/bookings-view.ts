/**
 * Contract for the shared `BookingsView` component (spec
 * `2026-08-17-hub-pos-appointments-fork`, slice 2).
 *
 * The component is deliberately route-agnostic: it never asks *which* route
 * rendered it. Everything that differs between the two booking surfaces
 * arrives as data (`BookingsViewData`), as a behaviour switch
 * (`BookingCapabilities`) or as a message-key selector (`labelNamespace`).
 *
 * The row/resource/event-type shapes below are the structural subset the view
 * actually reads. They are intentionally narrower than the server row types —
 * a client component must not import from `$server` — so the loader's richer
 * return value stays assignable without a hand-copied schema mirror.
 */
import * as m from '$lib/paraglide/messages';

export type BookingsViewBooking = {
  id: string;
  status: string;
  startTime: Date | string;
  eventTypeId: string;
  resourceId: string;
  attendeeName: string | null;
  attendeePhone: string | null;
  /** Party-spine + catalog links the POS charge handoff forwards to /pos/sell. */
  partyId?: string | null;
  productId?: string | null;
};

export type BookingsViewResource = { id: string; name: string };

export type BookingsViewEventType = { id: string; title: string; productId: string | null };

export type BookingsViewAccrualSummary = {
  sourceId: string;
  open: number;
  realized: number;
  realizedValue: number;
  estValue: number;
  realizedEntryId: string | null;
};

export type BookingsViewData = {
  bookings: BookingsViewBooking[];
  resources: BookingsViewResource[];
  eventTypes: BookingsViewEventType[];
  stockEnabled: boolean;
  accrualSummaries: BookingsViewAccrualSummary[];
  /** Contact-scope keys — present only when the loader ran with `contactScope`. */
  contactId?: string | null;
  contactName?: string | null;
  openNew?: boolean;
};

/**
 * Behaviour switches. One key per *divergent* affordance found by the slice-1
 * differential audit — affordances both surfaces share (complete, no-show,
 * cancel, create-booking, the stock accrual chips and the consumption dialogs)
 * are not switches and must not become ones.
 *
 * Every switch is optional and defaults to the scheduling behaviour, so the
 * scheduling call site keeps working unchanged as POS-only rows are added.
 */
export type BookingCapabilities = {
  /**
   * Booking → sales order (`ClipboardList` row action). Scheduling passes
   * `!isPersonal` today: sales orders are business-kind-only (S3/WP1 R6). That
   * kind-leak is preserved verbatim here; fixing it is owned by
   * `2026-07-22-personal-org-differentiation-spec`.
   */
  createSalesOrder: boolean;
  /**
   * Booking → charge handoff on *completed* bookings (POS-only). The host route
   * supplies the handoff itself via `onCharge` — the shared view only decides
   * whether the affordance is offered, so the `/pos/sell` hand-off stays in POS.
   */
  chargeToPos?: boolean;
  /**
   * Front-desk agenda: rows bucketed by day under a today/week range toggle,
   * with the start time as the leading column. `false` renders the flat,
   * fully-windowed list with a date+resource caption.
   */
  dayAgenda?: boolean;
  /**
   * New-booking modal offers a forced staff pick and — only with that pick plus
   * an explicit confirmation — an off-grid typed start (`overrideConflicts`).
   */
  staffOverride?: boolean;
};

/**
 * Read/write handle on the attendee identity the new-booking modal submits.
 * Handed to the `customerField` snippet so a host-supplied picker (the POS party
 * picker, say) can drive the booking call without owning it. A host picker links
 * no CRM contact: the booking API resolves or creates one from the phone.
 */
export type BookingCustomerControl = {
  name: string | null;
  phone: string | null;
  setCustomer: (next: { name?: string | null; phone?: string | null }) => void;
};

/** Message-key selector. Selects labels and nothing else — never behaviour. */
export type BookingsLabelNamespace = 'scheduling' | 'pos';

export interface BookingsLabels {
  title: () => string;
  /** `null` renders no subtitle. */
  subtitle: () => string | null;
  newAction: () => string;
  newModalTitle: () => string;
  /** Charge action on completed bookings — required by `chargeToPos`. */
  chargeAction?: () => string;
  /** Range-toggle labels — required by `dayAgenda`. */
  rangeToday?: () => string;
  rangeWeek?: () => string;
  /** "Anyone" option + off-grid confirmation — required by `staffOverride`. */
  staffAny?: () => string;
  overrideConflicts?: () => string;
}

/**
 * Resolves the per-surface label set. Every entry is a *function*: calling
 * `m.*()` at module scope bakes the 'en' locale into the SSR bundle.
 */
export function bookingsLabels(ns: BookingsLabelNamespace): BookingsLabels {
  if (ns === 'pos') {
    return {
      title: () => m.pos_nav_appointments(),
      subtitle: () => null,
      newAction: () => m.pos_appt_new(),
      newModalTitle: () => m.pos_appt_new(),
      chargeAction: () => m.pos_appt_charge(),
      rangeToday: () => m.pos_appt_today(),
      rangeWeek: () => m.pos_appt_week(),
      staffAny: () => m.pos_appt_staff_any(),
      overrideConflicts: () => m.pos_walkin_override(),
    };
  }
  return {
    title: () => m.sched_bookings_title(),
    subtitle: () => m.sched_dashboard_subtitle(),
    newAction: () => m.sched_bookings_title(),
    newModalTitle: () => m.sched_bookings_title(),
  };
}

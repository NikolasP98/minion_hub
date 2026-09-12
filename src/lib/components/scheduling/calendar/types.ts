/**
 * Calendar contracts shared by the scheduling calendar views (client) and the
 * `loadCalendarEvents` server loader / `GET /api/scheduling/calendar` endpoint.
 * Spec: minion-meta specs/2026-09-08-hub-scheduling-calendar-views-tags-spec.md
 */
export type CalendarView = 'day' | 'week' | 'month' | 'agenda';

/** A tag from the org-wide registry (`crm_tags`, manual kind). */
export type CalTag = { id: string; name: string; color: string | null };

/** An org-defined event kind (`sched_event_kinds`) — the category colour of a calendar entry. */
export type CalKind = {
  id: string;
  name: string;
  color: string;
  isDefault: boolean;
  position: number;
};

/**
 * One calendar entry = one booking, denormalised for display. ISO strings, never Dates.
 *
 * `start`/`end` identify absolute instants (ISO 8601, Z or numeric offset).
 * The loader emits resource-zone offsets; local moves emit UTC offsets.
 * Only SchedulingCalendar's rendering boundary projects viewer-local wall
 * fields. Never store the renderer's floating strings as booking instants.
 */
export type CalEvent = {
  id: string;
  /** Absolute ISO 8601 instant, including any fractional milliseconds. */
  start: string;
  /** Absolute ISO 8601 instant, including any fractional milliseconds. */
  end: string;
  status: string;
  resourceId: string;
  resourceName: string;
  resourceColor: string | null;
  /** booking.kindId ?? eventType.kindId ?? null (null → the org's default kind). */
  kindId: string | null;
  eventTypeId: string;
  eventTypeTitle: string;
  title: string | null;
  notes: string | null;
  crmContactId: string | null;
  attendeeName: string | null;
  attendeePhone: string | null;
  productId: string | null;
  productName: string | null;
  /** Soft-linked invoice (spec S6) + its resolved label; both null when unlinked. */
  invoiceId: string | null;
  invoiceLabel: string | null;
  /** Tags applied to the booking itself. */
  tags: CalTag[];
  /** Manual tags of the linked CRM contact (empty when no contact). */
  contactTags: CalTag[];
  /** Tags of the linked catalog product (empty when no product). */
  productTags: CalTag[];
};

export type CalendarPayload = { from: string; to: string; events: CalEvent[] };

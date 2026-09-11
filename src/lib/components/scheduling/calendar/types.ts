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
 * `start`/`end` MUST carry an explicit `±HH:MM` offset (the resource's timezone at
 * that instant) — never a `Z` suffix. `@event-calendar/core` drops any offset it
 * cannot match with `/([+-])(\d{2}):(\d{2})$/` and then draws the raw digits, so a
 * `Z` string is rendered at its UTC wall clock. Server side that is
 * `toOffsetIsoString`; client side (drag/resize write-back) it is `offsetIso`.
 */
export type CalEvent = {
  id: string;
  /** ISO 8601 with an explicit `±HH:MM` offset (never `Z`). */
  start: string;
  /** ISO 8601 with an explicit `±HH:MM` offset (never `Z`). */
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
  /** Tags applied to the booking itself. */
  tags: CalTag[];
  /** Manual tags of the linked CRM contact (empty when no contact). */
  contactTags: CalTag[];
  /** Tags of the linked catalog product (empty when no product). */
  productTags: CalTag[];
};

export type CalendarPayload = { from: string; to: string; events: CalEvent[] };

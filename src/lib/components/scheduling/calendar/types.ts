/**
 * Tag / kind vocabulary shared across the hub (tag pickers, filters, event-type
 * and booking forms, the services catalog).
 *
 * The denormalised `CalEvent`/`CalendarPayload` shapes that used to live here
 * went with the `@event-calendar` renderer (spec 2026-09-27 S3): every calendar
 * surface now speaks `CalendarBooking` from
 * `$lib/components/scheduling/calendar-window`.
 */
/** A tag from the org-wide registry (`crm_tags`, manual kind). */
export type CalTag = {
  id: string;
  name: string;
  color: string | null;
  /** Set when a tag is offered outside its own scope (e.g. a client's or service's
   *  tag in an event filter) so the row can say where it comes from. */
  origin?: 'contact' | 'product';
};

/** An org-defined event kind (`sched_event_kinds`) — the category colour of a calendar entry. */
export type CalKind = {
  id: string;
  name: string;
  color: string;
  isDefault: boolean;
  position: number;
};

/**
 * Merged visits ("one client, one chair, several procedures back to back").
 *
 * A merged visit is bookings that share `metadata.groupId` on the SAME resource
 * for the SAME client; the calendar renders them as ONE box spanning the first
 * member's start to the last member's end, and the server treats them as one
 * visit for the buffer-padded conflict check (they are deliberately abutting).
 *
 * Pure so the layout rule and the merge predicate are checkable without a DOM
 * or a database — the component only feeds it a column's bookings.
 */

import type { CalendarBooking } from './calendar-window';

/**
 * Who a booking is for. The id column wins over the free-text name: two
 * walk-ins both typed in as "Ana" are not one visit, while the same party
 * booked twice is. `null` = unknown client, which can never merge.
 */
export function clientKeyOf(b: Pick<CalendarBooking, 'partyId' | 'attendeeName'>): string | null {
  if (b.partyId) return `p:${b.partyId}`;
  const name = b.attendeeName?.trim().toLowerCase();
  return name ? `n:${name}` : null;
}

/** Can these two bookings become one visit? Same chair, same client, not self. */
export function canMergeBookings(
  a: Pick<CalendarBooking, 'id' | 'resourceId' | 'partyId' | 'attendeeName'>,
  b: Pick<CalendarBooking, 'id' | 'resourceId' | 'partyId' | 'attendeeName'>,
): boolean {
  if (a.id === b.id) return false;
  if (a.resourceId !== b.resourceId) return false;
  const key = clientKeyOf(a);
  return key !== null && key === clientKeyOf(b);
}

/** One rendered box: a single booking, or a merged visit of several. */
export interface BookingBox {
  /** Stable across a re-group: the lead member's id. */
  key: string;
  /** Procedures in start order. Length 1 for an ordinary booking. */
  members: CalendarBooking[];
  /** First member — the box's identity (client, chair, colour source). */
  lead: CalendarBooking;
  groupId: string | null;
  /** ISO span of the whole box. */
  start: string;
  end: string;
}

/**
 * Collapse CONSECUTIVE bookings sharing a `groupId` (and a resource) into one
 * box. Consecutive in start order, so a foreign booking wedged between two
 * members splits the visit back into two boxes rather than drawing a box over
 * something it doesn't contain. A different resource never groups even with the
 * same id — the grouping is per chair.
 */
export function groupBookings(bookings: CalendarBooking[]): BookingBox[] {
  const sorted = [...bookings].sort(
    (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime() || a.id.localeCompare(b.id),
  );
  const boxes: BookingBox[] = [];
  for (const b of sorted) {
    const groupId = b.groupId ?? null;
    const prev = boxes[boxes.length - 1];
    if (prev && groupId && prev.groupId === groupId && prev.lead.resourceId === b.resourceId) {
      prev.members.push(b);
      if (new Date(b.end).getTime() > new Date(prev.end).getTime()) prev.end = b.end;
      continue;
    }
    boxes.push({ key: b.id, members: [b], lead: b, groupId, start: b.start, end: b.end });
  }
  return boxes;
}

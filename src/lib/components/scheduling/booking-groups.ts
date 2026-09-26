/**
 * Merged visits ("one client, one chair, several procedures back to back").
 *
 * A merged visit is bookings that share `metadata.groupId` on the SAME resource
 * for the SAME client; the calendar renders them as ONE box spanning the whole
 * visit, and the server treats them as one visit for the buffer-padded conflict
 * check (they are deliberately co-timed). Since #370 every member carries the
 * SAME start/end — the container window — plus `groupSeq`; legacy #369 rows are
 * still laid back-to-back with no seq, so both shapes have to render.
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
  /** Procedures in visit order (`groupSeq`, else start). Length 1 for an
   *  ordinary booking. */
  members: CalendarBooking[];
  /** First member — the box's identity (client, chair, colour source). */
  lead: CalendarBooking;
  groupId: string | null;
  /** ISO span of the whole box. */
  start: string;
  end: string;
}

/**
 * Collapse ALL bookings sharing a `groupId` (and a resource) into one box — not
 * only consecutive ones: the members of a container visit all carry the same
 * window, so "consecutive" stopped meaning anything, and a foreign booking
 * sitting inside the window must not split the visit in two. A different
 * resource never groups even with the same id — the grouping is per chair.
 *
 * Members are ordered by `groupSeq` (the stamped order inside the visit), falling
 * back to start time then id for legacy rows that have none. The box spans
 * min(start)..max(end) over its members, which is the window itself once the
 * group has been normalised and the back-to-back span before that.
 */
export function groupBookings(bookings: CalendarBooking[]): BookingBox[] {
  const sorted = [...bookings].sort(
    (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime() || a.id.localeCompare(b.id),
  );
  const boxes: BookingBox[] = [];
  /** groupId + resource → its box. One box per visit per chair. */
  const byGroup = new Map<string, BookingBox>();
  for (const b of sorted) {
    const groupId = b.groupId ?? null;
    const box = groupId ? byGroup.get(`${groupId}\u0000${b.resourceId}`) : undefined;
    if (box) {
      // `sorted` is by start, so the box already holds the earliest one.
      box.members.push(b);
      if (new Date(b.end).getTime() > new Date(box.end).getTime()) box.end = b.end;
      continue;
    }
    const fresh: BookingBox = {
      key: b.id,
      members: [b],
      lead: b,
      groupId,
      start: b.start,
      end: b.end,
    };
    boxes.push(fresh);
    if (groupId) byGroup.set(`${groupId}\u0000${b.resourceId}`, fresh);
  }
  for (const box of boxes) {
    if (box.members.length === 1) continue;
    box.members.sort(
      (a, b) =>
        (a.groupSeq ?? Number.MAX_SAFE_INTEGER) - (b.groupSeq ?? Number.MAX_SAFE_INTEGER) ||
        new Date(a.start).getTime() - new Date(b.start).getTime() ||
        a.id.localeCompare(b.id),
    );
    // The lead is the visit's seq-0 member: it owns the box identity (client,
    // chair, colour) and is the id the container's move/separate calls carry, so
    // the box key follows it.
    box.lead = box.members[0];
    box.key = box.lead.id;
  }
  return boxes;
}

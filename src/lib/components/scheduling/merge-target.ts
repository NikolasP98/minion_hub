/**
 * Which box a dragged booking would MERGE into — the one predicate behind both
 * the drag-over highlight and the drop that opens the merge dialog.
 *
 * It exists as its own pure function because hover feedback and the commit must
 * never disagree: an outline that promises a merge and a drop that silently
 * reschedules instead is worse than no feedback at all (owner ask 2026-09-25:
 * "I want there to be clear visual feedback WHILE the user is dragging the event
 * over another compatible one"). The component derives it once and reads that
 * same value in the markup and in `onDragEnd`.
 */

import { canMergeBookings, type BookingBox } from './booking-groups';

/**
 * The box on the drop column whose span INTERSECTS the ghost and which can
 * become one visit with the dragged one, or `null`.
 *
 * Intersection, not start containment: two bookings of one client on one chair
 * cannot stack, so any overlap has exactly one sensible outcome — the merge —
 * and the outline must promise it wherever the drop would otherwise be refused
 * (owner ask 2026-09-26: no overlap dialog on a merge). Back-to-back stays a
 * move (the end is exclusive).
 *
 * Only a SINGLE booking merges INTO a visit — dragging a whole container onto
 * something else stays a move (nesting containers is not a thing) — so the
 * members check lives here rather than at the two call sites.
 *
 * `minutesOf` is injected because "which minute of the day is this instant"
 * is a timezone policy the calendar owns (browser wall clock today, org tz
 * once that is threaded through); this helper must not pick a second one.
 */
export function mergeTargetBox<B extends BookingBox>(args: {
  /** The drop column's boxes (the dragged one included; it is skipped by key). */
  boxes: readonly B[];
  dragged: BookingBox;
  /** Ghost span, minutes from midnight — where the drop would land. */
  startMin: number;
  endMin: number;
  /** Resource the drop resolves to (the column's, else the dragged box's). */
  resourceId: string;
  minutesOf: (iso: string) => number;
}): B | null {
  const { boxes, dragged, startMin, endMin, resourceId, minutesOf } = args;
  if (dragged.members.length !== 1) return null;
  return (
    boxes.find(
      (o) =>
        o.key !== dragged.key &&
        startMin < minutesOf(o.end) &&
        endMin > minutesOf(o.start) &&
        o.lead.resourceId === resourceId &&
        canMergeBookings(dragged.lead, o.lead),
    ) ?? null
  );
}

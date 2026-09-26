/**
 * Fan-out geometry for a CONTAINER block (a merged visit): where each procedure
 * sits once the operator clicks the container open and its members spread into
 * floating blocks inside the same track.
 *
 * Members of a container share ONE window since #370, so a member's own length
 * is `groupLength` (the minutes it is worth inside the visit) — the start/end
 * difference only means anything for legacy #369 rows, which are still laid
 * back to back. Both shapes therefore reduce to "minutes", and the fan is a
 * simple cumulative stack from the container's own top.
 *
 * Pure so the layout is checkable without a DOM: the component supplies the
 * container's measured top and the grid's pixels-per-hour.
 */

/** The part of a booking the fan needs. */
export interface FanMember {
  id: string;
  /** ISO instant. */
  start: string;
  /** ISO instant. */
  end: string;
  /** Minutes this procedure is worth on its own inside the visit. */
  groupLength?: number | null;
}

/** One floating block: absolute `top`/`height` in px inside the track. */
export interface FanSlot {
  id: string;
  top: number;
  height: number;
}

/** State key for the fanned container. Day view renders one booking in TWO
 *  columns (aggregate + resource), so a box alone cannot identify the fan. */
export const fanKey = (colKey: string, boxKey: string): string => `${colKey} ${boxKey}`;

/** A member's own length in minutes — never negative. */
function memberMinutes(mb: FanMember): number {
  const own =
    mb.groupLength ?? (new Date(mb.end).getTime() - new Date(mb.start).getTime()) / 60_000;
  return Math.max(0, own);
}

/**
 * Stack the members from `containerTopPx` down, each as tall as its own minutes
 * (never shorter than `minHeight`, the same floor an event box has — otherwise a
 * 5-minute procedure is an unclickable hairline).
 *
 * The stack advances by the member's TRUE minutes, not by its clamped height, so
 * the fan keeps lining up with the time axis: a clamped member overlaps the next
 * one slightly rather than pushing the whole deck out of the container's window.
 *
 * TODO(handoff): that trade means a deck of QUARTER-hour procedures (FACES runs
 * all 60 services at 15 min = 14px, under the 18px floor) overlaps ~4px per
 * member. Advancing by the clamped height instead would be gap-free but would
 * slide the fan off the time axis; the real fix is a minimum-height budget that
 * compresses the whole deck into the container's window. Ledger: meta-repo
 * `proposals/2026-09-25-hub-pos-calendar-color-followups.md` item 33.
 */
/**
 * Where each member sits while the container is fanned open. The deck FILLS the
 * container's height: when the visit was stretched past the sum of its members
 * (a container can take any duration), every block grows in proportion, so the
 * fan reads as the container split into its parts rather than a small stack in
 * its top corner. It never shrinks below true minutes (a container shorter than
 * its members — legacy data — just overflows), and never below `minHeight`, in
 * which case the stack advances by the floored height so quarter-hour members
 * do not overlap.
 */
export function fanLayout(
  members: readonly FanMember[],
  containerTopPx: number,
  pxPerHour: number,
  minHeight: number,
  containerHeightPx?: number,
): FanSlot[] {
  const total = members.reduce((sum, mb) => sum + memberMinutes(mb), 0);
  const naturalPx = (total / 60) * pxPerHour;
  const scale = containerHeightPx && naturalPx > 0 ? Math.max(1, containerHeightPx / naturalPx) : 1;
  let top = containerTopPx;
  return members.map((mb) => {
    const height = Math.max(minHeight, (memberMinutes(mb) / 60) * pxPerHour * scale);
    const slot = { id: mb.id, top, height };
    top += height;
    return slot;
  });
}

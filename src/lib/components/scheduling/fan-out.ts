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
/** State key for the fanned container. Day view renders one booking in TWO
 *  columns (aggregate + resource), so a box alone cannot identify the fan. */
export const fanKey = (colKey: string, boxKey: string): string => `${colKey} ${boxKey}`;

/** A member's own length in minutes — never negative. */
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
 * Where the deck of floating member blocks sits: level with the container's
 * top, pulled up only as far as needed to keep the whole deck inside the
 * track (owner ask 2026-09-26: the blocks render NEXT to the container —
 * above/below/lateral, whichever fits — never inline over it).
 */
export function fanDeckTop(
  containerTopPx: number,
  count: number,
  blockPx: number,
  gapPx: number,
  padPx: number,
  trackHeightPx: number,
): number {
  const deck = count * blockPx + Math.max(0, count - 1) * gapPx + padPx * 2;
  return Math.max(0, Math.min(containerTopPx, trackHeightPx - deck));
}

/** Which side of the column the deck opens on: the right, unless a full column
 *  would not fit before the scroller's right edge. */
export function fanSide(
  col: { left: number; right: number },
  scroller: { left: number; right: number },
): 'right' | 'left' {
  const colW = col.right - col.left;
  return col.right + colW <= scroller.right ? 'right' : 'left';
}

/**
 * Fan-deck drag-to-reorder (owner ask 2026-09-29 — "dragging the fanned out
 * container events to reorder them", the drag alternative to the Separate
 * button). Pure so the live preview while a pointer moves is checkable
 * without a DOM.
 */

/** Which slot index the pointer is over inside the deck, from its Y relative
 *  to the deck's own top-padding edge — clamped to the member count. */
export function fanDragIndex(relY: number, count: number, blockPx: number, gapPx: number): number {
  const step = blockPx + gapPx;
  return Math.max(0, Math.min(count - 1, Math.round(relY / step)));
}

/** `ids` with `draggedId` moved to `index` — the live insertion preview the
 *  other members shift to make room for. */
export function reorderPreview(ids: string[], draggedId: string, index: number): string[] {
  const rest = ids.filter((id) => id !== draggedId);
  const clamped = Math.max(0, Math.min(rest.length, index));
  return [...rest.slice(0, clamped), draggedId, ...rest.slice(clamped)];
}

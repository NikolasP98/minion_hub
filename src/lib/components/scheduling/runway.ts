/**
 * Runway arithmetic for the calendar's infinite week scrolling.
 *
 * Days do not live in the view's window any more: workweek/week render onto a
 * FIXED runway of columns (105 weeks, anchored 52 weeks behind the date the
 * calendar opened on) that the scroller slides over, so scrolling a week is a
 * native horizontal scroll with day snapping and no navigation at all. This
 * module owns the index ↔ day mapping and the "which columns are worth keeping
 * in the DOM" window; `BookingCalendar.svelte` owns the pixels.
 *
 * All day math runs on `YYYY-MM-DD` strings through `Date.UTC`, so it is
 * timezone-free — the same contract `calendar-window.ts` documents. Its own
 * Monday helper is private and millisecond-based, hence the (deliberately
 * small) duplication here.
 */

const DAY_MS = 86_400_000;

function toUtcMs(day: string): number {
  const [y, m, d] = day.split('-').map(Number);
  return Date.UTC(y, (m ?? 1) - 1, d ?? 1);
}

function toDayString(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Monday of the ISO week containing `day`, as `YYYY-MM-DD`. */
export function mondayOf(day: string): string {
  const ms = toUtcMs(day);
  const isoOffset = (new Date(ms).getUTCDay() + 6) % 7; // Sun=6, Mon=0
  return toDayString(ms - isoOffset * DAY_MS);
}

/** Column index of `day` on a runway starting at `runwayStart` (may be < 0). */
export function dayIndex(runwayStart: string, day: string): number {
  return Math.round((toUtcMs(day) - toUtcMs(runwayStart)) / DAY_MS);
}

/** The day at column `i` — also the generic "shift a day by N days" helper. */
export function dayAt(runwayStart: string, i: number): string {
  return toDayString(toUtcMs(runwayStart) + i * DAY_MS);
}

/**
 * The column index range worth RENDERING: the visible columns plus `pad` on
 * each side, clamped to the runway. Everything outside is plain runway width,
 * so the DOM holds ~3 screens of columns however far the operator scrolls.
 *
 * `scrollLeft` is measured from the runway's first column (the sticky time
 * gutter is `scroll-padding-left`, not content offset), so column `i` sits at
 * `i * colW` and `scrollLeft / colW` is the first visible column.
 */
export function renderedRange(
  scrollLeft: number,
  colW: number,
  visibleCount: number,
  total: number,
  pad = 7,
): { first: number; last: number } {
  if (!(colW > 0)) return { first: 0, last: Math.min(total - 1, visibleCount - 1) };
  const firstVisible = Math.floor(scrollLeft / colW);
  return {
    first: Math.max(0, firstVisible - pad),
    last: Math.min(total - 1, firstVisible + visibleCount - 1 + pad),
  };
}

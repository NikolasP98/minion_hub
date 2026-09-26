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

// ── Month runway: rows of ISO weeks ────────────────────────────────────────
// Month view is the same trick on the other axis (owner ask 2026-09-25: "month
// has up/down infinite scroll"): a fixed runway of 105 week ROWS the scroller
// slides over vertically. `renderedRange` above is index math, not column math,
// so it serves both — `scrollLeft/colW` there reads as `scrollTop/rowH` here.

/** Row index of the ISO week containing `day`, on a runway of weeks whose row 0
 *  is the ISO week of `rowStart` (may be < 0). */
export function rowIndex(rowStart: string, day: string): number {
  return Math.round(dayIndex(mondayOf(rowStart), mondayOf(day)) / 7);
}

/** The Monday opening row `i` — also the generic "shift a week by N weeks". */
export function rowAt(rowStart: string, i: number): string {
  return dayAt(mondayOf(rowStart), i * 7);
}

/**
 * The `YYYY-MM` month owning the most days across the given week rows.
 *
 * The month view's label has to name the month the operator is LOOKING at, not
 * whichever month the top row happens to start in: a window whose first row is
 * `Aug 25 – Aug 31` is still September once the four rows under it are. Ties go
 * to the earlier month (a whole 6-row grid never ties; a 2- or 4-row window can).
 */
export function majorityMonth(mondays: readonly string[]): string {
  const days = new Map<string, number>();
  for (const monday of mondays)
    for (let d = 0; d < 7; d++) {
      const key = dayAt(monday, d).slice(0, 7);
      days.set(key, (days.get(key) ?? 0) + 1);
    }
  let best = mondays[0]?.slice(0, 7) ?? '';
  let top = 0;
  // Sorted so a tie resolves to the earlier month rather than to Map order.
  for (const [key, n] of [...days].sort(([a], [b]) => a.localeCompare(b)))
    if (n > top) {
      top = n;
      best = key;
    }
  return best;
}
